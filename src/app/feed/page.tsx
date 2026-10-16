import { getDb } from "@/lib/db";
import PageHead from "@/components/PageHead";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

type ItemRow = {
  id: number;
  title: string;
  tier: number;
  published_at: string | null;
  distilled: number;
  name: string;
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? "1") || 1);
  const pageSize = 60;
  const db = getDb();

  const total = (db.prepare(`SELECT COUNT(*) c FROM items`).get() as unknown as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.tier, i.published_at, i.distilled, s.name
       FROM items i JOIN sources s ON s.id = i.source_id
       ORDER BY i.id DESC LIMIT ? OFFSET ?`
    )
    .all(pageSize, (pageNum - 1) * pageSize) as unknown as ItemRow[];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHead
        index="07"
        kicker="Raw feed"
        title="快讯背景流"
        desc="采集层抓到的全部原始信息——蒸馏的原料库。带「已蒸」标记的条目已参与过认知蒸馏。"
        aside={<span className="pill">{total} 条</span>}
      />

      <div className="page-body">
        <Reveal variant="rows">
          <ul className="panel overflow-hidden">
            {rows.map((it) => (
              <li key={it.id} className="row row-in px-6 py-3.5 border-b border-zinc-100 last:border-0 flex items-center gap-3">
                <span className={`tag tier-${Math.min(3, Math.max(0, it.tier))}`}>T{it.tier}</span>
                <span className="flex-1 min-w-0 truncate text-[13.5px] text-zinc-700">{it.title}</span>
                <span className="mono text-[11px] text-zinc-400 shrink-0 hidden sm:block">{it.name}</span>
                {it.distilled ? <span className="tag tier-2 shrink-0">已蒸</span> : null}
                <span className="mono text-[11px] text-zinc-400 tabular-nums shrink-0">
                  {(it.published_at ?? "").slice(5, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            {pageNum > 1 && (
              <a href={`/feed?page=${pageNum - 1}`} className="pill magnetic">← 上一页</a>
            )}
            <span className="mono text-[12px] text-zinc-400 tabular-nums">
              {pageNum} / {pages}
            </span>
            {pageNum < pages && (
              <a href={`/feed?page=${pageNum + 1}`} className="pill magnetic">下一页 →</a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
