import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { curateAll } from "@/lib/supply/curator";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const results = await curateAll();
  const added = results.reduce((s, r) => s + r.added, 0);
  return NextResponse.json({ ok: true, added, results });
}
