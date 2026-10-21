import { getDb } from "@/lib/db";
import PageHead from "@/components/PageHead";

export const dynamic = "force-dynamic";

type ItemHit = { id: number; title: string; link: string; tier: number; published_at: string | null };
type AtomHit = { id: number; type: string; statement: string; confidence: number };
type ChainHit = { id: number; title: string; thesis: string; status: string };
type EntityHit = { id: number; name: string; type: string; mention_count: number };

const ATOM_CN: Record<string, string> = {
  mechanism: "机制", pattern: "模式", fact: "硬事实", counterexample: "反例",
  judgment: "判断", question: "开放问题", norm: "潜规则",
};

/** 全站搜索：信息 / 原子 / 链条 / 实体，一次查全 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const kw = (q ?? "").trim();
  const db = getDb();

  let items: ItemHit[] = [];
  let atoms: AtomHit[] = [];
  let chains: ChainHit[] = [];
  let entities: EntityHit[] = [];

  if (kw.length >= 1) {
    const like = `%${kw}%`;
    items = db
      .prepare(
        `SELECT id, title, link, tier, published_at FROM items
         WHERE title LIKE ? OR content LIKE ?
         ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 20`
      )
      .all(like, like) as unknown as ItemHit[];

    atoms = db
      .prepare(
        `SELECT id, type, statement, confidence FROM nuggets
         WHERE status != 'retired' AND (statement LIKE ? OR elaboration LIKE ?)
         ORDER BY confidence DESC LIMIT 15`
      )
      .all(like, like) as unknown as AtomHit[];

    chains = db
      .prepare(
        `SELECT id, title, thesis, status FROM chains
         WHERE title LIKE ? OR thesis LIKE ?
         ORDER BY updated_at DESC LIMIT 10`
      )
      .all(like, like) as unknown as ChainHit[];

    entities = db
      .prepare(
        `SELECT id, name, type, mention_count FROM entities
         WHERE name LIKE ? AND mention_count >= 2
         ORDER BY mention_count DESC LIMIT 15`
      )
      .all(like) as unknown as EntityHit[];
  }

  const total = items.length + atoms.length + chains.length + entities.length;

  return (
    <div>
      <PageHead
        index="11"
        kicker="Search"
        title="搜索"
        desc="一次查全：快讯、认知原子、知识链条、实体档案。"
        aside={<span className="pill">{kw ? `${total} 条结果` : "输入关键词"}</span>}
      />

      <div className="page-body">
        <form action="/search" method="get" className="mb-8">
          <div className="flex items-center gap-3">
            <input
              name="q"
              defaultValue={kw}
              autoFocus
              placeholder="搜公司 / 概念 / 话题，如「半导体」「碳市场」「英伟达」"
              className="flex-1 rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-[14px] outline-none focus:border-[#00b8d4] focus:ring-2 focus:ring-[#00b8d4]/10"
            />
            <button className="btn-solid !py-3">搜索</button>
          </div>
        </form>

        {kw && total === 0 && (
          <div className="empty">
            <p className="text-[15px] font-medium">没有找到「{kw}」</p>
            <p className="text-[13px] text-zinc-500 mt-2">换个关键词，或试试实体名、概念词</p>
          </div>
        )}

        {entities.length > 0 && (
          <section className="mb-10">
            <div className="sec-index mono mb-3">实体档案 · {entities.length}</div>
            <div className="flex flex-wrap gap-2">
              {entities.map((e) => (
                <a
                  key={e.id}
                  href={`/entity/${e.id}`}
                  className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-[13px] text-zinc-700 hover:border-[#00b8d4] hover:text-[#007a8c] transition-colors"
                >
                  {e.name}
                  <span className="mono ml-1.5 text-[10.5px] text-zinc-400 tabular-nums">{e.mention_count}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {chains.length > 0 && (
          <section className="mb-10">
            <div className="sec-index mono mb-3">知识链条 · {chains.length}</div>
            <div className="space-y-2.5">
              {chains.map((c) => (
                <a key={c.id} href={`/chains?id=${c.id}`} className="panel card-in block p-4">
                  <div className="flex items-center gap-2">
                    <span className={`tag ${c.status === "broken" ? "tier-0" : c.status === "resolved" ? "tier-1" : "tier-2"}`}>
                      {c.status === "broken" ? "已断裂" : c.status === "resolved" ? "已验证" : "演进中"}
                    </span>
                    <span className="text-[14px] font-semibold text-zinc-900">{c.title}</span>
                  </div>
                  <p className="mt-1 text-[12.5px] text-zinc-500 line-clamp-1">{c.thesis}</p>
                </a>
              ))}
            </div>
          </section>
        )}

        {atoms.length > 0 && (
          <section className="mb-10">
            <div className="sec-index mono mb-3">认知原子 · {atoms.length}</div>
            <div className="space-y-2.5">
              {atoms.map((a) => (
                <div key={a.id} className="panel p-4">
                  <div className="flex items-center gap-2">
                    <span className="tag tier-2 !text-[10.5px]">{ATOM_CN[a.type] ?? a.type}</span>
                    <span className="mono text-[10.5px] text-zinc-400 tabular-nums">置信 {Math.round(a.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-800">{a.statement}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {items.length > 0 && (
          <section>
            <div className="sec-index mono mb-3">快讯 · {items.length}</div>
            <ul className="panel overflow-hidden">
              {items.map((it) => (
                <li key={it.id} className="row px-5 py-2.5 border-b border-zinc-100 last:border-0">
                  <div className="flex items-start gap-3">
                    <span className={`tag tier-${Math.min(3, it.tier)} shrink-0 mt-0.5`}>T{it.tier}</span>
                    <div className="min-w-0 flex-1">
                      <a href={it.link || "#"} target="_blank" rel="noreferrer" className="text-[13.5px] text-zinc-800 hover:text-[#007a8c] hover:underline">
                        {it.title}
                      </a>
                      <span className="mono ml-2 text-[10.5px] text-zinc-400">{(it.published_at ?? "").slice(0, 10)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
