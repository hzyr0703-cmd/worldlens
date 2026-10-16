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
       WHERE rc.due <= datetime('now') ORDER BY rc.due LIMIT ?`
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
    db.prepare(`SELECT COUNT(*) n FROM review_cards WHERE due <= datetime('now')`).get() as unknown as { n: number }
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

export function gradeCard(cardId: number, rating: Grade): Card {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM review_cards WHERE id = ?`).get(cardId) as unknown as
    | CardRow
    | undefined;
  if (!row) throw new Error("card not found");

  const card = deserialize(row.fsrs_state);
  const schedule = f.repeat(card, new Date())[rating];
  const next = schedule.card;

  db.prepare(
    `UPDATE review_cards SET fsrs_state = ?, due = ? WHERE id = ?`
  ).run(
    JSON.stringify({ ...next, due: next.due.toISOString(), last_review: next.last_review ? new Date(next.last_review).toISOString() : null }),
    next.due.toISOString().slice(0, 19).replace("T", " "),
    cardId
  );
  db.prepare(`INSERT INTO review_log (card_id, rating) VALUES (?, ?)`).run(cardId, rating);
  return next;
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

  if (outcome === "confirmed") {
    db.prepare(`UPDATE nuggets SET confidence = MIN(0.95, confidence + 0.15), status = 'reinforced' WHERE id = ?`).run(nid);
    db.prepare(
      `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'reinforced', ?, ?)`
    ).run(nid, `预测对账：验证通过 — ${note.slice(0, 150)}${evidence}`, d);
  } else if (outcome === "refuted") {
    db.prepare(`UPDATE nuggets SET confidence = MAX(0.1, confidence - 0.3), status = 'challenged' WHERE id = ?`).run(nid);
    db.prepare(
      `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'challenged', ?, ?)`
    ).run(nid, `预测对账：被现实证伪 — ${note.slice(0, 150)}${evidence}`, d);
  } else {
    // 无法验证：对账卡顺延 45 天
    const next = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 19).replace("T", " ");
    db.prepare(`UPDATE review_cards SET due = ? WHERE id = ?`).run(next, cardId);
    return;
  }

  db.prepare(`DELETE FROM review_cards WHERE id = ?`).run(cardId);
}
