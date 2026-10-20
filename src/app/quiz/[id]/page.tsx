import { getDb } from "@/lib/db";
import { QuizRunner } from "@/components/QuizRunner";
import GenerateQuizButton from "@/components/GenerateQuizButton";
import SplitText from "@/components/SplitText";

export const dynamic = "force-dynamic";

type QuizRow = {
  id: number;
  q_order: number;
  question: string;
  user_answer: string;
  ai_verdict: string;
  state: string;
};

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const article = db
    .prepare(`SELECT id, title, body, url FROM articles WHERE id = ?`)
    .get(Number(id)) as unknown as { id: number; title: string; body: string; url: string } | undefined;
  if (!article) return <div className="empty">文章不存在</div>;

  const quizzes = (
    db
      .prepare(`SELECT id, q_order, question, user_answer, ai_verdict, state FROM quizzes WHERE article_id = ? ORDER BY q_order`)
      .all(article.id) as unknown as (QuizRow & Record<string, unknown>)[]
  ).map((r) => ({
    id: r.id,
    q_order: r.q_order,
    question: r.question,
    user_answer: r.user_answer,
    ai_verdict: r.ai_verdict,
    state: r.state,
  }));

  return (
    <div className="max-w-[760px] mx-auto">
      <a
        href={`/read/${article.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors duration-150"
      >
        <span className="hover:translate-x-[-2px] transition-transform duration-150 inline-block">←</span>
        回看原文
      </a>

      <header className="page-head relative mt-8">
        {/* 淡方格底纹，与全站页头一致 */}
        <div className="grid-veil pointer-events-none absolute inset-x-0 -top-6 h-[220px]" aria-hidden />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="sec-index mono">拷问</span>
            <span className="h-px w-8 bg-zinc-300" />
            <span className="mono text-[11px] text-zinc-400 tabular-nums">
              {article.body.length} 字原文
            </span>
          </div>
          <h1 className="text-[26px] sm:text-[32px] font-semibold leading-[1.18] tracking-[-0.03em] mt-5">
            <SplitText text={article.title} />
          </h1>
          <p
            className="wipe text-[14px] text-zinc-500 mt-4 leading-relaxed"
            style={{ ["--d" as string]: "260ms" }}
          >
            先读文章 → 凭记忆作答 → 阅卷修正。全部答完后，你的表述会沉淀为认知原子。
          </p>
        </div>
      </header>

      <div className="page-body mt-10">
        {quizzes.length === 0 ? (
          <div className="empty card-in">
            <p className="text-[15px] font-medium">这篇文章还没有拷问题</p>
            <p className="text-[13.5px] text-zinc-500 mt-2 max-w-[42ch] mx-auto leading-relaxed">
              让 AI 就本文出 4-6 道简答题，覆盖机制、反例和判断。
            </p>
            <div className="mt-6 flex justify-center">
              <GenerateQuizButton articleId={article.id} />
            </div>
          </div>
        ) : (
          <div className="card-in">
            <QuizRunner articleId={article.id} quizzes={quizzes} />
          </div>
        )}
      </div>

      {article.url && (
        <p className="mono text-[11px] text-zinc-400 text-center mt-10 reveal-5 reveal">
          原文 · {article.url} — 复习时才允许回看
        </p>
      )}
    </div>
  );
}
