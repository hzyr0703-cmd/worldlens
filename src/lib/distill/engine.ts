import { getDb } from "@/lib/db";
import { chat, llmEnabled } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 认知蒸馏引擎 v3 — 信息易逝，认知原子沉淀。
// 流程: 当日未蒸馏 items → LLM 三问蒸馏(宁缺毋滥, 全域日限 12 条) → 原子入库
//      → FTS 检索相关旧原子 → LLM 连边(supports/contradicts/explains/extends/analogy)
//      → 印证上调置信 / 矛盾触发修正 → worldview_log
// ---------------------------------------------------------------------------

const NUGGET_TYPES = ["mechanism", "pattern", "fact", "counterexample", "judgment", "question"] as const;
type NuggetType = (typeof NUGGET_TYPES)[number];

const RELATIONS = ["supports", "contradicts", "explains", "extends", "analogy"] as const;

const TYPE_CN: Record<string, string> = {
  mechanism: "机制", pattern: "模式", fact: "硬事实",
  counterexample: "反例", judgment: "判断", question: "开放问题",
};

const DISTILL_SYSTEM = `你是认知蒸馏引擎。输入是若干条财经/AI 领域的实时信息，你的任务不是摘要新闻，而是提炼"认知原子"——值得长期保存、可跨场景复用的理解单元。

六种原子类型：
- mechanism 机制：现象背后的因果原理（如：利率平价使降息压弱本币）
- pattern 模式：可跨场景复用的结构（如：产能过剩→价格战→出清→龙头集中）
- fact 硬事实：有明确出处、带时效的锚点数据（如：某公司占某市场份额X%）
- counterexample 反例：某规律失效的案例（最值钱的原子，遇到必收）
- judgment 判断：带置信度的前瞻预测，未来信息可验证/证伪
- question 开放问题：当前无法回答、值得后续信息追查的问题

纪律：
1. statement 与 elaboration 必须用简体中文输出（即使信息原文是英文）
2. 宁缺毋滥——只收真正有长期价值的理解，日常波动、重复信息、纯事件报道不收
2. statement 必须是一句自足的话（脱离原文也能看懂），包含关键数字与主体
3. elaboration 补充机制解释或上下文，1-3 句
4. confidence: fact/mechanism 0.7-0.9, judgment 0.4-0.6, question 0.5
5. source_ids 填入支撑该原子的信息 id 数组
6. 只输出 JSON 数组，无原子输出 []，禁止任何其他文字

输出格式：[{"type":"mechanism","statement":"...","elaboration":"...","domain":"finance|ai","confidence":0.8,"source_ids":[1,2]}]`;

const LINK_SYSTEM = `你是认知连接器。输入：新蒸出的认知原子（带 idx）+ 库内已有原子（带 id）。判断新原子与哪些旧原子存在关系：
- supports 佐证：新原子为旧原子提供新证据（置信度应上调）
- contradicts 矛盾：新原子与旧原子冲突（触发修正）
- explains 解释：新原子解释了旧原子背后的机制
- extends 延伸：新原子将旧原子推广到新场景
- analogy 类比：结构相似的可迁移模式

纪律：只在关系确实成立时连边，宁缺毋滥；rationale 用一句话说清为什么。只输出 JSON 数组，无关系输出 []。

输出格式：[{"src_idx":0,"dst_id":12,"relation":"supports","rationale":"..."}]`;

/** items 表补充蒸馏标记列（老库迁移，幂等） */
function ensureDistilledColumn(): void {
  try {
    getDb().prepare(`ALTER TABLE items ADD COLUMN distilled INTEGER NOT NULL DEFAULT 0`).run();
  } catch {
    /* 列已存在 */
  }
}

type RawNugget = {
  type: string;
  statement: string;
  elaboration?: string;
  domain?: string;
  confidence?: number;
  source_ids?: number[];
};

function parseJsonArray<T>(text: string): T[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return JSON.parse(m[0]) as T[];
  } catch {
    return [];
  }
}

