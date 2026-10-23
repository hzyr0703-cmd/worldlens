import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** 全库 JSON 导出（供 scripts/backup.mjs 拉取，发布前把线上数据并回本地） */
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const tables: Record<string, unknown[]> = {};
  // 注意：这里必须包含 chains / chain_steps（产品核心），旧版漏了它们、还引用了已废弃的 cards 表
  for (const t of [
    "sources", "items", "entities", "claims", "edges", "digests",
    "chains", "chain_steps",
    "nuggets", "nugget_links", "worldview_log", "articles", "quizzes",
    "review_cards", "review_log", "llm_log", "cron_log", "prefs",
  ]) {
    try {
      tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    } catch {
      tables[t] = []; // 该表尚未创建（老库/全新库）：跳过，不拖垮整份备份
    }
  }
  return NextResponse.json({ exported_at: new Date().toISOString(), tables });
}
