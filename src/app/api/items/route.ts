import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** 最近快讯（对账卡选证据用，公开只读） */
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.link, s.name AS source
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE length(i.title) > 4
       ORDER BY i.id DESC LIMIT 30`
    )
    .all();
  return NextResponse.json({ ok: true, items: rows });
}
