import { getDb } from "@/lib/db";
import { chat } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 预测对账机制 —— 从「阅读理解器」到「世界运行模型」的分水岭。
// judgment 原子沉淀时自动生成：验证条件（什么事件发生=该判断被验证/证伪）+ 验证日期。
// 到期后对账卡进入复习队列：对了置信上调，错了触发修正，无法验证顺延。
// ---------------------------------------------------------------------------

type VerifyInput = { nid: number; statement: string };

/** 为一批 judgment 原子生成验证条件与日期（一次调用），写入对账卡 */
export async function ensureVerifications(items: VerifyInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const db = getDb();

  let out: { idx: number; condition: string; by: string }[] = [];
  try {
    const raw = await chat(
      `为每条前瞻判断生成「对账条件」。要求：
1. condition：一个可观察、可证伪的验证条件——"当发生什么/出现什么数据时，此判断被验证；当出现什么时被证伪"，80 字内
2. by：合理的验证截止日期（YYYY-MM-DD），根据判断涉及的事件节奏估计，一般 3-24 个月
3. 只输出 JSON 数组，顺序与输入一一对应：[{"idx":0,"condition":"...","by":"2026-12-31"},...]`,
      items.map((it, i) => `[${i}] ${it.statement}`).join("\n\n"),
      { maxTokens: 2048, temperature: 0.3, purpose: "verify_gen" }
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) out = JSON.parse(m[0]);
  } catch {
    return 0; // 验证条件生成失败不阻塞沉淀
  }

  let created = 0;
  const today = new Date();
  for (const o of out) {
    const item = items[o.idx];
    if (!item || !o.condition || !o.by) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.by)) continue;

    db.prepare(`UPDATE nuggets SET verify_by = ?, verify_date = ? WHERE id = ?`).run(
      o.condition.slice(0, 300),
      o.by,
      item.nid
    );
    db.prepare(
      `INSERT INTO review_cards (nugget_id, question, answer, kind, due) VALUES (?, ?, ?, 'verify', ?)`
    ).run(
      item.nid,
      item.statement.slice(0, 500),
      o.condition.slice(0, 300),
      o.by + " 09:00:00"
    );
    created++;
    void today;
  }
  return created;
}
