import "server-only";

// ---------------------------------------------------------------------------
// 后台长任务
//
// 为什么需要：网关在 60 秒处掐断请求（实测 /api/ingest 卡在 60.19s 返回 504），
// 而采集要 60-90 秒、蒸馏要几分钟、建链平均 116 秒。同步返回必然超时，
// 用户看到的就是「点了没反应 / 失败」。
// 现在：POST 立即返回「已启动」，任务在 Node 进程内继续跑（next start 是长驻进程，
// 响应返回后 promise 不会被冻结），结果写入内存供状态查询。
// ---------------------------------------------------------------------------

export type JobState = {
  running: boolean;
  startedAt: number;
  finishedAt?: number;
  ok?: boolean;
  detail?: string;
};

type Registry = Map<string, JobState>;

const g = globalThis as typeof globalThis & { __wlJobs?: Registry };
const jobs: Registry = g.__wlJobs ?? new Map<string, JobState>();
g.__wlJobs = jobs;

export function jobState(name: string): JobState {
  return jobs.get(name) ?? { running: false, startedAt: 0 };
}

/** 任务悬挂兜底：理论上不可能（LLM 调用都有 AbortSignal），但一旦发生，
 *  后续所有手动触发都会被"上一次还在跑"挡死——30 分钟强制视为死亡。 */
function isStale(s: JobState): boolean {
  return s.running && Date.now() - s.startedAt > 30 * 60_000;
}

function finish(name: string, ok: boolean, detail: string): void {
  jobs.set(name, { running: false, startedAt: 0, finishedAt: Date.now(), ok, detail });
}

/** 启动一个后台任务；同名任务已在跑（且未悬挂）时返回 started:false */
export function startJob(name: string, fn: () => Promise<string>): { started: boolean; state: JobState } {
  const cur = jobs.get(name);
  if (cur?.running && !isStale(cur)) return { started: false, state: cur };

  const state: JobState = { running: true, startedAt: Date.now() };
  jobs.set(name, state);

  void (async () => {
    try {
      const detail = await fn();
      finish(name, true, detail);
      console.log(`[wl-job] ${name} done: ${detail}`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      finish(name, false, detail);
      console.error(`[wl-job] ${name} failed: ${detail}`);
    }
  })();

  return { started: true, state };
}

/**
 * 互斥执行并等待完成：cron 全链路用这个。
 * 同名任务在跑（含 API 手动触发的）→ 返回 skipped，cron 跳过该段，
 * 避免手动采集/蒸馏与每日全链路同时跑造成双写。
 */
export async function runJob(name: string, fn: () => Promise<string>): Promise<{ skipped: boolean; ok: boolean; detail: string }> {
  const cur = jobs.get(name);
  if (cur?.running && !isStale(cur)) {
    return { skipped: true, ok: false, detail: `${name} 被其他任务占用` };
  }
  jobs.set(name, { running: true, startedAt: Date.now() });
  try {
    const detail = await fn();
    finish(name, true, detail);
    return { skipped: false, ok: true, detail };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    finish(name, false, detail);
    return { skipped: false, ok: false, detail };
  }
}

/** 统一的「已启动」响应体 */
export function startedBody(name: string, started: boolean, hint: string) {
  return {
    ok: true,
    started,
    running: true,
    message: started ? `${hint}（后台执行，约 1 分钟，可稍后刷新看结果）` : `上一次「${name}」还在跑，请稍候`,
  };
}
