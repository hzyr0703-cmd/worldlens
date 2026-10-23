import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDigest } from "@/lib/digest/daily";
import { isAuthed } from "@/lib/auth";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const db = getDb();
  const d = date ?? new Date().toISOString().slice(0, 10);

  const existing = db.prepare(`SELECT content, stats FROM digests WHERE date = ?`).get(d) as
    | { content: string; stats: string }
    | undefined;

  if (existing) return NextResponse.json({ date: d, content: existing.content, stats: existing.stats, cached: true });

  // 无缓存时构建会花掉一次 16000+ max_tokens 的 LLM 调用——只允许已登录者触发
  if (!isAuthed(req)) {
    return NextResponse.json({ ok: false, error: "该日暂无简报，生成需要登录" }, { status: 404 });
  }
  const built = await buildDigest(d);
  return NextResponse.json({ ...built, cached: false });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { date, deep } = (await req.json().catch(() => ({}))) as { date?: string; deep?: boolean };
  try {
    const built = await buildDigest(date, { deep: Boolean(deep) });
    return NextResponse.json(built);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
