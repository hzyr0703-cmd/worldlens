import { NextRequest, NextResponse } from "next/server";
import { distillDaily } from "@/lib/distill/engine";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { date } = (await req.json().catch(() => ({}))) as { date?: string };
  try {
    const result = await distillDaily(date);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
