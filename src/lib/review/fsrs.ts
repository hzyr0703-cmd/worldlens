import { fsrs, generatorParameters, createEmptyCard, type Card, type Grade, type FSRS } from "ts-fsrs";
import { getDb } from "@/lib/db";

// ---------------------------------------------------------------------------
// FSRS 复习调度（ts-fsrs）— 原子只有被回忆过才真正属于你。
// ---------------------------------------------------------------------------

const f: FSRS = fsrs(generatorParameters({ enable_fuzz: true }));

type CardRow = {
  id: number;
  nugget_id: number;
  question: string;
  answer: string;
  fsrs_state: string;
  due: string;
  variant?: string;
};

function deserialize(stateJson: string): Card {
  try {
    const c = JSON.parse(stateJson) as Card;
    if (!c || typeof c.state !== "number" || !c.due || typeof c.stability !== "number") {
      // 坏数据：返回新卡但保留原 due，不清零调度进度
      const fb = createEmptyCard(new Date(stateDue(stateJson)));
      return fb;
    }
    if (typeof c.due === "string") c.due = new Date(c.due);
    if (typeof c.last_review === "string") c.last_review = new Date(c.last_review);
    return c;
  } catch {
    return createEmptyCard(new Date(stateDue(stateJson)));
  }
}

function stateDue(stateJson: string): string | number {
  try {
    const c = JSON.parse(stateJson) as { due?: string };
    if (c?.due) return c.due;
  } catch {
    /* fallthrough */
  }
  return Date.now();
}

export type DueCard = CardRow & { card: Card; variant: string; nuggetStatus: string; reps: number; kind: string };

export function dueCards(limit = 20): DueCard[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT rc.*, n.status AS nuggetStatus FROM review_cards rc
       JOIN nuggets n ON n.id = rc.nugget_id
       WHERE rc.due <= datetime('now') AND rc.kind = 'verify' ORDER BY rc.due LIMIT ?`
    )
    .all(limit) as unknown as (CardRow & { nuggetStatus: string; kind: string })[];
  return rows.map((r) => {
    const card = deserialize(r.fsrs_state);
    return { ...r, card, variant: r.variant ?? "", reps: card.reps ?? 0, kind: r.kind ?? "recall" };
  });
}

export function pendingCount(): number {
  const db = getDb();
  return (
    db.prepare(`SELECT COUNT(*) n FROM review_cards WHERE kind = 'verify' AND due <= datetime('now')`).get() as unknown as { n: number }
  ).n;
}

/** 到期对账卡数量（首页横幅用） */
export function pendingVerifyCount(): number {
  const db = getDb();
  return (
    db
      .prepare(`SELECT COUNT(*) n FROM review_cards WHERE kind = 'verify' AND due <= datetime('now')`)
      .get() as unknown as { n: number }
  ).n;
}

/** 最近一次评分的快照：供 5 秒内撤销（个人工具，单用户，内存快照即可；重启自然失效） */
let lastGrade: { cardId: number; prevState: string; prevDue: string; logId: number | bigint } | null = null;

export function gradeCard(cardId: number, rating: Grade): Card {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM review_cards WHERE id = ?`).get(cardId) as unknown as
    | CardRow
    | undefined;
  if (!row) throw new Error("card not found");

  const card = deserialize(row.fsrs_state);
  const schedule = f.repeat(card, new Date())[rating];
  const next = schedule.card;
  const prevState = row.fsrs_state;
  const prevDue = row.due;

  db.prepare(
    `UPDATE review_cards SET fsrs_state = ?, due = ? WHERE id = ?`
  ).run(
    JSON.stringify({ ...next, due: next.due.toISOString(), last_review: next.last_review ? new Date(next.last_review).toISOString() : null }),
    next.due.toISOString().slice(0, 19).replace("T", " "),
    cardId
  );
  const log = db.prepare(`INSERT INTO review_log (card_id, rating) VALUES (?, ?)`).run(cardId, rating) as unknown as {
    lastInsertRowid: number | bigint;
  };
  lastGrade = { cardId, prevState, prevDue, logId: log.lastInsertRowid };
  return next;
}

/** 撤销最近一次评分：还原 FSRS 快照 + 删除 review_log 记录。非最近一次评分时拒绝。 */
export function undoLastGrade(cardId: number): { ok: boolean; error?: string } {
  if (!lastGrade || lastGrade.cardId !== cardId) {
    return { ok: false, error: "只能撤销最近一次评分" };
  }
  const db = getDb();
  db.prepare(`UPDATE review_cards SET fsrs_state = ?, due = ? WHERE id = ?`).run(
    lastGrade.prevState,
    lastGrade.prevDue,
    cardId
  );
  db.prepare(`DELETE FROM review_log WHERE id = ?`).run(lastGrade.logId);
  lastGrade = null;
  return { ok: true };
}

