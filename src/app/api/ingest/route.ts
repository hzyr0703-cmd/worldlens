import { NextResponse } from "next/server";
import { ingestAll } from "@/lib/ingest/rss";
import { extractPending } from "@/lib/extract/entities";
import { ensureSeed } from "@/app/api/seed/route";

export const maxDuration = 120;

export async function POST() {
  ensureSeed();
  const ingest = await ingestAll();
  const extract = await extractPending();
  return NextResponse.json({ ok: true, ingest, extract });
}
