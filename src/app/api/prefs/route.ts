import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** 偏好存取：主题订阅关键词等（key-value JSON） */
export async function POST(req: NextRequest) {
  try {
    const { key, value } = (await req.json()) as { key: string; value: unknown };
    if (!key) throw new Error("key required");
    getDb()
      .prepare(
        `INSERT INTO prefs (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, JSON.stringify(value ?? []));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
