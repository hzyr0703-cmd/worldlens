import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { ingestAll } from "@/lib/ingest/rss";
import { ingestCninfo } from "@/lib/ingest/cninfo";
import { extractPending } from "@/lib/extract/entities";
import { ensureSeed } from "@/app/api/seed/route";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  ensureSeed();
  const ingest = await ingestAll();
  const cninfo = await ingestCninfo();
  const extract = await extractPending();
  return NextResponse.json({ ok: true, ingest, cninfo, extract });
}
