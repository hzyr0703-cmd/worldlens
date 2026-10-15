import { NextResponse } from "next/server";
import { curateAll } from "@/lib/supply/curator";

export const maxDuration = 300;

export async function POST() {
  const results = await curateAll();
  const added = results.reduce((s, r) => s + r.added, 0);
  return NextResponse.json({ ok: true, added, results });
}
