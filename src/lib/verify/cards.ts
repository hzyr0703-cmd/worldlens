import { getDb } from "@/lib/db";

/**
 * 对账台的数据层。
 *
 * 与旧「复习」的区别：不再发一张孤立的闪卡，而是把**判断、所属链条、当前证据**一起端出来。
 * 用户只做一件事：看完证据后下判断（证实 / 证伪 / 证据不足）。
 */

export type VerifyEvidence = {
  id: number;
  title: string;
  link: string;
  date: string;
  source: string;
};

export type VerifyCardView = {
  id: number;
  question: string;
  answer: string;
  due: string;
  chain: { id: number; title: string; status: string } | null;
  evidence: VerifyEvidence[];
};

/** 到期对账卡（含所属链条与可查证据） */
export function dueVerifyCards(limit = 12): VerifyCardView[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT rc.id, rc.nugget_id, rc.question, rc.answer, rc.due
       FROM review_cards rc
       WHERE rc.kind = 'verify' AND rc.due <= datetime('now')
       ORDER BY rc.due ASC LIMIT ?`
    )
    .all(limit) as unknown as {
    id: number;
    nugget_id: number;
    question: string;
    answer: string;
    due: string;
  }[];

  const chainOf = db.prepare(
    `SELECT c.id, c.title, c.status FROM chain_steps s JOIN chains c ON c.id = s.chain_id
     WHERE s.nugget_id = ? LIMIT 1`
  );
  const nuggetOf = db.prepare(`SELECT statement, source_items FROM nuggets WHERE id = ?`);
  const entitiesIn = db.prepare(
    `SELECT id, name FROM entities WHERE length(name) >= 2 AND instr(?, name) > 0 ORDER BY length(name) DESC LIMIT 6`
  );
  // 证据 = 命中该判断所提实体的近期信息（比"共享任意实体"精确得多）
  const evidenceStmt = db.prepare(
    `SELECT i.id, i.title, i.link, COALESCE(i.published_at, i.fetched_at) AS d, s.name AS source,
            COUNT(DISTINCT c.entity_id) AS hits
     FROM claims c
     JOIN items i ON i.id = c.item_id
     JOIN sources s ON s.id = i.source_id
     WHERE c.entity_id IN (SELECT value FROM json_each(?))
       AND COALESCE(i.published_at, i.fetched_at) >= datetime('now', '-60 day')
     GROUP BY i.id
     ORDER BY hits DESC, d DESC LIMIT 3`
  );
  const fallbackStmt = db.prepare(
    `SELECT i.id, i.title, i.link, COALESCE(i.published_at, i.fetched_at) AS d, s.name AS source, 0 AS hits
     FROM items i JOIN sources s ON s.id = i.source_id
     WHERE i.id IN (SELECT value FROM json_each(?))
     ORDER BY d DESC LIMIT 3`
  );

  return rows.map((r) => {
    const chain =
      (chainOf.get(r.nugget_id) as unknown as { id: number; title: string; status: string } | undefined) ?? null;

    let evidence: VerifyEvidence[] = [];
    try {
      const ng = nuggetOf.get(r.nugget_id) as unknown as { statement: string; source_items: string } | undefined;
      const statement = `${ng?.statement ?? ""} ${r.question}`;
      const ents = entitiesIn.all(statement) as unknown as { id: number; name: string }[];

      if (ents.length > 0) {
        evidence = evidenceStmt.all(JSON.stringify(ents.map((e) => e.id))) as unknown as VerifyEvidence[];
      }
      if (evidence.length === 0) {
        const ids = JSON.parse(ng?.source_items ?? "[]") as number[];
        if (Array.isArray(ids) && ids.length > 0) {
          evidence = fallbackStmt.all(JSON.stringify(ids)) as unknown as VerifyEvidence[];
        }
      }
    } catch {
      /* 证据缺失不影响结算，前端会显示「未找到可查证据」 */
    }

    return { id: r.id, question: r.question, answer: r.answer, due: r.due, chain, evidence };
  });
}

/** 即将到期的验证点（未到期，按时间排序）——台面空了也要让人看到"接下来要验什么" */
export function upcomingVerifyCards(limit = 6): { id: number; question: string; due: string }[] {
  try {
    return getDb()
      .prepare(
        `SELECT id, question, due FROM review_cards
         WHERE kind = 'verify' AND due > datetime('now')
         ORDER BY due ASC LIMIT ?`
      )
      .all(limit) as unknown as { id: number; question: string; due: string }[];
  } catch {
    return [];
  }
}

/** 过期太久的验证点自动归档：日期已经过去几个月，既无从结算也只会变成噪音 */
export function retireStaleVerifyCards(maxOverdueDays = 120): number {
  const db = getDb();
  let n = 0;
  try {
    const rows = db
      .prepare(
        `SELECT id, nugget_id, question FROM review_cards
         WHERE kind = 'verify' AND due <= datetime('now', ?)`
      )
      .all(`-${maxOverdueDays} day`) as unknown as { id: number; nugget_id: number; question: string }[];
    for (const r of rows) {
      db.prepare(
        `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'archived', ?, date('now'))`
      ).run(r.nugget_id, `验证点过期超过 ${maxOverdueDays} 天未结算，自动归档：${String(r.question).slice(0, 100)}`);
      db.prepare(`DELETE FROM review_cards WHERE id = ?`).run(r.id);
      n++;
    }
  } catch {
    /* 归档失败不影响对账台 */
  }
  return n;
}

/** 下一条验证点到期日（未来最近的一条；没有到期卡时的空态用） */
export function nextVerifyDue(): string | null {
  try {
    const row = getDb()
      .prepare(`SELECT MIN(due) d FROM review_cards WHERE kind = 'verify' AND due > datetime('now')`)
      .get() as unknown as { d: string | null };
    return row?.d ?? null;
  } catch {
    return null;
  }
}

/** 已结算的台账：读 worldview_log 里的「预测对账」记录（结算真正写在这里） */
export function settledVerifyCards(limit = 8): {
  id: number;
  statement: string;
  outcome: "confirmed" | "refuted";
  detail: string;
  date: string;
}[] {
  const db = getDb();
  try {
    return (
      db
        .prepare(
          `SELECT w.id AS id, w.nugget_id AS id2, n.statement AS statement,
                  w.action AS action, w.detail AS detail, w.batch_date AS date
           FROM worldview_log w LEFT JOIN nuggets n ON n.id = w.nugget_id
           WHERE w.detail LIKE '预测对账%'
           ORDER BY w.id DESC LIMIT ?`
        )
        .all(limit) as unknown as {
        id: number;
        id2: number;
        statement: string | null;
        action: string;
        detail: string;
        date: string;
      }[]
    ).map((r) => ({
      id: r.id,
      statement: r.statement ?? "（原子已退役）",
      outcome: r.action === "challenged" ? "refuted" : "confirmed",
      detail: r.detail,
      date: r.date,
    }));
  } catch {
    return [];
  }
}
