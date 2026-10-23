import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { gradeCard, settleVerification, undoLastGrade } from "@/lib/review/fsrs";
import { dueVerifyCards, nextVerifyDue, retireStaleVerifyCards, settledVerifyCards, upcomingVerifyCards } from "@/lib/verify/cards";

export async function GET() {
  // 先把早就过期、已无从结算的老验证点归档，避免台面被历史噪音占满
  retireStaleVerifyCards(120);
  // 对账台：只发验证卡，且每张都带「所属链条 + 可查证据」
  const cards = dueVerifyCards();
  return NextResponse.json({
    ok: true,
    due: cards.length,
    cards,
    nextDue: nextVerifyDue(),
    settled: settledVerifyCards(),
    upcoming: upcomingVerifyCards(),
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as {
      cardId?: number;
      rating?: 1 | 2 | 3 | 4;
      action?: "verify" | "undo";
      outcome?: "confirmed" | "refuted" | "unverifiable";
      note?: string;
      evidenceItemId?: number;
    };
    if (body.action === "undo") {
      if (!body.cardId) throw new Error("cardId required");
      const r = undoLastGrade(body.cardId);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (body.action === "verify") {
      if (!body.cardId || !body.outcome) throw new Error("cardId/outcome required");
      settleVerification(body.cardId, body.outcome, body.note ?? "", body.evidenceItemId);
      return NextResponse.json({ ok: true });
    }
    if (!body.cardId || !body.rating) throw new Error("cardId/rating required");
    const next = gradeCard(body.cardId, body.rating);
    return NextResponse.json({ ok: true, nextDue: next.due });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
