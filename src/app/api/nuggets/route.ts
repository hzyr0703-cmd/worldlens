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
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (statement?.trim()) { sets.push("statement = ?"); vals.push(statement.trim().slice(0, 500)); }
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
