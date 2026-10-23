import { getDb } from "@/lib/db";
import { maskIp, visitStats } from "@/lib/visits";
import PageHead from "@/components/PageHead";

export const dynamic = "force-dynamic";

type RunRow = { run_date: string; ok: number; detail: string; ms: number; created_at: string };
type SourceRow = { name: string; tier: number; enabled: number; last_fetch: string | null; item_count: number };

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

/** 系统健康 —— 采集 / 蒸馏 / 链条 / 简报 / LLM 的实时运转状态 */
export default async function StatusPage() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const runs = db
    .prepare(`SELECT run_date, ok, detail, ms, created_at FROM cron_log ORDER BY id DESC LIMIT 10`)
    .all() as unknown as RunRow[];

  const sources = db
    .prepare(
      `SELECT s.name, s.tier, s.enabled,
              (SELECT MAX(fetched_at) FROM items i WHERE i.source_id = s.id) AS last_fetch,
              (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id) AS item_count
       FROM sources s ORDER BY s.tier, s.name`
    )
    .all() as unknown as SourceRow[];

  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM items) AS items,
        (SELECT COUNT(*) FROM items WHERE date(COALESCE(published_at, fetched_at)) = date('now')) AS items_today,
        (SELECT COUNT(*) FROM items WHERE distilled = 0) AS backlog,
        (SELECT COUNT(*) FROM claims) AS claims,
        (SELECT COUNT(*) FROM nuggets WHERE status != 'retired') AS atoms,
        (SELECT COUNT(*) FROM nugget_links) AS links,
        (SELECT COUNT(*) FROM chains) AS chains,
        (SELECT COUNT(*) FROM chain_steps) AS steps,
        (SELECT COUNT(*) FROM chain_steps WHERE role = 'verify' AND verify_by >= date('now')) AS verify_valid,
        (SELECT COUNT(*) FROM nuggets n WHERE n.status != 'retired'
           AND NOT EXISTS (SELECT 1 FROM nugget_links l WHERE l.src_id = n.id OR l.dst_id = n.id)) AS orphans,
        (SELECT COUNT(*) FROM entities) AS entities,
        (SELECT COUNT(*) FROM articles) AS articles,
        (SELECT COUNT(*) FROM review_cards WHERE due <= datetime('now')) AS due,
        (SELECT COUNT(*) FROM digests) AS briefs,
        (SELECT MAX(date) FROM digests) AS last_brief`
    )
    .get() as unknown as Record<string, number | string>;

  const llm = db
    .prepare(
      `SELECT purpose, model, COUNT(*) n, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) fails, ROUND(AVG(ms)) avg_ms
       FROM llm_log WHERE date(created_at) = date('now') GROUP BY purpose, model ORDER BY n DESC LIMIT 8`
    )
    .all() as unknown as { purpose: string; model: string; n: number; fails: number; avg_ms: number }[];

  const llmTotal = llm.reduce((s, x) => s + num(x.n), 0);
  const llmFails = llm.reduce((s, x) => s + num(x.fails), 0);

  // 健康灯只看「近 2 小时」——今日累计会把已经修好的历史故障一直挂在红灯上
  const recent = db
    .prepare(
      `SELECT COUNT(*) n, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) fails
       FROM llm_log WHERE created_at >= datetime('now', '-2 hours')`
    )
    .get() as unknown as { n: number; fails: number | null };
  const recentOk = num(recent.n) === 0 || num(recent.fails) / num(recent.n) < 0.15;

  // 最近 7 天 cron 是否都成功
  const last7 = db
    .prepare(
      `SELECT date('now', '-' || d || ' day') AS day FROM (SELECT 0 d UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6)`
    )
    .all() as unknown as { day: string }[];
  const runDays = new Set(runs.filter((r) => r.ok === 1).map((r) => r.run_date));
  const coverage = last7.map((d) => ({ day: d.day, ok: runDays.has(d.day) }));

  const vs = visitStats();
  const maxDayPv = Math.max(1, ...vs.days.map((d) => d.pv));
  const maxPathPv = Math.max(1, ...vs.topPaths.map((p) => p.pv));

  const health = [
    {
      label: "采集",
      value: `${num(counts.items_today)} 条今日`,
      note: `共 ${num(counts.items)} 条 · 每 20 分钟一轮`,
      ok: num(counts.items_today) > 0,
    },
    {
      label: "蒸馏",
      value: `积压 ${num(counts.backlog)}`,
      note: `原子 ${num(counts.atoms)} · 连边 ${num(counts.links)} · 孤立 ${num(counts.orphans)}`,
      ok: num(counts.backlog) < 1500,
    },
    {
      label: "链条",
      value: `${num(counts.chains)} 条`,
      note: `${num(counts.steps)} 环 · 有效验证点 ${num(counts.verify_valid)}`,
      ok: num(counts.chains) > 0,
    },
    {
      label: "简报",
      value: counts.last_brief === today ? "今日已生成" : `最新 ${counts.last_brief}`,
      note: `共 ${num(counts.briefs)} 期 · 每小时检查重算`,
      ok: String(counts.last_brief) === today,
    },
    {
      label: "LLM",
      value: num(recent.n) === 0 ? "近 2 小时无调用" : `${num(recent.n)} 次 / 失败 ${num(recent.fails)}`,
      note: `近 2 小时 · 今日累计 ${llmTotal} 次（失败 ${llmFails}，含修复前历史）`,
      ok: recentOk,
    },
    {
      label: "自动运行",
      value: `${coverage.filter((c) => c.ok).length}/7 天`,
      note: "每日全链路 cron 成功记录",
      ok: coverage.filter((c) => c.ok).length >= 5,
    },
  ];

  return (
    <div>
      <PageHead
        index="13"
        kicker="System health"
        title="系统运转"
        desc="引擎是否还活着：采集、蒸馏、链条、简报、模型调用的实时状态。"
      />

      <div className="page-body">
        <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {health.map((h) => (
            <div key={h.label} className="panel p-5">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${h.ok ? "bg-[#2E9E5B]" : "bg-[#d92b3c]"}`} />
                <span className="text-[12px] font-semibold tracking-wide text-zinc-500">{h.label}</span>
              </div>
              <div className="mt-2 text-[19px] font-semibold tracking-[-0.02em] tabular-nums">{h.value}</div>
              <div className="mt-1 text-[12px] text-zinc-400">{h.note}</div>
            </div>
          ))}
        </div>

        {coverage.filter((c) => c.ok).length < 5 && (
          <div className="mt-6 rounded-xl border border-[#f0e0c0] bg-[#fdf8ef] px-4 py-3 text-[12.5px] leading-relaxed text-[#8a5a08]">
            <span className="font-semibold">自动运行覆盖不足</span>：近 7 天只有{' '}
            {coverage.filter((c) => c.ok).length} 天跑过完整链路。云实例在无人访问时会休眠，休眠期间定时任务不触发；
            唤醒后 60 秒内会自动补跑当日链路，因此数据断档不会超过一次访问间隔。
          </div>
        )}

        {/* 访问统计 */}
        <div className="mt-10 panel p-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <div className="sec-index mono">访问 · 有多少人来过</div>
            <span className="text-[11.5px] text-zinc-400">按 IP 去重 · 预取请求不计 · 公开页只展示掩码 IP</span>
          </div>

          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "累计访客（独立 IP）", v: vs.uniqueTotal, note: "开站以来" },
              { label: "今日访客", v: vs.uniqueToday, note: "北京时间今天" },
              { label: "累计浏览（PV）", v: vs.pvTotal, note: "所有页面请求" },
              { label: "今日浏览", v: vs.pvToday, note: "北京时间今天" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4">
                <div className="text-[11.5px] font-medium text-zinc-500">{x.label}</div>
                <div className="mt-1 text-[24px] font-semibold tracking-[-0.02em] tabular-nums">{x.v}</div>
                <div className="text-[11px] text-zinc-400">{x.note}</div>
              </div>
            ))}
          </div>

          {vs.days.length > 0 && (
            <div className="mt-6">
              <div className="text-[12px] font-medium text-zinc-500">近 7 天（每日 PV，条上标独立 IP）</div>
              <div className="mt-3 flex items-end gap-2 h-24">
                {[...vs.days].reverse().map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                    <span className="mono text-[10px] text-zinc-400 tabular-nums">{d.ips}</span>
                    <div
                      className="w-full rounded-t bg-[#00b8d4]/70 min-h-[3px]"
                      style={{ height: `${Math.max(4, (d.pv / maxDayPv) * 64)}px` }}
                      title={`${d.day} · ${d.pv} 次浏览 / ${d.ips} 个 IP`}
                    />
                    <span className="mono text-[9.5px] text-zinc-400">{d.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-zinc-100 pt-4">
            <div>
              <div className="text-[12px] font-medium text-zinc-500 mb-2">最常被看的页面</div>
              {vs.topPaths.length === 0 ? (
                <p className="text-[13px] text-zinc-400">还没有记录</p>
              ) : (
                <div className="space-y-1.5">
                  {vs.topPaths.map((p) => (
                    <div key={p.path} className="flex items-center gap-2 text-[12px]">
                      <span className="mono text-zinc-600 w-[110px] truncate">{p.path}</span>
                      <div className="flex-1 h-2 rounded bg-zinc-100 overflow-hidden">
                        <div className="h-full bg-[#00b8d4]/60" style={{ width: `${(p.pv / maxPathPv) * 100}%` }} />
                      </div>
                      <span className="mono text-zinc-400 tabular-nums shrink-0">{p.pv}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[12px] font-medium text-zinc-500 mb-2">最近来访（IP 已掩码）</div>
              {vs.recent.length === 0 ? (
                <p className="text-[13px] text-zinc-400">还没有记录</p>
              ) : (
                <div className="space-y-1.5">
                  {vs.recent.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]">
                      <span className="mono text-zinc-500 w-[110px] shrink-0">{maskIp(r.ip)}</span>
                      <span className="mono text-zinc-400 text-[10.5px] w-[82px] shrink-0">{r.ts.slice(5, 16)}</span>
                      <span className="text-zinc-600 flex-1 truncate">{r.path}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="panel p-6">
            <div className="sec-index mono mb-3">最近 10 次自动运行</div>
            {runs.length === 0 ? (
              <p className="text-[13px] text-zinc-500">暂无记录</p>
            ) : (
              <div className="space-y-2">
                {runs.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 text-[12.5px]">
                    <span className={`tag ${r.ok ? "tier-2" : "tier-0"} shrink-0`}>{r.ok ? "成功" : "失败"}</span>
                    <span className="mono text-zinc-400 shrink-0">{r.run_date}</span>
                    <span className="text-zinc-600 flex-1 truncate">{r.detail}</span>
                    <span className="mono text-zinc-400 shrink-0 tabular-nums">{Math.round(num(r.ms) / 1000)}s</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-zinc-100">
              <span className="text-[11.5px] text-zinc-400">近 7 天覆盖：</span>
              {coverage.map((c) => (
                <span
                  key={c.day}
                  title={c.day}
                  className={`ml-1 inline-block h-2.5 w-2.5 rounded-sm ${c.ok ? "bg-[#2E9E5B]" : "bg-zinc-200"}`}
                />
              ))}
            </div>
          </div>

          <div className="panel p-6">
            <div className="sec-index mono mb-3">今日模型调用（累计，含修复前历史失败）</div>
            {llm.length === 0 ? (
              <p className="text-[13px] text-zinc-500">今日暂无调用</p>
            ) : (
              <div className="space-y-1.5">
                {llm.map((x, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="mono text-zinc-600 w-[100px] truncate">{x.purpose}</span>
                    <span className="mono text-zinc-400 w-[90px] truncate">{x.model}</span>
                    <span className="mono text-zinc-500 tabular-nums w-10 text-right">{x.n}</span>
                    <span className={`mono tabular-nums w-10 text-right ${num(x.fails) > 0 ? "text-[#d92b3c]" : "text-zinc-300"}`}>
                      {num(x.fails)}
                    </span>
                    <span className="mono text-zinc-300 tabular-nums ml-auto">{num(x.avg_ms)}ms</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-zinc-100 text-[11.5px] text-zinc-400">
              列依次为：用途 · 模型 · 次数 · 失败 · 平均耗时
            </div>
          </div>
        </div>

        <div className="mt-10">
          <div className="sec-index mono mb-3">信源状态</div>
          <div className="panel overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[11px] text-zinc-400">
                  <th className="px-4 py-2 font-normal">信源</th>
                  <th className="px-4 py-2 font-normal">等级</th>
                  <th className="px-4 py-2 font-normal text-right">累计</th>
                  <th className="px-4 py-2 font-normal text-right">最近采集</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.name} className="border-b border-zinc-50 last:border-0">
                    <td className="px-4 py-2 text-zinc-700">
                      {s.name}
                      {s.enabled === 0 && <span className="ml-2 text-[10.5px] text-zinc-400">停用</span>}
                    </td>
                    <td className="px-4 py-2 mono text-zinc-400">T{s.tier}</td>
                    <td className="px-4 py-2 mono text-right tabular-nums text-zinc-600">{num(s.item_count)}</td>
                    <td className="px-4 py-2 mono text-right text-zinc-400">{(s.last_fetch ?? "—").slice(5, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
