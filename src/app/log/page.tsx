import { getDb } from "@/lib/db";
import PageHead from "@/components/PageHead";

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
        {logs.length === 0 ? (
          <div className="empty">
            <p className="text-[15px] font-medium">尚无记录</p>
            <p className="text-[13.5px] text-zinc-500 mt-2 max-w-[42ch] mx-auto leading-relaxed">
              完成一轮拷问精读后，你的表述被新信息印证或推翻时，这里会留下痕迹。
            </p>
          </div>
        ) : (
          <ul className="panel overflow-hidden">
            {logs.map((l) => {
              const meta = ACTION_META[l.action] ?? { cn: l.action, cls: "tier-3" };
              return (
                <li
                  key={l.id}
                  className="row px-6 py-5 border-b border-zinc-100 last:border-0"
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
        )}
      </div>
    </div>
  );
}