/** 语句切 bigram，算 Jaccard 重合度 */
function bigrams(s: string): Set<string> {
  const t = s.replace(/[，。、：；！？\s "'（）()【】\[\]]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/** 库内 FTS 粗筛 top3 → bigram Jaccard ≥ 0.55 判为重复 */
function findDuplicate(statement: string): { id: number } | null {
  const db = getDb();
  const terms = statement.replace(/[，。、：；！？\s]/g, " ").split(" ").filter((w) => w.length >= 2).slice(0, 8);
  if (terms.length === 0) return null;
  let candidates: { id: number; statement: string }[] = [];
  try {
    candidates = db
      .prepare(
        `SELECT n.id, n.statement FROM nuggets n
         JOIN nuggets_fts f ON n.id = f.rowid
         WHERE nuggets_fts MATCH ?
         ORDER BY rank LIMIT 3`
      )
      .all(terms.map((t) => `"${t}"`).join(" OR ")) as unknown as { id: number; statement: string }[];
  } catch {
    return null;
  }
  const src = bigrams(statement);
  for (const c of candidates) {
    if (jaccard(src, bigrams(c.statement)) >= 0.55) return { id: c.id };
  }
  return null;
}

export type DistillResult = {
  batches: number;
  scanned: number;
  created: number;
  links: number;
  reinforced: number;
  contradicted: number;
};

export async function distillDaily(date?: string): Promise<DistillResult> {
  if (!llmEnabled) throw new Error("LLM 未配置（.env 缺 LLM_BASE_URL/LLM_API_KEY）");
  ensureDistilledColumn();
  const db = getDb();
  const d = date ?? new Date().toISOString().slice(0, 10);
  const result: DistillResult = { batches: 0, scanned: 0, created: 0, links: 0, reinforced: 0, contradicted: 0 };

  // ---- Step 1: 取未蒸馏 items（ASC：积压时旧条目也能轮到），分批喂给蒸馏引擎 ----
  const rows = db
    .prepare(
      `SELECT id, title, content, tier FROM items
       WHERE date(COALESCE(published_at, fetched_at)) <= ? AND distilled = 0
       ORDER BY id ASC LIMIT 120`
    )
    .all(d) as unknown as { id: number; title: string; content: string; tier: number }[];

  const corpus = rows
    .map((r) => `[id:${r.id}|T${r.tier}] ${r.title} —— ${r.content.slice(0, 200)}`)
    .join("\n");

  const BATCH = 25;
  const newIds: number[] = [];

  for (let i = 0; i < Math.min(rows.length, 120); i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const text = chunk
      .map((r) => `[id:${r.id}|T${r.tier}] ${r.title} —— ${r.content.slice(0, 200)}`)
      .join("\n");
    result.batches++;
    result.scanned += chunk.length;

    const raw = await chat(DISTILL_SYSTEM, text, { maxTokens: 4096, temperature: 0.2, purpose: "distill" });
    let candidates = parseJsonArray<RawNugget>(raw).slice(0, 4); // 偏精：单批上限 4
    if (candidates.length === 0) {
      // JSON 失败重试一次（温度+0.2）
      const raw2 = await chat(DISTILL_SYSTEM, text, { maxTokens: 4096, temperature: 0.4, purpose: "distill_retry" });
      candidates = parseJsonArray<RawNugget>(raw2).slice(0, 4);
    }

    for (const c of candidates) {
      if (!c.statement || !NUGGET_TYPES.includes(c.type as NuggetType)) continue;

      // ---- 语义去重：与库内 FTS 相似原子做 bigram 重合比对，重复则强化旧原子而非新建 ----
      const dup = await findDuplicate(c.statement);
      if (dup) {
        db.prepare(
          `UPDATE nuggets SET confidence = MIN(0.95, confidence + 0.05), status = 'reinforced' WHERE id = ?`
        ).run(dup.id);
        db.prepare(
          `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'reinforced', ?, ?)`
        ).run(dup.id, `相似信息重复出现（去重合并）: ${c.statement.slice(0, 100)}`, d);
        result.reinforced++;
        continue;
      }

      const validSources = (c.source_ids ?? []).filter((id) =>
        chunk.some((r) => r.id === id)
      );
      const info = db
        .prepare(
          `INSERT INTO nuggets (type, statement, elaboration, domain, confidence, source_items, distill_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          c.type,
          c.statement.slice(0, 500),
          (c.elaboration ?? "").slice(0, 1000),
          c.domain === "ai" ? "ai" : "finance",
          Math.min(0.95, Math.max(0.2, c.confidence ?? 0.6)),
          JSON.stringify(validSources),
          d
        ) as unknown as { lastInsertRowid: number | bigint };
      newIds.push(Number(info.lastInsertRowid));
      result.created++;
      db.prepare(
        `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'created', ?, ?)`
      ).run(Number(info.lastInsertRowid), `蒸馏自 ${validSources.length} 条信息`, d);
    }

    db.prepare(
      `UPDATE items SET distilled = 1 WHERE id IN (${chunk.map(() => "?").join(",")})`
    ).run(...chunk.map((r) => r.id));
  }

  // ---- Step 2: 连边 + 修正循环 ----
  for (const nid of newIds) {
    const nugget = db
      .prepare(`SELECT id, type, statement, elaboration FROM nuggets WHERE id = ?`)
      .get(nid) as unknown as { id: number; type: string; statement: string; elaboration: string };
    if (!nugget) continue;

    // FTS 粗筛库内相关旧原子（top 12）
    const terms = nugget.statement.replace(/[，。、：；！？\s]/g, " ").split(" ").filter((w) => w.length >= 2).slice(0, 8);
    let candidates: { id: number; statement: string }[] = [];
    if (terms.length > 0) {
      candidates = db
        .prepare(
          `SELECT n.id, n.statement FROM nuggets n
           JOIN nuggets_fts f ON n.id = f.rowid
           WHERE nuggets_fts MATCH ? AND n.id != ?
           ORDER BY rank LIMIT 12`
        )
        .all(terms.map((t) => `"${t}"`).join(" OR "), nid) as unknown as {
        id: number; statement: string;
      }[];
    }
    if (candidates.length === 0) continue;

    const prompt = `新原子:\n[idx:0] ${nugget.statement}\n\n库内原子:\n${candidates
      .map((c) => `[id:${c.id}] ${c.statement}`)
      .join("\n")}`;

    const raw = await chat(LINK_SYSTEM, prompt, { maxTokens: 2048, temperature: 0.1, purpose: "link" });
    let links = parseJsonArray<{
      src_idx: number; dst_id: number; relation: string; rationale?: string;
    }>(raw);
    if (links.length === 0) {
      const raw2 = await chat(LINK_SYSTEM, prompt, { maxTokens: 2048, temperature: 0.3, purpose: "link_retry" });
      links = parseJsonArray<{ src_idx: number; dst_id: number; relation: string; rationale?: string }>(raw2);
    }

    for (const l of links) {
      if (l.src_idx !== 0) continue;
      if (!RELATIONS.includes(l.relation as (typeof RELATIONS)[number])) continue;
      if (!candidates.some((c) => c.id === l.dst_id)) continue;

      db.prepare(
        `INSERT INTO nugget_links (src_id, dst_id, relation, rationale) VALUES (?, ?, ?, ?)
         ON CONFLICT(src_id, dst_id, relation) DO NOTHING`
      ).run(nid, l.dst_id, l.relation, (l.rationale ?? "").slice(0, 300));
      result.links++;

      if (l.relation === "supports") {
        // 加权：低置信新原子只小幅上调旧原子（0.1 × 自身置信度）
        const self = db.prepare(`SELECT confidence FROM nuggets WHERE id = ?`).get(nid) as unknown as { confidence: number };
        const bump = 0.1 * Math.min(1, Math.max(0.2, self?.confidence ?? 0.6));
        db.prepare(
          `UPDATE nuggets SET confidence = MIN(0.95, confidence + ?), status = 'reinforced' WHERE id = ?`
        ).run(bump, l.dst_id);
        db.prepare(
          `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'reinforced', ?, ?)`
        ).run(l.dst_id, `被新原子佐证: ${nugget.statement.slice(0, 120)}`, d);
        result.reinforced++;
      } else if (l.relation === "contradicts") {
        db.prepare(`UPDATE nuggets SET status = 'challenged' WHERE id = ?`).run(l.dst_id);
        db.prepare(
          `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'challenged', ?, ?)`
        ).run(l.dst_id, `被新原子挑战: ${nugget.statement.slice(0, 120)} — ${(l.rationale ?? "").slice(0, 150)}`, d);
        result.contradicted++;
      }
    }
  }

  return result;
}

export { TYPE_CN };
