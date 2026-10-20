import { getDb } from "@/lib/db";
import NuggetCard, { TYPE_CN } from "@/components/NuggetCard";
import NuggetActions from "@/components/NuggetActions";
import PageHead from "@/components/PageHead";
import { listChains } from "@/lib/chain/builder";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

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

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  const { q, type, page } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? "1") || 1);
  const PAGE_SIZE = 30;
  const offset = (pageNum - 1) * PAGE_SIZE;
  const db = getDb();
  const chains = listChains(6);

  let all: Nugget[];
  if (q?.trim()) {
    // 分词后分组检索：trigram 分词器只能 MATCH ≥3 字符的词，
    // 中文常用词多是 2 字（"经济""利率"），短词走 LIKE 兜底，两路合并去重。
    const terms = q.trim().replace(/[，。、：；！？\s]/g, " ").split(" ").filter((w) => w.length >= 1).slice(0, 6);
    const longTerms = terms.filter((t) => t.length >= 3);
    const shortTerms = terms.filter((t) => t.length < 3);
    const seen = new Set<number>();
    const merged: Nugget[] = [];

    if (longTerms.length) {
      const match = longTerms.map((t) => `"${t}"`).join(" OR ");
      const ftsRows = db
        .prepare(
          `SELECT n.* FROM nuggets n JOIN nuggets_fts f ON n.id = f.rowid
           WHERE nuggets_fts MATCH ? AND n.status != 'retired' ORDER BY rank LIMIT 60`
        )
        .all(match) as unknown as Nugget[];
      for (const r of ftsRows) {
        if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
      }
    }
    if (shortTerms.length && merged.length < 60) {
      const like = shortTerms.map(() => `(statement LIKE ? OR elaboration LIKE ?)`).join(" OR ");
      const args = shortTerms.flatMap((t) => [`%${t}%`, `%${t}%`]);
      const likeRows = db
        .prepare(
          `SELECT * FROM nuggets WHERE status != 'retired' AND (${like})
           ORDER BY distill_date DESC, confidence DESC LIMIT 60`
        )
        .all(...args) as unknown as Nugget[];
      for (const r of likeRows) {
        if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
      }
    }
    all = merged;
  } else if (type) {
    all = db
      .prepare(`SELECT * FROM nuggets WHERE type = ? AND status != 'retired' ORDER BY distill_date DESC, confidence DESC`)
      .all(type) as unknown as Nugget[];
  } else {
    all = db
      .prepare(`SELECT * FROM nuggets WHERE status != 'retired' ORDER BY distill_date DESC, confidence DESC`)
      .all() as unknown as Nugget[];
  }

  const counts = db
    .prepare(`SELECT type, COUNT(*) c FROM nuggets WHERE status != 'retired' GROUP BY type`)
    .all() as unknown as { type: string; c: number }[];
  const typeCounts: Record<string, number> = {};
  for (const r of counts) typeCounts[r.type] = r.c;
  const totalCount = counts.reduce((s, r) => s + r.c, 0);

  return (
    <div>
      <PageHead
        index="03"
        kicker="Library"
        title="认知库"
        desc="你的理解资产，随时间复利。每条原子都带着置信度、证据链和被修订的历史。"
        aside={<span className="pill">{totalCount} 枚原子</span>}
      />

        {/* 知识链条（主） */}
        {chains.length > 0 && (
          <div className="mb-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="sec-index mono">00</span>
              <span className="h-px w-8 bg-zinc-300" />
              <span className="sec-index mono uppercase tracking-[0.16em]">Knowledge chains</span>
              <a href="/chains" className="pill ml-auto magnetic !text-[12px]">全部链条 →</a>
            </div>
            <div className="stagger grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {chains.map((c) => (
                <a key={c.id} href={`/chains?id=${c.id}`} className="panel card-in block p-4">
                  <div className="flex items-center gap-2">
                    <span className={`tag !text-[10px] !py-0.5 ${c.status === "broken" ? "tier-0" : "tier-2"}`}>
                      {c.status === "broken" ? "断裂" : "演进中"}
                    </span>
                    <span className="mono text-[10px] text-zinc-400 tabular-nums">{c.stepCount} 环</span>
                  </div>
                  <div className="mt-2 text-[13.5px] font-semibold leading-snug text-zinc-900 line-clamp-2">{c.title}</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500 line-clamp-2">{c.thesis}</p>
                </a>
              ))}
            </div>
            <div className="mt-8 mb-4 flex items-center gap-3">
              <span className="sec-index mono">01</span>
              <span className="h-px w-8 bg-zinc-300" />
              <span className="sec-index mono uppercase tracking-[0.16em]">Atoms · 链条素材</span>
              <span className="text-[12px] text-zinc-400 ml-2">机制/反例/硬事实——链条的砖块</span>
            </div>
          </div>
        )}

        {/* 知识链条（主） */}
        {chains.length > 0 && (
          <div className="mb-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="sec-index mono">00</span>
              <span className="h-px w-8 bg-zinc-300" />
              <span className="sec-index mono uppercase tracking-[0.16em]">Knowledge chains</span>
              <a href="/chains" className="pill ml-auto magnetic !text-[12px]">全部链条 →</a>
            </div>
            <div className="stagger grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {chains.map((c) => (
                <a key={c.id} href={`/chains?id=${c.id}`} className="panel card-in block p-4">
                  <div className="flex items-center gap-2">
                    <span className={`tag !text-[10px] !py-0.5 ${c.status === "broken" ? "tier-0" : "tier-2"}`}>
                      {c.status === "broken" ? "断裂" : "演进中"}
                    </span>
                    <span className="mono text-[10px] text-zinc-400 tabular-nums">{c.stepCount} 环</span>
                  </div>
                  <div className="mt-2 text-[13.5px] font-semibold leading-snug text-zinc-900 line-clamp-2">{c.title}</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500 line-clamp-2">{c.thesis}</p>
                </a>
              ))}
            </div>
            <div className="mt-8 mb-4 flex items-center gap-3">
              <span className="sec-index mono">01</span>
              <span className="h-px w-8 bg-zinc-300" />
              <span className="sec-index mono uppercase tracking-[0.16em]">Atoms · 链条素材</span>
              <span className="text-[12px] text-zinc-400 ml-2">机制/反例/硬事实——链条的砖块</span>
            </div>
          </div>
        )}

      <div className="page-body">
        {/* 搜索 + 类型筛选 */}
        <form action="/library" method="get" className="flex flex-wrap items-center gap-2 mb-8">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索你的原子…"
            className="field !w-auto flex-1 min-w-[200px] !py-2.5"
          />
          <button type="submit" className="ghost magnetic">搜索</button>
          <a href="/library" className={`pill magnetic ${!q && !type ? "pill-active" : ""}`}>全部</a>
          {Object.entries(TYPE_CN).map(([k, cn]) => (
            <a key={k} href={`/library?type=${k}`} className={`pill magnetic ${type === k ? "pill-active" : ""}`}>
              {cn}
              <span className="mono text-[11px] text-zinc-400 tabular-nums">{typeCounts[k] ?? 0}</span>
            </a>
          ))}
        </form>

        {all.length === 0 ? (
          <div className="empty">
            <p className="text-[15px] font-medium">{q ? "没有匹配的原子" : "库还是空的"}</p>
            <p className="text-[13.5px] text-zinc-500 mt-2 max-w-[42ch] mx-auto leading-relaxed">
              {q ? "换个关键词试试，或清除筛选浏览全部。" : "去文章池投一篇长文，让 AI 考你，你答完后原子才会生成。"}
            </p>
            <a href="/inbox" className="btn-solid mt-6 magnetic">去文章池 →</a>
          </div>
        ) : (
          <Reveal variant="stagger">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {all.map((n) => (
                <NuggetCard key={n.id} nugget={n}>
                  <NuggetActions id={n.id} statement={n.statement} />
                </NuggetCard>
              ))}
            </div>
          </Reveal>
        )}

        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-2 mt-8">
            {pageNum > 1 && (
              <a href={`/library?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), page: String(pageNum - 1) })}`} className="pill magnetic">
                ← 上一页
              </a>
            )}
            <span className="mono text-[12px] text-zinc-400 tabular-nums">
              {pageNum} / {Math.ceil(totalCount / PAGE_SIZE)}
            </span>
            {offset + all.length < totalCount && (
              <a href={`/library?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), page: String(pageNum + 1) })}`} className="pill magnetic">
                下一页 →
              </a>
            )}
          </div>
        )}

        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-2 mt-8">
            {pageNum > 1 && (
              <a href={`/library?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), page: String(pageNum - 1) })}`} className="pill magnetic">
                ← 上一页
              </a>
            )}
            <span className="mono text-[12px] text-zinc-400 tabular-nums">
              {pageNum} / {Math.ceil(totalCount / PAGE_SIZE)}
            </span>
            {offset + all.length < totalCount && (
              <a href={`/library?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), page: String(pageNum + 1) })}`} className="pill magnetic">
                下一页 →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
