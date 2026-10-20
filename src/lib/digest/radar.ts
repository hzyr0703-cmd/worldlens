import { getDb } from "@/lib/db";

// ---------------------------------------------------------------------------
// 冲突雷达 —— 最初设计 Phase 2 的第一项：新主张 vs 历史主张，矛盾自动高亮。
// 规则层：同一实体在近 N 天内同时出现 bullish 与 bearish 主张 → 对撞对。
// 这是零成本的确定性检测；LLM 深度语义矛盾判断后续叠加。
// ---------------------------------------------------------------------------

export type ConflictPair = {
  entity_id: number;
  entity: string;
  type: string;
  bull_text: string;
  bear_text: string;
  bull_tier: number;
  bear_tier: number;
  bull_date: string | null;
  bear_date: string | null;
};

export function detectConflicts(days = 7, limit = 8): ConflictPair[] {
  const db = getDb();
  // 每个实体取最新一条 bullish 与一条 bearish 主张（窗口内），只输出真正对撞的实体
  const rows = db
    .prepare(
      `WITH recent AS (
         SELECT c.id, c.entity_id, c.text, c.polarity, i.tier,
                date(COALESCE(i.published_at, i.fetched_at)) AS d
         FROM claims c
         JOIN items i ON i.id = c.item_id
         WHERE c.polarity IN ('bullish','bearish')
           AND date(COALESCE(i.published_at, i.fetched_at)) >= date('now', ?)
       )
       SELECT r.entity_id, e.name AS entity, e.type,
              MAX(CASE WHEN r.polarity = 'bullish' THEN r.text END) AS bull_text,
              MAX(CASE WHEN r.polarity = 'bearish' THEN r.text END) AS bear_text,
              MAX(CASE WHEN r.polarity = 'bullish' THEN r.tier END) AS bull_tier,
              MAX(CASE WHEN r.polarity = 'bearish' THEN r.tier END) AS bear_tier,
              MAX(CASE WHEN r.polarity = 'bullish' THEN r.d END) AS bull_date,
              MAX(CASE WHEN r.polarity = 'bearish' THEN r.d END) AS bear_date
       FROM recent r JOIN entities e ON e.id = r.entity_id
       GROUP BY r.entity_id
       HAVING bull_text IS NOT NULL AND bear_text IS NOT NULL
       ORDER BY e.mention_count DESC LIMIT ?`
    )
    .all(`-${days} day`, limit) as unknown as ConflictPair[];
  return rows;
}
