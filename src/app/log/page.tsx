import { getDb } from "@/lib/db";
import { llmStatsMonthly } from "@/lib/extract/llm";
import PageHead from "@/components/PageHead";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

type LogRow = {
  id: number;
  nugget_id: number;
  action: string;
  detail: string;
  batch_date: string;
  created_at: string;
};

const ACTION_META: Record<string, { cn: string; cls: string }> = {
  created: { cn: "新增", cls: "tier-2" },
  reinforced: { cn: "印证 ↑", cls: "tier-1" },
  revised: { cn: "修正", cls: "tier-0" },
  challenged: { cn: "受挑战 ⚡", cls: "tier-0" },
};

export default function LogPage() {
  const db = getDb();
  const logs = db
    .prepare(
      `SELECT w.*, n.statement AS nugget_statement, n.type
       FROM worldview_log w LEFT JOIN nuggets n ON n.id = w.nugget_id
       ORDER BY w.id DESC LIMIT 100`
    )
    .all() as unknown as (LogRow & { nugget_statement: string | null; type: string })[];

  return (
    <div>
      <PageHead
        index="05"
        kicker="Worldview log"
        title="你的判断，被哪条新信息校准过"
        desc="何物 · 何时 · 因何被印证、修正或推翻。这是认知复利唯一可审计的痕迹。"
        aside={<span className="pill">{logs.length} 条记录</span>}
      />

      <div className="page-body">
        {/* LLM 用量（近 30 天）：调用分布 + 失败率，成本感知 */}
        {(() => {
          const m = llmStatsMonthly();
          if (m.length === 0) return null;
          const total = m.reduce((s, x) => s + x.calls, 0);
          const fails = m.reduce((s, x) => s + x.fails, 0);
          return (
            <div className="panel p-6 mb-8 reveal">
              <div className="flex items-baseline justify-between">
                <span className="sec-index mono">LLM · 近 30 天</span>
                <span className="mono text-[11px] text-zinc-400 tabular-nums">
                  共 {total} 次 · 失败 {fails} 次（{total ? Math.round((fails / total) * 100) : 0}%）
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {m.map((x) => (
                  <div key={x.purpose} className="flex items-center gap-3 text-[12.5px]">
                    <span className="mono w-28 shrink-0 truncate text-zinc-500">{x.purpose}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#00b8d4]/60"
                        style={{ width: `${Math.max(2, Math.round((x.calls / total) * 100))}%` }}
                      />
                    </div>
                    <span className="mono tabular-nums text-zinc-600 w-14 text-right">{x.calls} 次</span>
                    <span className="mono tabular-nums text-zinc-400 w-16 text-right">≈{x.avgMs}ms</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {logs.length === 0 ? (
          <div className="empty">
            <p className="text-[15px] font-medium">尚无记录</p>
            <p className="text-[13.5px] text-zinc-500 mt-2 max-w-[42ch] mx-auto leading-relaxed">
              完成一轮拷问精读后，你的表述被新信息印证或推翻时，这里会留下痕迹。
            </p>
          </div>
        ) : (
          <Reveal variant="rows">
            <ul className="panel overflow-hidden">
              {logs.map((l) => {
                const meta = ACTION_META[l.action] ?? { cn: l.action, cls: "tier-3" };
                return (
                  <li
                    key={l.id}
                    className="row row-in px-6 py-5 border-b border-zinc-100 last:border-0"
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className={`tag ${meta.cls}`}>{meta.cn}</span>
                      <span className="mono text-[11px] text-zinc-400 tabular-nums">
                        {l.batch_date}
                      </span>
                    </div>
                    {l.nugget_statement && (
                      <p className="text-[14px] font-medium leading-snug mt-2.5 tracking-[-0.008em]">
                        {l.nugget_statement}
                      </p>
                    )}
                    <p className="text-[13px] text-zinc-500 leading-relaxed mt-2">{l.detail}</p>
                  </li>
                );
              })}
            </ul>
          </Reveal>
        )}
      </div>
    </div>
  );
}
