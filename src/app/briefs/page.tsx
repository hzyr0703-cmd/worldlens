import { getDb } from "@/lib/db";
import PageHead from "@/components/PageHead";
import DigestFold from "@/components/DigestFold";
import { renderMarkdown } from "@/lib/md";

export const dynamic = "force-dynamic";

type DigestRow = { date: string; content: string; stats: string; created_at: string };

/** 简报历史 —— 回看任何一天世界被理解成什么样 */
export default async function BriefsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const db = getDb();

  const list = db
    .prepare(`SELECT date, content, stats, created_at FROM digests ORDER BY date DESC LIMIT 60`)
    .all() as unknown as DigestRow[];

  const active = date ? list.find((d) => d.date === date) : list[0];

  return (
    <div>
      <PageHead
        index="12"
        kicker="Brief archive"
        title="简报存档"
        desc="每一天世界被理解成什么样，都留在档案里。"
        aside={<a href="/" className="pill magnetic">今日 →</a>}
      />

      <div className="page-body">
        {list.length === 0 ? (
          <div className="empty">
            <p className="text-[15px] font-medium">还没有简报</p>
            <p className="text-[13px] text-zinc-500 mt-2">每日 08:00 自动生成</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-3">
              <div className="panel overflow-hidden">
                {list.map((d) => {
                  const firstLine =
                    d.content
                      .split("\n")
                      .find((l) => l.startsWith("-") && l.length > 10)
                      ?.replace(/^-\s*/, "")
                      .slice(0, 40) ?? "";
                  return (
                    <a
                      key={d.date}
                      href={`/briefs?date=${d.date}`}
                      className={`block px-4 py-3 border-b border-zinc-100 last:border-0 ${
                        active?.date === d.date ? "bg-[#f2fafb]" : "hover:bg-zinc-50"
                      }`}
                    >
                      <div className="mono text-[12px] text-zinc-800 tabular-nums">{d.date}</div>
                      <div className="mt-0.5 text-[11.5px] text-zinc-400 line-clamp-1">{firstLine}</div>
                    </a>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-9">
              {active && (
                <div className="panel p-6 sm:p-8">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[12px] text-zinc-500 tabular-nums">{active.date}</span>
                    <span className="mono text-[10.5px] text-zinc-400">
                      {(() => {
                        try {
                          const s = JSON.parse(active.stats) as { items?: number; claims?: number };
                          return `${s.items ?? 0} 条信息 / ${s.claims ?? 0} 条主张`;
                        } catch {
                          return "";
                        }
                      })()}
                    </span>
                  </div>
                  <div className="mt-4">
                    <DigestFold
                      summaryHtml={renderMarkdown(
                        (() => {
                          const m = active.content.match(/## 今日主线([\s\S]*?)(?=\n## |$)/);
                          const bullets = m
                            ? m[1].trim().split("\n").filter((l) => l.trim().startsWith("-")).slice(0, 3)
                            : [];
                          return bullets.length ? bullets.join("\n") : active.content.slice(0, 400);
                        })()
                      )}
                      fullHtml={renderMarkdown(active.content)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
