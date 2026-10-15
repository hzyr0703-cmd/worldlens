import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDigest } from "@/lib/digest/daily";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const db = getDb();
  const d = date ?? new Date().toISOString().slice(0, 10);

  const existing = db.prepare(`SELECT content, stats FROM digests WHERE date = ?`).get(d) as
    | { content: string; stats: string }
    | undefined;

  if (existing) return NextResponse.json({ date: d, content: existing.content, stats: existing.stats, cached: true });

  const built = await buildDigest(d);
  return NextResponse.json({ ...built, cached: false });
}

export async function POST(req: NextRequest) {
  const { date } = (await req.json().catch(() => ({}))) as { date?: string };
  const built = await buildDigest(date);
  return NextResponse.json(built);
}
