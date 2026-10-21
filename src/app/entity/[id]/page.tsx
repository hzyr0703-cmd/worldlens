import { getDb } from "@/lib/db";
import PageHead from "@/components/PageHead";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type EntityRow = { id: number; name: string; type: string; mention_count: number };
type ItemRow = { id: number; title: string; link: string; tier: number; published_at: string | null; polarity: string | null };
type ChainRow = { id: number; title: string; status: string; claim: string };
type AtomRow = { id: number; type: string; statement: string; confidence: number; status: string };

const TYPE_CN: Record<string, string> = {
  macro: "宏观", company: "公司", person: "人物", concept: "概念", region: "地区",
};

const ATOM_CN: Record<string, string> = {
  mechanism: "机制", pattern: "模式", fact: "硬事实",
  counterexample: "反例", judgment: "判断", question: "开放问题", norm: "潜规则",
};

/** 实体档案 —— 一个主体在世界理解系统里的全部痕迹 */
export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const eid = Number(id);
  if (!Number.isFinite(eid)) notFound();

  const db = getDb();
  const entity = db.prepare(`SELECT id, name, type, mention_count FROM entities WHERE id = ?`).get(eid) as unknown as EntityRow | undefined;
  if (!entity) notFound();

  const active = ["news", "filings", "chains", "atoms"].includes(tab ?? "") ? tab! : "news";

  // 近期信息（含多空倾向）
  const news = db
    .prepare(
      `SELECT i.id, i.title, i.link, i.tier, i.published_at, c.polarity
       FROM claims c JOIN items i ON i.id = c.item_id
       WHERE c.entity_id = ?
       ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT 40`
    )
    .all(eid) as unknown as ItemRow[];

  // 公告（该实体的公司公告，标题含实体名或 claims 命中）
  const filings = db
    .prepare(
      `SELECT i.id, i.title, i.link, i.tier, i.published_at, '' AS polarity
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE s.name = '巨潮·公告' AND (i.title LIKE ? OR i.id IN (SELECT item_id FROM claims WHERE entity_id = ?))
       ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT 40`
    )
    .all(`%${entity.name}%`, eid) as unknown as ItemRow[];

  // 关联链条（链条环节的溯源信息里包含该实体的信息）
  const chains = db
    .prepare(
      `SELECT DISTINCT c.id, c.title, c.status, s.claim
       FROM chain_steps s JOIN chains c ON c.id = s.chain_id
       WHERE s.item_ids LIKE '%' || ? || '%'
          OR s.claim LIKE ?
       ORDER BY c.updated_at DESC LIMIT 20`
    )
    .all(`,${eid},`, `%${entity.name}%`) as unknown as ChainRow[];

  // 相关原子（statement 含实体名）
  const atoms = db
    .prepare(
      `SELECT id, type, statement, confidence, status FROM nuggets
       WHERE status != 'retired' AND statement LIKE ?
       ORDER BY confidence DESC LIMIT 30`
    )
    .all(`%${entity.name}%`) as unknown as AtomRow[];

  // 共现邻居（图谱）
  const neighbors = db
    .prepare(
      `SELECT e.id, e.name, e.type, ed.weight
       FROM edges ed
       JOIN entities e ON e.id = CASE WHEN ed.src_id = ? THEN ed.dst_id ELSE ed.src_id END
       WHERE (ed.src_id = ? OR ed.dst_id = ?) AND ed.relation = 'co_mention'
       ORDER BY ed.weight DESC LIMIT 12`
    )
    .all(eid, eid, eid) as unknown as { id: number; name: string; type: string; weight: number }[];

  const TABS = [
    { key: "news", label: "信息", n: news.length },
    { key: "filings", label: "公告", n: filings.length },
    { key: "chains", label: "链条", n: chains.length },
    { key: "atoms", label: "原子", n: atoms.length },
  ];

  return (
    <div>
      <PageHead
        index="10"
        kicker="Entity profile"
        title={entity.name}
        desc={`${TYPE_CN[entity.type] ?? entity.type} · 累计提及 ${entity.mention_count} 次 · 这个主体在本系统里的全部痕迹`}
        aside={<a href="/graph" className="pill magnetic">图谱 →</a>}
      />

      <div className="page-body">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <a
              key={t.key}
              href={`/entity/${eid}?tab=${t.key}`}
              className={`pill magnetic ${active === t.key ? "pill-active" : ""}`}
            >
              {t.label}
              <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">{t.n}</span>
            </a>
          ))}
          {neighbors.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5 overflow-x-auto max-w-[60%]">
              <span className="text-[11px] text-zinc-400 shrink-0">常一起出现：</span>
              {neighbors.slice(0, 6).map((n) => (
                <a
                  key={n.id}
                  href={`/entity/${n.id}`}
                  className="shrink-0 rounded-full border border-zinc-200 px-2.5 py-0.5 text-[11.5px] text-zinc-600 hover:border-[#00b8d4] hover:text-[#007a8c]"
                >
                  {n.name}
                </a>
              ))}
            </span>
          )}
        </div>

        {active === "news" && (
          <ul className="panel overflow-hidden">
            {news.length === 0 && <li className="p-8 text-center text-[13px] text-zinc-500">暂无关联信息</li>}
            {news.map((it) => (
              <li key={`${it.id}-${it.polarity}`} className="row px-5 py-3 border-b border-zinc-100 last:border-0">
                <div className="flex items-start gap-3">
                  <span className={`tag tier-${Math.min(3, it.tier)} shrink-0 mt-0.5`}>T{it.tier}</span>
                  {it.polarity === "bullish" && <span className="text-[11px] text-[#046c4e] shrink-0 mt-1">▲</span>}
                  {it.polarity === "bearish" && <span className="text-[11px] text-[#b4232f] shrink-0 mt-1">▼</span>}
                  <div className="min-w-0 flex-1">
                    <a href={it.link || "#"} target="_blank" rel="noreferrer" className="text-[13.5px] leading-snug text-zinc-800 hover:text-[#007a8c] hover:underline">
                      {it.title}
                    </a>
                    <div className="mono mt-0.5 text-[11px] text-zinc-400">{(it.published_at ?? "").slice(0, 16)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {active === "filings" && (
          <ul className="panel overflow-hidden">
            {filings.length === 0 && <li className="p-8 text-center text-[13px] text-zinc-500">暂无公告（该主体可能不是上市公司）</li>}
            {filings.map((it) => (
              <li key={it.id} className="row px-5 py-3 border-b border-zinc-100 last:border-0">
                <div className="flex items-start gap-3">
                  <span className="tag tier-0 shrink-0 mt-0.5">T0</span>
                  <div className="min-w-0 flex-1">
                    <a href={it.link} target="_blank" rel="noreferrer" className="text-[13.5px] leading-snug text-zinc-800 hover:text-[#007a8c] hover:underline">
                      {it.title}
                    </a>
                    <div className="mono mt-0.5 text-[11px] text-zinc-400">{(it.published_at ?? "").slice(0, 16)} · 巨潮 PDF</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {active === "chains" && (
          <div className="space-y-3">
            {chains.length === 0 && <div className="panel p-8 text-center text-[13px] text-zinc-500">暂无关联链条</div>}
            {chains.map((c) => (
              <a key={c.id} href={`/chains?id=${c.id}`} className="panel card-in block p-5">
                <div className="flex items-center gap-2">
                  <span className={`tag ${c.status === "broken" ? "tier-0" : c.status === "resolved" ? "tier-1" : "tier-2"}`}>
                    {c.status === "broken" ? "已断裂" : c.status === "resolved" ? "已验证" : "演进中"}
                  </span>
                </div>
                <div className="mt-2 text-[14.5px] font-semibold text-zinc-900">{c.title}</div>
                <p className="mt-1 text-[12.5px] text-zinc-500 line-clamp-2">{c.claim}</p>
              </a>
            ))}
          </div>
        )}

        {active === "atoms" && (
          <div className="space-y-3">
            {atoms.length === 0 && <div className="panel p-8 text-center text-[13px] text-zinc-500">暂无相关原子</div>}
            {atoms.map((a) => (
              <div key={a.id} className="panel p-5">
                <div className="flex items-center gap-2">
                  <span className="tag tier-2 !text-[10.5px]">{ATOM_CN[a.type] ?? a.type}</span>
                  <span className="mono text-[10.5px] text-zinc-400 tabular-nums">置信 {Math.round(a.confidence * 100)}%</span>
                  {a.status === "challenged" && <span className="tag tier-0 !text-[10.5px]">受挑战</span>}
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-800">{a.statement}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
