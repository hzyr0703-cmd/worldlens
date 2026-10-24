import { getDb } from "@/lib/db";
import { chat, llmEnabled, parseJsonArray } from "@/lib/extract/llm";
import { searchTerms } from "@/lib/links/linker";

// ---------------------------------------------------------------------------
// 认知蒸馏引擎 v3 — 信息易逝，认知原子沉淀。
// 流程: 当日未蒸馏 items → LLM 三问蒸馏(宁缺毋滥, 全域日限 12 条) → 原子入库
//      → FTS 检索相关旧原子 → LLM 连边(supports/contradicts/explains/extends/analogy)
//      → 印证上调置信 / 矛盾触发修正 → worldview_log
// ---------------------------------------------------------------------------

const NUGGET_TYPES = ["mechanism", "pattern", "fact", "counterexample", "judgment", "question", "norm"] as const;
type NuggetType = (typeof NUGGET_TYPES)[number];

const RELATIONS = ["supports", "contradicts", "explains", "extends", "analogy"] as const;

const TYPE_CN: Record<string, string> = {
  mechanism: "机制", pattern: "模式", fact: "硬事实",
  counterexample: "反例", judgment: "判断", question: "开放问题", norm: "潜规则",
};


/** 机制质量过滤：
 *  1) 循环论证：链条首尾主体相同（A → … → A）
 *  2) 同义反复：含"推动增长/促进发展/有助于提升"等空泛动词且无具体数字
 *  3) 过短或缺因果标记（mechanism 必须有箭头或"导致/使得/倒逼"）
 */
function isQualityAtom(type: string, statement: string): boolean {
  const s = statement.trim();
  if (s.length < 12) return false;
  if (type !== "mechanism") return true;

  const hasCausal = /→|->|导致|使得|倒逼|进而|从而|引发|催生/.test(s);
  if (!hasCausal) return false;

  // 循环论证：链条里第一个与最后一个主体相同
  if (/→/.test(s)) {
    const parts = s.split("→").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const head = parts[0].slice(0, 6);
      const tail = parts[parts.length - 1].slice(0, 6);
      if (head && tail && (head.includes(tail) || tail.includes(head))) return false;
    }
  }

  // 空泛：有"推动/促进/有助于/提升"但通篇无一个数字
  const vague = /推动|促进|有助于|有利于|提升|改善/.test(s);
  const hasNumber = /\d/.test(s);
  if (vague && !hasNumber) return false;

  return true;
}


