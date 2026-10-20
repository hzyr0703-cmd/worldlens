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
  /** 与该对撞相关的认知原子（statement FTS 命中）——外部冲突触碰了你的理解 */
  relatedAtoms: { id: number; statement: string; marked: boolean }[];
};

export function detectConflicts(days = 7, limit = 8): ConflictPair[] {
  const db = getDb();
  const d = new Date().toISOString().slice(0, 10);
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

  // 关联性闭环：对撞实体的主张与认知原子 FTS 匹配时，
  // 匹配原子标记 challenged 并写世界观日志——外部冲突正式触碰你的理解
  const markStmt = db.prepare(`UPDATE nuggets SET status = 'challenged' WHERE id = ? AND status != 'retired'`);
  const logStmt = db.prepare(
    `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'challenged', ?, ?)`
  );
  for (const c of rows) {
    const terms = `${c.bull_text} ${c.bear_text}`
      .replace(/[，。、：；！？\s]/g, " ")
      .split(" ")
      .filter((w) => w.length >= 3)
      .slice(0, 6);
    const related: { id: number; statement: string; marked: boolean }[] = [];
    if (terms.length) {
      try {
        const matched = db
          .prepare(
            `SELECT n.id, n.statement FROM nuggets n
             JOIN nuggets_fts f ON n.id = f.rowid
             WHERE nuggets_fts MATCH ? AND n.status != 'retired' AND n.status != 'challenged'
             ORDER BY rank LIMIT 3`
          )
          .all(terms.map((t) => `"${t}"`).join(" OR ")) as unknown as { id: number; statement: string }[];
        for (const m of matched) {
          const r = markStmt.run(m.id);
          const marked = r.changes > 0;
          if (marked) {
            logStmt.run(
              m.id,
              `冲突雷达：实体「${c.entity}」出现多空对撞 — ▲${c.bull_text.slice(0, 80)} / ▼${c.bear_text.slice(0, 80)}`,
              d
            );
          }
          related.push({ ...m, marked });
        }
      } catch {
        /* FTS 异常不影响雷达主体 */
      }
    }
    c.relatedAtoms = related;
  }

  return rows;
}
