import { getDb } from "@/lib/db";
import PageHead from "@/components/PageHead";

export const dynamic = "force-dynamic";

type ItemRow = {
  id: number;
  title: string;
  link: string;
  content: string;
  published_at: string | null;
  tier: number;
};

const KINDS = [
  { key: "penalty", label: "监管处罚", cn: "监管处罚", desc: "立案、警示函、罚款——监管动手的痕迹" },
  { key: "bid", label: "招投标", cn: "招投标", desc: "中标与重大合同——订单流向即利益流向" },
  { key: "personnel", label: "人事变动", cn: "人事变动", desc: "辞职、聘任、换届——人走人留前总有信号" },
  { key: "judicial", label: "司法风险", cn: "司法风险", desc: "诉讼、仲裁、被执行、股权冻结" },
  { key: "risk", label: "风险提示", cn: "风险提示", desc: "资金占用、退市风险、违规担保" },
  { key: "deals", label: "关联交易", cn: "关联交易", desc: "关联交易与对外担保——利益输送的常规通道" },
];

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; range?: string; q?: string }>;
}) {
  const { kind, range, q } = await searchParams;
  const rangeDays = range === "1" ? 1 : range === "7" ? 7 : range === "all" ? 3650 : 30;
  const qq = (q ?? "").trim();
  const active = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const db = getDb();

  const where =
    "s.name = '巨潮·公告' AND i.content LIKE ? AND date(COALESCE(i.published_at, i.fetched_at)) >= date('now', ?)" +
    (qq ? " AND i.title LIKE ?" : "");
  const params: (string | number)[] = [`%[${active.cn}]%`, `-${rangeDays} day`];
  if (qq) params.push(`%${qq}%`);
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.link, i.content, i.published_at, i.tier
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE ${where}
       ORDER BY i.published_at DESC, i.id DESC LIMIT 80`
    )
    .all(...params) as unknown as ItemRow[];

  // 公告标题形如 "江丰电子(300666)：..."，抽出公司名映射到实体（用于跳档案）
  const entityMap = new Map<string, { id: number; name: string }>();
  for (const row of db.prepare(`SELECT id, name FROM entities WHERE type = 'company'`).all() as unknown as { id: number; name: string }[]) {
    entityMap.set(row.name, row);
  }
  const entityOf = (title: string) => {
    const m = title.match(/^([^(（]+)[(（]/);
    return m ? entityMap.get(m[1].trim()) ?? null : null;
  };

  const counts = KINDS.map((k) => ({
    ...k,
    n: (
      db
        .prepare(
          `SELECT COUNT(*) c FROM items i JOIN sources s ON s.id = i.source_id
           WHERE s.name = '巨潮·公告' AND i.content LIKE ?`
        )
        .get(`%[${k.cn}]%`) as unknown as { c: number }
    ).c,
  }));

  return (
    <div>
      <PageHead
        index="08"
        kicker="Watch"
        title="监管 · 招投标 · 人事"
        desc="财联社不重点报道、但上市公司必须公告的三类信息——潜规则与利益结构最常在这些地方露头。全部来自巨潮资讯（T0 官方），可点开 PDF 原文。"
        aside={<span className="pill">{rows.length} 条</span>}
      />

      <div className="page-body">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {counts.map((k) => (
            <a
              key={k.key}
              href={`/watch?kind=${k.key}`}
              className={`pill magnetic ${active.key === k.key ? "pill-active" : ""}`}
            >
              {k.label}
              <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">{k.n}</span>
            </a>
          ))}
          <span className="ml-auto text-[12px] text-zinc-400 hidden lg:inline">{active.desc}</span>
        </div>

        {/* 时间范围 + 关键词筛选 */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {[
            { v: "1", l: "今天" },
            { v: "7", l: "7 天" },
            { v: "30", l: "30 天" },
            { v: "all", l: "全部" },
          ].map((r) => {
            const qs = new URLSearchParams({ kind: active.key, range: r.v, ...(qq ? { q: qq } : {}) });
            const on = String(rangeDays) === (r.v === "all" ? "3650" : r.v);
            return (
              <a key={r.v} href={`/watch?${qs}`} className={`pill magnetic ${on ? "pill-active" : ""}`}>
                {r.l}
              </a>
            );
          })}
          <form action="/watch" method="get" className="ml-auto flex items-center gap-2">
            <input type="hidden" name="kind" value={active.key} />
            <input type="hidden" name="range" value={range ?? "30"} />
            <input
              name="q"
              defaultValue={qq}
              placeholder="搜索公司 / 关键词"
              className="w-[180px] rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-[12.5px] outline-none focus:border-[#00b8d4]"
            />
            <button className="pill magnetic">搜索</button>
          </form>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <p className="text-[15px] font-medium">这一类还没有采集到公告</p>
            <p className="mx-auto mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-zinc-500">
              巨潮公告每 20 分钟自动采集一次；也可以在上方点「采集信息」立即拉取。
            </p>
          </div>
        ) : (
          <ul className="panel overflow-hidden">
            {rows.map((it) => (
              <li key={it.id} className="row px-5 py-3.5 border-b border-zinc-100 last:border-0">
                <div className="flex items-start gap-3">
                  <span className={`tag tier-${Math.min(3, it.tier)} shrink-0 mt-0.5`}>T{it.tier}</span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={it.link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13.5px] leading-snug text-zinc-800 hover:text-[#007a8c] hover:underline"
                    >
                      {it.title}
                    </a>
                    {entityOf(it.title) && (
                      <a
                        href={`/entity/${entityOf(it.title)!.id}`}
                        className="ml-2 inline-block rounded-full border border-zinc-200 px-2 py-0.5 text-[10.5px] text-zinc-500 hover:border-[#00b8d4] hover:text-[#007a8c] align-middle"
                      >
                        {entityOf(it.title)!.name} 档案 →
                      </a>
                    )}
                    {entityOf(it.title) && (
                      <a
                        href={`/entity/${entityOf(it.title)!.id}`}
                        className="ml-2 inline-block rounded-full border border-zinc-200 px-2 py-0.5 text-[10.5px] text-zinc-500 hover:border-[#00b8d4] hover:text-[#007a8c] align-middle"
                      >
                        {entityOf(it.title)!.name} 档案 →
                      </a>
                    )}
                    <div className="mono mt-1 text-[11px] text-zinc-400 tabular-nums">
                      {(it.published_at ?? "").slice(0, 16)} · 巨潮 PDF
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