const DISTILL_SYSTEM = `你是认知蒸馏引擎。输入是若干条财经/AI 领域的实时信息，你的任务不是摘要新闻，而是提炼"认知原子"——值得长期保存、可跨场景复用的理解单元。

六种原子类型：
- mechanism 机制：现象背后的因果原理，**必须写出传导链条（A → 通过什么 → 导致 B，至少两步因果）**。
  反例（禁止）：「扩大有效需求有助于稳定工业增长」——这只是判断，没有机制；
  「亚马逊在德国投资将推动当地基础设施发展」——这是事实+预期，不是机制；
  正例：「地方债置换降低城投融资成本 → 银行息差收窄 → 倒逼银行转向零售贷款」；
  「利率平价下降息 → 套利资金流出 → 本币贬值」。
- pattern 模式：可跨场景复用的结构（如：产能过剩→价格战→出清→龙头集中）
- fact 硬事实：**只收会成为长期锚点的硬数据**（市占率、产能、政策数字、行业规模，如"某公司占全球市场份额 32%"）。
  **注意：单纯的事件进展不是原子**——"某公司发布某产品""某会议召开""某项目签约""某公司融资 N 亿""业绩预告"这类只回答"发生了什么"的信息一律不收；
  判断标准：这条信息跨场景还有用吗？一个月后还成立吗？两个都否 → 不收。
  只有能回答"为什么会这样"（mechanism/pattern/norm）或"接下来会怎样"（judgment）的才是认知原子。
- counterexample 反例：某规律失效的案例（最值钱的原子，遇到必收）
- judgment 判断：带置信度的前瞻预测，未来信息可验证/证伪
- question 开放问题：当前无法回答、值得后续信息追查的问题
- norm 潜规则：行业/体制内不成文但真实生效的行为惯例——格式「谁—在什么场景—默认怎么做—为什么—违反成本」（如：A股公司亏损年份倾向洗大澡，为次年扭亏保壳）

纪律：
1. statement 与 elaboration 必须用简体中文输出（即使信息原文是英文）
2. 宁缺毋滥——只收真正有长期价值的理解，日常波动、重复信息、纯事件报道不收
2.5 **类型配比（重要）**：每批输出中 fact **最多 1 条**；优先 mechanism / pattern / judgment / norm。
    若一批里只能抽出一条 fact，宁可少输出也不要凑数——认知库的价值在"解释力"，不在"信息量"。
2. statement 必须是一句自足的话（脱离原文也能看懂），包含关键数字与主体
3. elaboration 补充机制解释或上下文，1-3 句
4. confidence: fact/mechanism/norm 0.7-0.9, judgment 0.4-0.6, question 0.5
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

type RawNugget = {
  type: string;
  statement: string;
  elaboration?: string;
  domain?: string;
  confidence?: number;
  source_ids?: number[];
};

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

/** 库内 LIKE 粗筛 top3 → bigram Jaccard ≥ 0.55 判为重复（fts5 已弃用，见 db.ts） */
function findDuplicate(statement: string): { id: number } | null {
  const db = getDb();

  const terms = searchTerms(statement, 8);
  if (terms.length === 0) return null;
  const seen = new Set<number>();
  const candidates: { id: number; statement: string }[] = [];
  try {
    // 全部走 LIKE：terms 是从 statement 里抽出的关键词，命中即候选，
    // 精确判断交给后面的 bigram Jaccard
    const like = terms.map(() => `(statement LIKE ? OR elaboration LIKE ?)`).join(" OR ");
    const args = terms.flatMap((t) => [`%${t}%`, `%${t}%`]);
    const rows = db
      .prepare(
        `SELECT id, statement FROM nuggets
         WHERE status != 'retired' AND (${like})
         ORDER BY confidence DESC LIMIT 6`
      )
      .all(...args) as unknown as { id: number; statement: string }[];
    for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); candidates.push(r); }
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
  skipped: number;
  created: number;
  links: number;
  reinforced: number;
  contradicted: number;
};

export async function distillDaily(date?: string, limit = 400): Promise<DistillResult> {
  if (!llmEnabled) throw new Error("LLM 未配置（.env 缺 LLM_BASE_URL/LLM_API_KEY）");
  const db = getDb();
  const d = date ?? new Date().toISOString().slice(0, 10);
  const result: DistillResult = { batches: 0, scanned: 0, skipped: 0, created: 0, links: 0, reinforced: 0, contradicted: 0 };

  // ---- Step 1: 取未蒸馏 items ----
  // 优先级：巨潮公告（T0 最硬证据）> 其它；同类按新到旧（旧闻价值衰减，新信息优先入链）
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.content, i.tier FROM items i
       LEFT JOIN sources s ON s.id = i.source_id
       WHERE date(COALESCE(i.published_at, i.fetched_at)) <= ? AND i.distilled = 0
       ORDER BY CASE WHEN s.name = '巨潮·公告' THEN 0 ELSE 1 END, i.id DESC
       LIMIT ?`
    )
    .all(d, limit) as unknown as { id: number; title: string; content: string; tier: number }[];

  const BATCH = 25;
  const newIds: number[] = [];
  const newJudgments: { nid: number; statement: string }[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const text = chunk
      .map((r) => `[id:${r.id}|T${r.tier}] ${r.title} —— ${r.content.slice(0, 200)}`)
      .join("\n");
    result.batches++;
    result.scanned += chunk.length;

    let candidates: RawNugget[] = [];
    try {
      const raw = await chat(DISTILL_SYSTEM, text, { maxTokens: 12000, temperature: 0.2, purpose: "distill", model: process.env.DISTILL_MODEL || "sensenova/deepseek-v4-flash" });
      candidates = parseJsonArray<RawNugget>(raw).slice(0, 4); // 偏精：单批上限 4
      if (candidates.length === 0) {
        // JSON 失败重试一次（温度+0.2）
        const raw2 = await chat(DISTILL_SYSTEM, text, { maxTokens: 12000, temperature: 0.4, purpose: "distill_retry", model: process.env.DISTILL_MODEL || "sensenova/deepseek-v4-flash" });
        candidates = parseJsonArray<RawNugget>(raw2).slice(0, 4);
      }
    } catch (e) {
      // 错误分两类处理：429/超时/网络是临时的，计次重试（≥3 次才放弃）；
      // 内容安全过滤等不可恢复的才直接标 distilled=2 永久跳过。
      // 原先一刀切标 2，把限流期间的批次也永久丢了（565 条，占库存 9%）。
      const msg = e instanceof Error ? e.message : String(e);
      const transient =
        /429|rate.?limit|too many|timeout|timed?\s*out|ECONN|EAI_AGAIN|fetch failed|socket|network|aborted|502|503|504/i.test(msg);
      const ids = chunk.map((r) => r.id);
      const ph = chunk.map(() => "?").join(",");
      if (transient) {
        db.prepare(`UPDATE items SET distill_attempts = COALESCE(distill_attempts, 0) + 1 WHERE id IN (${ph})`).run(...ids);
        const giveUpRow = db
          .prepare(`SELECT COUNT(*) c FROM items WHERE id IN (${ph}) AND distill_attempts >= 3`)
          .get(...ids) as unknown as { c: number };
        const giveUp = giveUpRow?.c ?? 0;
        if (giveUp > 0) {
          db.prepare(`UPDATE items SET distilled = 2 WHERE id IN (${ph}) AND distill_attempts >= 3`).run(...ids);
        }
        result.batches--; result.scanned -= giveUp; result.skipped += giveUp;
        console.error(`[distill] batch transient failure (kept ${ids.length - giveUp} for retry): ${msg.slice(0, 120)}`);
      } else {
        db.prepare(`UPDATE items SET distilled = 2 WHERE id IN (${ph})`).run(...ids);
        result.batches--; result.scanned -= ids.length; result.skipped += ids.length;
        console.error(`[distill] batch skipped (content-filter or permanent): ${msg.slice(0, 120)}`);
      }
      continue;
    }

    for (const c of candidates) {
      if (!c.statement || !NUGGET_TYPES.includes(c.type as NuggetType)) continue;

      // ---- 低质机制过滤：循环论证 / 同义反复 / 空泛表述 ----
      if (!isQualityAtom(c.type, c.statement)) continue;

      // ---- 语义去重：与库内相似原子做 bigram 重合比对，重复则强化旧原子而非新建 ----
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

      // 溯源兜底：LLM 给的 id 全部无效时，用整批 id（原子出自这批信息，可回查）
      let validSources = (c.source_ids ?? []).filter((id) => chunk.some((r) => r.id === id));
      if (validSources.length === 0) validSources = chunk.map((r) => r.id).slice(0, 8);
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
      if (c.type === "judgment") newJudgments.push({ nid: Number(info.lastInsertRowid), statement: c.statement });
      result.created++;
      db.prepare(
        `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'created', ?, ?)`
      ).run(Number(info.lastInsertRowid), `蒸馏自 ${validSources.length} 条信息`, d);
    }

    db.prepare(
      `UPDATE items SET distilled = 1 WHERE id IN (${chunk.map(() => "?").join(",")})`
    ).run(...chunk.map((r) => r.id));
  }

  // ---- Step 1.5: judgment 原子生成预测对账卡 ----
  if (newJudgments.length > 0) {
    try {
      const { ensureVerifications } = await import("@/lib/verify/ledger");
      await ensureVerifications(newJudgments);
    } catch {
      /* 对账生成失败不阻塞 */
    }
  }

  // ---- Step 2: 连边 —— 统一走共享引擎（蒸馏/拷问同路） ----
  try {
    // 批量连边：网关 RPM 有限，6 个原子合并一次调用（原来逐原子调用会撞限流）
    const { linkNewAtomsBatch } = await import("@/lib/links/linker");
    const lr = await linkNewAtomsBatch(newIds, d);
    result.links += lr.links;
    result.reinforced += lr.reinforced;
    result.contradicted += lr.contradicted;
  } catch (e) {
    console.error("[distill] link stage failed:", e instanceof Error ? e.message : String(e));
  }

  return result;
}

export { TYPE_CN };
