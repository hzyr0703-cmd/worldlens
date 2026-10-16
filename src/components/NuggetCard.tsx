export const TYPE_STYLE: Record<string, string> = {
  mechanism: "tier-2",       // 蓝
  pattern: "tier-1",         // 橙
  fact: "tier-3",            // 灰
  counterexample: "tier-0",  // 红（最值钱，最高亮）
  judgment: "tier-1",
  question: "tier-2",
  norm: "tier-0",            // 潜规则：红系高亮（最值钱一类）
};

export const TYPE_CN: Record<string, string> = {
  mechanism: "机制", pattern: "模式", fact: "硬事实",
  counterexample: "反例", judgment: "判断", question: "开放问题", norm: "潜规则",
};

const DOMAIN_CN: Record<string, string> = { finance: "财经", ai: "AI", tech: "科技" };

const STATUS_CN: Record<string, string> = {
  active: "", reinforced: "已印证", revised: "已修正", challenged: "受挑战", retired: "已退役",
};

type Nugget = {
  id: number;
  type: string;
  statement: string;
  elaboration: string;
  domain: string;
  confidence: number;
  status: string;
  source_items: string;
  distill_date: string;
};

export default function NuggetCard({ nugget, children }: { nugget: Nugget; children?: React.ReactNode }) {
  const sources = JSON.parse(nugget.source_items ?? "[]") as number[];
  const conf = Math.round(nugget.confidence * 100);
  return (
    <article className="panel p-7 hover:border-zinc-300">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`tag ${TYPE_STYLE[nugget.type] ?? "tier-3"}`}>
          {TYPE_CN[nugget.type] ?? nugget.type}
        </span>
        <span className="mono text-[10px] text-zinc-400">{DOMAIN_CN[nugget.domain] ?? nugget.domain}</span>
        {STATUS_CN[nugget.status] && (
          <span className={`tag ${nugget.status === "challenged" ? "tier-0" : "tier-1"}`}>
            {STATUS_CN[nugget.status]}
          </span>
        )}
        <span className="flex-1" />
        <span className="mono text-[11px] text-zinc-400 tabular-nums">
          置信 {conf}% · 证据 {sources.length} 条 · {nugget.distill_date}
        </span>
      </div>
      <h3 className="text-[15.5px] font-medium leading-[1.6] mt-4 tracking-[-0.008em]">{nugget.statement}</h3>
      {nugget.elaboration && (
        <p className="text-[13.5px] text-zinc-500 leading-[1.75] mt-3">{nugget.elaboration}</p>
      )}
      {children}
    </article>
  );
}
