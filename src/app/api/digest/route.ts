import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDigest } from "@/lib/digest/daily";
import { isAuthed } from "@/lib/auth";
import { jobState, startJob, startedBody } from "@/lib/background";

export const maxDuration = 300;

/** 简报日期必须是合法的 YYYY-MM-DD 且不能是未来（北京时间口径） */
function validDate(d: string | undefined): string | null {
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const bjToday = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  if (d > bjToday) return null;
  return d;
}

function digestJobs() {
  return {
    build: jobState("digest-build"),
    deep: jobState("digest-deep"),
  };
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const d = validDate(date) ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const db = getDb();

  const existing = db.prepare(`SELECT content, stats, deep FROM digests WHERE date = ?`).get(d) as
    | { content: string; stats: string; deep: number }
    | undefined;

  if (existing) {
    return NextResponse.json({
      date: d,
      content: existing.content,
      stats: existing.stats,
      deep: Boolean(existing.deep),
      cached: true,
      job: digestJobs(),
    });
  }

  // 简报生成是长任务（免费版 30-150 秒、深度版 100-150 秒），网关 60 秒必掐。
  // 无缓存时不再同步构建——返回空内容 + 任务状态，让前端走 POST 触发后台生成。
  if (!isAuthed(req)) {
    return NextResponse.json(
      { ok: false, error: "该日暂无简报，生成需要登录", job: digestJobs() },
      { status: 404 }
    );
  }
  return NextResponse.json({ date: d, content: null, job: digestJobs() });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { date, deep, refresh } = (await req.json().catch(() => ({}))) as {
    date?: string;
    deep?: boolean;
    refresh?: boolean;
  };
  const d = validDate(date ?? undefined) ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  try {
    // 当日已有简报就直接返回：生成是长任务，是这个按钮最容易"点了没反应"的原因。
    // 需要重写时传 refresh:true（或走 deep 深度版）。
    if (!refresh && !deep) {
      const existing = getDb().prepare(`SELECT content FROM digests WHERE date = ?`).get(d) as
        | { content: string }
        | undefined;
      if (existing?.content) {
        return NextResponse.json({ date: d, content: existing.content, model: "cached", cached: true });
      }
    }
    // 一律后台跑（免费版 30-150 秒 / 深度版 100-150 秒，都超网关 60 秒上限），
    // 前端轮询 GET /api/digest 里的 job 字段看进度
    if (deep) {
      const { started } = startJob("digest-deep", async () => {
        const built = await buildDigest(d, { deep: true });
        return `深度简报 ${built.content.length} 字`;
      });
      return NextResponse.json(startedBody("深度简报", started, "深度简报已启动"));
    }
    const { started } = startJob("digest-build", async () => {
      const built = await buildDigest(d, { deep: false });
      return `简报 ${built.content.length} 字`;
    });
    return NextResponse.json(startedBody("简报生成", started, "简报生成已启动"));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
