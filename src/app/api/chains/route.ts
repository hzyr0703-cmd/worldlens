import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { buildChains } from "@/lib/chain/builder";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const r = await buildChains();
  return NextResponse.json({ ok: true, ...r });
}
