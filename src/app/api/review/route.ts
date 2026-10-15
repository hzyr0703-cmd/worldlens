import { NextRequest, NextResponse } from "next/server";
import { dueCards, gradeCard, pendingCount, reviewStats } from "@/lib/review/fsrs";

export async function GET() {
  return NextResponse.json({ ok: true, due: pendingCount(), cards: dueCards(), stats: reviewStats() });
}

export async function POST(req: NextRequest) {
  const { cardId, rating } = (await req.json()) as { cardId: number; rating: 1 | 2 | 3 | 4 };
  try {
    const next = gradeCard(cardId, rating);
    return NextResponse.json({ ok: true, nextDue: next.due });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
