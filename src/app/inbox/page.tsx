import { getDb } from "@/lib/db";
import PasteArticle from "@/components/PasteArticle";
import BackfillButton from "@/components/BackfillButton";
import PageHead from "@/components/PageHead";
import Reveal from "@/components/Reveal";
import TopicSub from "@/components/TopicSub";

export const dynamic = "force-dynamic";

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  domain: string;
  origin: string;
  word_count: number;
  quizzed: number;
  added_at: string;
};

export default function InboxPage() {
  const db = getDb();
  const articles = db
    .prepare(
      `SELECT a.*,
              (SELECT COUNT(*) FROM quizzes q WHERE q.article_id = a.id) AS quiz_count,
              (SELECT COUNT(*) FROM quizzes q WHERE q.article_id = a.id AND q.state = 'answered') AS answered
       FROM articles a ORDER BY a.id DESC LIMIT 30`
    )
    .all() as unknown as (ArticleRow & { quiz_count: number; answered: number })[];

  // 待补蒸馏的信息积压量（distilled 标记在 items 表上；articles 是粘贴长文，另行处理）
  const pendingDistill = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM items WHERE distilled = 0 AND length(content) >= 800`
      )
      .get() as unknown as { c: number }
  ).c;

  const longItems = db
    .prepare(
      `SELECT id, title, length(content) AS len FROM items
       WHERE length(content) >= 800 AND id NOT IN (SELECT CAST(j.value AS INTEGER) FROM articles a, json_each(a.url) j WHERE 0)
         AND id NOT IN (SELECT CAST(substr(url, 9) AS INTEGER) FROM articles WHERE origin = 'rss' AND url LIKE 'item:%')
       ORDER BY id DESC LIMIT 10`
    )
    .all() as unknown as { id: number; title: string; len: number }[];

  return (
    <div>
      <PageHead
        index="02"
        kicker="Reading"
        title="文章池"
        desc="快讯是背景流，深度长文才是认知原料。全文可读，不做碎片摘要。"
        aside={<span className="pill">{articles.length} 篇</span>}
      />

      <div className="page-body space-y-6">
        <PasteArticle />
        <BackfillButton count={pendingDistill} />

        <TopicSub
          initial={JSON.parse(
            (db.prepare(`SELECT value FROM prefs WHERE key = 'topic_keywords'`).get() as { value: string } | undefined)
              ?.value ?? "[]"
          )}
        />

        {articles.length > 0 && (
          <Reveal variant="rows">
            <ul className="panel overflow-hidden">
              {articles.map((a) => {
                const inProgress = a.quiz_count > 0 && a.answered < a.quiz_count;
                return (
                  <li
                    key={a.id}
                    className="row row-in px-6 py-5 border-b border-zinc-100 last:border-0 flex items-center gap-4"
                  >
                    <span className={`tag shrink-0 ${a.domain === "finance" ? "tier-0" : "tier-2"}`}>
                      {a.domain === "ai" ? "AI" : a.domain === "tech" ? "科技" : "财经"}
                    </span>
                    <a
                      href={`/read/${a.id}`}
                      className="flex-1 min-w-0 truncate text-[15px] font-medium tracking-[-0.01em] hover:text-[#007a8c] transition-colors duration-200"
                      title="点击阅读正文"
                    >
                      {a.title}
                    </a>
                    <span className="mono text-[11px] text-zinc-400 tabular-nums shrink-0">
                      {a.word_count} 字
                    </span>
                    {inProgress ? (
                      <a href={`/quiz/${a.id}`} className="pill !text-[12px] !py-1.5 !px-3 shrink-0 magnetic">
                        继续 {a.answered}/{a.quiz_count}
                      </a>
                    ) : a.quizzed ? (
                      <span className="tag tier-3 shrink-0">已沉淀</span>
                    ) : (
                      <a href={`/read/${a.id}`} className="pill !text-[12px] !py-1.5 !px-3 shrink-0 magnetic">
                        阅读 →
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </Reveal>
        )}

        {longItems.length > 0 && (
          <Reveal variant="rows">
            <div className="panel overflow-hidden">
              <header className="px-6 py-4 border-b border-zinc-100 text-[13px] text-zinc-500">
                采集池长文候选（≥800字）· 点按标题复制正文后手动投喂
              </header>
              <ul>
                {longItems.map((it) => (
                  <li
                    key={it.id}
                    className="row row-in px-6 py-3.5 border-b border-zinc-100 last:border-0 flex items-center gap-3"
                  >
                    <span className="flex-1 min-w-0 truncate text-[13.5px] text-zinc-600">{it.title}</span>
                    <span className="mono text-[11px] text-zinc-400 tabular-nums">{it.len} 字</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        )}
      </div>
    </div>
  );
}
