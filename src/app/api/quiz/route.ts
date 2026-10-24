import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { generateQuiz, gradeAnswer, digestArticle } from "@/lib/quiz/interrogator";
import { jobState, startJob, startedBody } from "@/lib/background";

/** 出题/底稿是 LLM 长任务（1-5 分钟），同步返回必被网关 60 秒掐断——后台跑 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { action, articleId, quizId, answer } = (await req.json()) as {
    action: "generate" | "answer" | "digest";
    articleId?: number;
    quizId?: number;
    answer?: string;
  };
  try {
    if (action === "generate") {
      if (!articleId) throw new Error("articleId required");
      const name = `quiz-gen-${articleId}`;
      const { started } = startJob(name, async () => {
        const count = await generateQuiz(articleId);
        return `出题 ${count} 道`;
      });
      return NextResponse.json(startedBody("AI 出题", started, "AI 出题已启动"));
    }
    if (action === "digest") {
      if (!articleId) throw new Error("articleId required");
      const name = `quiz-digest-${articleId}`;
      const { started } = startJob(name, async () => {
        const r = await digestArticle(articleId);
        return `底稿完成 · 出题 ${r.nuggets} · 卡 ${r.cards}`;
      });
      return NextResponse.json(startedBody("精读底稿", started, "底稿生成已启动"));
    }
    if (action === "answer") {
      // 单题评分是短调用（<10s），保持同步
      if (!quizId) throw new Error("quizId required");
      const verdict = await gradeAnswer(quizId, answer ?? "");
      return NextResponse.json({ ok: true, verdict });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/** 前端轮询：?articleId=xxx 查该文章的出题/底稿任务状态 */
export async function GET(req: NextRequest) {
  const articleId = Number(req.nextUrl.searchParams.get("articleId") ?? 0);
  if (!articleId) return NextResponse.json({ ok: true, job: null });
  return NextResponse.json({
    ok: true,
    gen: jobState(`quiz-gen-${articleId}`),
    digest: jobState(`quiz-digest-${articleId}`),
  });
}
