import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const maxDuration = 60;

/**
 * 认知原子管理：编辑 / 退役 / 合并
 * PATCH  { id, statement?, elaboration?, type?, confidence? }
 * DELETE { id }                       —— 软删（retired），不物理删
 * POST   { keepId, mergeId }          —— 合并：keep 保留，merge 退役，links 迁移
 */
export async function PATCH(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const { id, statement, elaboration, type, confidence } = (await req.json()) as {
      id: number; statement?: string; elaboration?: string; type?: string; confidence?: number;
    };
    if (!id) throw new Error("id required");
    const db = getDb();

    // statement 变更走"新原子"语义（Orbit 的 prompt 身份管理）：
    // 复习历史属于问题，不属于文本。改了要记的内容 = 一个新的记忆对象。
    // 新原子从默认置信度起步；旧原子转 revised 退役；连 extends 边保持演化可追溯；
    // 复习卡保留 question、answer 换新表述、FSRS 状态重置（新表述 = 重新记）。
    const nextStatement = statement?.trim();
    if (nextStatement) {
      const old = db
        .prepare(`SELECT statement, elaboration, type, domain, confidence FROM nuggets WHERE id = ?`)
        .get(id) as unknown as
        | { statement: string; elaboration: string; type: string; domain: string; confidence: number }
        | undefined;
      if (!old) throw new Error("nugget not found");

      if (nextStatement.slice(0, 500) !== old.statement) {
        const ins = db
          .prepare(
            `INSERT INTO nuggets (type, statement, elaboration, domain, confidence, origin, user_answer, ai_correction, source_items, distill_date)
             VALUES (?, ?, ?, ?, 0.6, 'edit', '', '', '[]', date('now'))`
          )
          .run(old.type, nextStatement.slice(0, 500), old.elaboration, old.domain) as unknown as {
          lastInsertRowid: number | bigint;
        };
        const newId = Number(ins.lastInsertRowid);

        db.prepare(`UPDATE nuggets SET status = 'revised' WHERE id = ?`).run(id);
        db.prepare(
          `INSERT INTO nugget_links (src_id, dst_id, relation, rationale) VALUES (?, ?, 'extends', ?)`
        ).run(newId, id, "表述修订：旧表述退役，复习历史留在旧问题上");
        // 复习卡迁移到新原子：answer 换新表述，FSRS 状态重置（新表述 = 重新记）
        db.prepare(
          `UPDATE review_cards SET nugget_id = ?, answer = ?, fsrs_state = '', due = datetime('now', '+10 minutes')
           WHERE nugget_id = ?`
        ).run(newId, nextStatement.slice(0, 500), id);
        db.prepare(`UPDATE quizzes SET nugget_id = ? WHERE nugget_id = ?`).run(newId, id);
        db.prepare(
          `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'revised', ?, date('now'))`
        ).run(newId, `表述修订：#${id} → #${newId}`);

        return NextResponse.json({ ok: true, newId });
      }
    }

    // 非 statement 变更（elaboration/type/confidence）：元数据修改，身份不变
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (elaboration !== undefined) { sets.push("elaboration = ?"); vals.push(elaboration.slice(0, 1000)); }
    if (type) { sets.push("type = ?"); vals.push(type); }
    if (typeof confidence === "number") { sets.push("confidence = ?"); vals.push(Math.min(0.95, Math.max(0.1, confidence))); }
    if (sets.length === 0) throw new Error("nothing to update");
    vals.push(id);
    db.prepare(`UPDATE nuggets SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const { id } = (await req.json()) as { id: number };
    if (!id) throw new Error("id required");
    const db = getDb();
    db.prepare(`UPDATE nuggets SET status = 'retired' WHERE id = ?`).run(id);
    // 退役原子不再出复习卡
    db.prepare(`DELETE FROM review_cards WHERE nugget_id = ?`).run(id);
    db.prepare(
      `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'revised', ?, date('now'))`
    ).run(id, "手动退役");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const { keepId, mergeId } = (await req.json()) as { keepId: number; mergeId: number };
    if (!keepId || !mergeId || keepId === mergeId) throw new Error("keepId/mergeId required");
    const db = getDb();

    // 被合并方的连边迁移到保留方（合并去重）
    db.prepare(
      `INSERT OR IGNORE INTO nugget_links (src_id, dst_id, relation, rationale)
       SELECT ?, dst_id, relation, rationale FROM nugget_links WHERE src_id = ?`
    ).run(keepId, mergeId);
    db.prepare(
      `INSERT OR IGNORE INTO nugget_links (src_id, dst_id, relation, rationale)
       SELECT src_id, ?, relation, rationale FROM nugget_links WHERE dst_id = ?`
    ).run(keepId, mergeId);
    // 指向被合并方的复习卡改指保留方
    db.prepare(`UPDATE review_cards SET nugget_id = ? WHERE nugget_id = ?`).run(keepId, mergeId);

    db.prepare(`UPDATE nuggets SET status = 'retired' WHERE id = ?`).run(mergeId);
    const kept = db.prepare(`SELECT statement FROM nuggets WHERE id = ?`).get(keepId) as unknown as { statement: string };
    db.prepare(
      `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'revised', ?, date('now'))`
    ).run(keepId, `合并了重复原子 #${mergeId}`);
    return NextResponse.json({ ok: true, kept: kept?.statement ?? "" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
