import { getDb } from "@/lib/db";
import GenerateQuizButton from "@/components/GenerateQuizButton";
import SplitText from "@/components/SplitText";

export const dynamic = "force-dynamic";

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const article = db
    .prepare(`SELECT id, title, url, body, original_body, domain, word_count, quizzed FROM articles WHERE id = ?`)
    .get(Number(id)) as unknown as
    | { id: number; title: string; url: string; body: string; original_body: string; domain: string; word_count: number; quizzed: number }
    | undefined;

  if (!article) {
    return <div className="empty">文章不存在</div>;
  }

  const quizCount = (
    db.prepare(`SELECT COUNT(*) n FROM quizzes WHERE article_id = ?`).get(article.id) as unknown as { n: number }
  ).n;

  return (
    <div className="max-w-[720px] mx-auto">
      <a
        href="/inbox"
        className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors duration-150"
      >
        <span className="hover:translate-x-[-2px] transition-transform duration-150 inline-block">←</span>
        文章池
      </a>

      <header className="page-head relative mt-8">
        <div className="grid-veil pointer-events-none absolute inset-x-0 -top-6 h-[220px]" aria-hidden />
        <div className="relative">
          <div className="wipe flex items-center gap-2.5" style={{ ["--d" as string]: "200ms" }}>
            <span className={`tag ${article.domain === "finance" ? "tier-0" : "tier-2"}`}>
              {article.domain === "ai" ? "AI" : article.domain === "tech" ? "科技" : "财经"}
            </span>
            <span className="mono text-[11px] text-zinc-400 tabular-nums">
              {article.word_count} 字
            </span>
          </div>
          <h1 className="text-[30px] sm:text-[38px] font-semibold leading-[1.14] tracking-[-0.032em] mt-5">
            <SplitText text={article.title} />
          </h1>
          {article.url && (
            <a
              href={article.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] text-[#007a8c] hover:underline break-all"
            >
              原文链接 ↗
            </a>
          )}
        </div>
      </header>

      <article className="page-body mt-10">
        <div className="read-body">{article.body}</div>
        {(article.original_body ?? "").trim().length > 0 && (
          <details className="mt-10 border-t border-zinc-200 pt-6 group">
            <summary className="cursor-pointer text-[13.5px] text-zinc-500 hover:text-zinc-900 transition-colors select-none">
              查看未删减原文（{article.original_body.length} 字 · 与压缩版对照，确认要点无遗漏）
            </summary>
            <div className="read-body mt-6 !text-[15px] !leading-[1.85] opacity-75">{article.original_body}</div>
          </details>
        )}
      </article>

      <div className="mt-14 flex flex-wrap items-center justify-between gap-5 panel px-7 py-6 card-in">
        <div>
          <div className="text-[15px] font-medium">读完了？</div>
          <div className="text-[13px] text-zinc-500 mt-1.5">
            {quizCount > 0
              ? "本文已有拷问题，继续作答或重新生成"
              : "下一步：AI 会就本文出 4-6 道题考你（凭记忆作答）"}
          </div>
        </div>
        {quizCount > 0 ? (
          <a href={`/quiz/${article.id}`} className="btn-solid shrink-0 magnetic">
            继续拷问 →
          </a>
        ) : (
          <GenerateQuizButton articleId={article.id} />
        )}
      </div>
    </div>
  );
}
