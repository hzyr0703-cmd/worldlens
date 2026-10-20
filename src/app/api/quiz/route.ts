import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { generateQuiz, gradeAnswer, digestArticle } from "@/lib/quiz/interrogator";

export const maxDuration = 300;

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
      const count = await generateQuiz(articleId);
      return NextResponse.json({ ok: true, questions: count });
    }
    if (action === "answer") {
      if (!quizId) throw new Error("quizId required");
      const verdict = await gradeAnswer(quizId, answer ?? "");
      return NextResponse.json({ ok: true, verdict });
    }
    if (action === "digest") {
      if (!articleId) throw new Error("articleId required");
      const r = await digestArticle(articleId);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
