import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { dueCards, gradeCard, pendingCount, reviewStats, settleVerification, undoLastGrade } from "@/lib/review/fsrs";

export async function GET() {
  return NextResponse.json({ ok: true, due: pendingCount(), cards: dueCards(), stats: reviewStats() });
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
