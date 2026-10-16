import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** 全库 JSON 导出（供 scripts/backup.mjs 拉取，发布前把线上数据并回本地） */
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const tables: Record<string, unknown[]> = {};
  for (const t of [
    "sources", "items", "entities", "claims", "edges", "digests", "cards",
    "nuggets", "nugget_links", "worldview_log", "articles", "quizzes",
    "review_cards", "review_log", "llm_log", "prefs",
  ]) {
    tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  return NextResponse.json({ exported_at: new Date().toISOString(), tables });
}