/** 复习动力统计：今日 / 累计 / 连续天数 */
export function reviewStats(): { today: number; total: number; streak: number } {
  const db = getDb();
  const today = (
    db.prepare(`SELECT COUNT(*) n FROM review_log WHERE date(reviewed_at) = date('now')`).get() as unknown as { n: number }
  ).n;
  const total = (db.prepare(`SELECT COUNT(*) n FROM review_log`).get() as unknown as { n: number }).n;

  const days = db
    .prepare(`SELECT DISTINCT date(reviewed_at) d FROM review_log ORDER BY d DESC LIMIT 60`)
    .all() as unknown as { d: string }[];
  let streak = 0;
  const cur = new Date();
  for (let i = 0; i < 60; i++) {
    const iso = cur.toISOString().slice(0, 10);
    if (days.some((x) => x.d === iso)) {
      streak++;
    } else if (i > 0 || streak > 0) {
      break;
    }
    cur.setDate(cur.getDate() - 1);
  }
  return { today, total, streak };
}

/** 预测对账结算：confirmed 印证 / refuted 证伪 / unverifiable 无法验证（顺延 45 天）
 *  evidenceItemId：可选——用一条快讯作为结算证据，写入世界观日志供回溯 */
export function settleVerification(
  cardId: number,
  outcome: "confirmed" | "refuted" | "unverifiable",
  note: string,
  evidenceItemId?: number
): void {
  const db = getDb();
  const card = db.prepare(`SELECT * FROM review_cards WHERE id = ? AND kind = 'verify'`).get(cardId) as unknown as
    | { id: number; nugget_id: number; answer: string; due: string }
    | undefined;
  if (!card) throw new Error("verify card not found");
  const nid = card.nugget_id;
  const d = new Date().toISOString().slice(0, 10);

  // 证据快讯：找到则拼进日志
  let evidence = "";
  if (evidenceItemId) {
    const it = db
      .prepare(`SELECT title, link FROM items WHERE id = ?`)
      .get(evidenceItemId) as unknown as { title: string; link: string } | undefined;
    if (it) evidence = ` [证据#${evidenceItemId}] ${it.title.slice(0, 80)}${it.link ? ` (${it.link})` : ""}`;
  }

  // 无法验证：只改 due，单条 UPDATE 天然原子，无需事务
  if (outcome === "unverifiable") {
    const next = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 19).replace("T", " ");
    db.prepare(`UPDATE review_cards SET due = ? WHERE id = ?`).run(next, cardId);
    return;
  }

  // 结算要同时动原子、日志、卡片、链条四处——任一步失败都必须整体回滚，
  // 否则会出现"置信度加了 0.15 但卡还在"（下次结算再加一次）这类不可逆污染。
  db.exec("BEGIN IMMEDIATE");
  try {
    if (outcome === "confirmed") {
      db.prepare(`UPDATE nuggets SET confidence = MIN(0.95, confidence + 0.15), status = 'reinforced' WHERE id = ?`).run(nid);
      db.prepare(
        `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'reinforced', ?, ?)`
      ).run(nid, `预测对账：验证通过 — ${note.slice(0, 150)}${evidence}`, d);
    } else {
      db.prepare(`UPDATE nuggets SET confidence = MAX(0.1, confidence - 0.3), status = 'challenged' WHERE id = ?`).run(nid);
      db.prepare(
        `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'challenged', ?, ?)`
      ).run(nid, `预测对账：被现实证伪 — ${note.slice(0, 150)}${evidence}`, d);
    }

    db.prepare(`DELETE FROM review_cards WHERE id = ?`).run(cardId);

    // 链条闭环：同一原子可能挂在多条链上，全部回写（原先 LIMIT 1 只结算第一条）
    const steps = db
      .prepare(`SELECT id, chain_id FROM chain_steps WHERE nugget_id = ?`)
      .all(nid) as unknown as { id: number; chain_id: number }[];
    const aggStmt = db.prepare(
      `SELECT SUM(verified = 1) ok, SUM(verified = -1) bad, COUNT(*) total
       FROM chain_steps WHERE chain_id = ? AND verified != 0`
    );
    for (const step of steps) {
      db.prepare(`UPDATE chain_steps SET verified = ? WHERE id = ?`).run(outcome === "confirmed" ? 1 : -1, step.id);
      const agg = aggStmt.get(step.chain_id) as unknown as { ok: number | null; bad: number | null; total: number };
      if ((agg.bad ?? 0) > 0) {
        db.prepare(`UPDATE chains SET status = 'broken', updated_at = datetime('now') WHERE id = ?`).run(step.chain_id);
      } else if ((agg.ok ?? 0) > 0 && agg.ok === agg.total) {
        // 已断裂的链不能被"已验证环节"洗白：断裂环节本身（role=verify, verify_by=''）不参与
        // verified 统计，若这里无条件改 resolved，一条断裂链只要有一个环节被证实就会复活。
        db.prepare(
          `UPDATE chains SET status = 'resolved', updated_at = datetime('now') WHERE id = ? AND status != 'broken'`
        ).run(step.chain_id);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* 回滚失败时保留原始错误 */
    }
    throw e;
  }
}
