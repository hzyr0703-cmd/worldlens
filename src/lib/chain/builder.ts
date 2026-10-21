import { getDb } from "@/lib/db";
import { chat, llmEnabled } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 知识链条引擎 —— 信息是点，知识是链。
// 输入：当日信息（带 id 溯源）+ 已有活跃链条（主题/判断/最近环节）
// 输出：延伸已有链（append 环节）/ 开启新链（≥2 环节）/ 标记链条断裂（矛盾）
// 纪律：每个环节必须引用真实 item id；单条孤立信息不成链；无料不输出。
// ---------------------------------------------------------------------------

const CHAIN_MODEL = process.env.CHAIN_MODEL || "glm-4.6";

type DayItem = { id: number; title: string; entities: string | null; polarity: string | null };
type ChainRow = { id: number; title: string; thesis: string; status: string; steps: string | null };

type RecentStep = { seq: number; role: string; claim: string };

export type ChainResult = {
  extended: number; // 追加到已有链的环节数
  created: number;  // 新建链条数
  broken: number;   // 断裂的链条数
};

/** 宽松对象解析：LLM 偶尔加围栏/前后缀，提取第一个完整 JSON 对象 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const r = tryParse(fence[1].trim());
    if (r) return r;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  for (let e = end; e > start && end - e < 4000; e--) {
    const r = tryParse(text.slice(start, e + 1));
    if (r) return r;
  }
  return null;
}

export async function buildChains(date?: string): Promise<ChainResult> {
  const db = getDb();
  const d = date ?? new Date().toISOString().slice(0, 10);
  const result: ChainResult = { extended: 0, created: 0, broken: 0 };
  if (!llmEnabled) return result;

  // A. 当日信息（限 60 条，带实体与多空倾向）
  const items = db
    .prepare(
      `SELECT i.id, i.title,
              (SELECT GROUP_CONCAT(e.name, '、') FROM claims c JOIN entities e ON e.id = c.entity_id
               WHERE c.item_id = i.id LIMIT 1) AS entities,
              (SELECT c.polarity FROM claims c WHERE c.item_id = i.id LIMIT 1) AS polarity
       FROM items i
       WHERE date(COALESCE(i.published_at, i.fetched_at)) = ?
       ORDER BY i.id DESC LIMIT 60`
    )
    .all(d) as unknown as DayItem[];
  if (items.length < 2) return result;

  // B. 已有活跃链条（最近 15 条，含最近 3 个环节）
  const chains = db
    .prepare(
      `SELECT c.id, c.title, c.thesis, c.status,
              (SELECT GROUP_CONCAT(s.seq || ':' || s.role || ':' || s.claim, ' | ')
               FROM (SELECT * FROM chain_steps WHERE chain_id = c.id ORDER BY seq DESC LIMIT 3) s) AS steps
       FROM chains c WHERE c.status = 'active'
       ORDER BY c.updated_at DESC LIMIT 15`
    )
    .all() as unknown as ChainRow[];

  const itemsText = items
    .map((i) => `[id:${i.id}]${i.polarity === "bullish" ? "▲" : i.polarity === "bearish" ? "▼" : ""} ${i.title}｜实体:${i.entities ?? "—"}`)
    .join("\n");
  const chainsText = chains.length
    ? chains.map((c) => `[chain:${c.id}] ${c.title}｜判断:${c.thesis}｜最近环节:${c.steps ?? "无"}`).join("\n")
    : "（暂无已有链条）";

  const prompt = `【A. 今日信息】
${itemsText.slice(0, 7000)}

【B. 已有活跃链条】
${chainsText.slice(0, 3000)}

任务：把这些信息炼成知识链的环节。三条路径：
1. **extends**：某条信息是已有链的自然下一环（时序推进或因果推进）→ 追加环节
2. **news**：开启新链——但必须 ≥2 个环节（至少一个 trigger + 一个 mechanism/effect），单条孤立信息不成链
3. **breaks**：今日信息与某链某环节**直接矛盾**（同一主体相反主张）→ 标记该链断裂

输出 JSON 对象：
{
  "extends": [{"chain_id": 3, "steps": [{"role": "effect|mechanism|trigger|verify", "claim": "一句话环节", "item_ids": [123], "verify_by": ""}]}],
  "news": [{"title": "链条主题（≤20字）", "thesis": "核心判断一句话", "domain": "finance|ai|tech", "steps": [{"role": "trigger", "claim": "...", "item_ids": [125]}, {"role": "mechanism", "claim": "...", "item_ids": [125,126]}]}],
  "breaks": [{"chain_id": 3, "reason": "矛盾说明", "item_ids": [130]}]
}
纪律（严格，逐条检查）：
1. 每个 step 必须引用 A 中真实存在的 item id。
2. **role 的语义不能混**：
   - trigger = 已发生的事实事件（谁做了什么，有明确主体与动作）
   - mechanism = **因果传导路径**，必须写成「因为 X，导致 Y」（解释为什么会从上一环走到这一环），而不是"接下来发生了什么"
   - effect = **已可观察到的现象**（价格变动/数据/行为结果），不能是"将会发生"
   - verify = 未来可验证的推论，必须给日期（YYYY-MM-DD）
3. 反例（禁止）：把「财长周三会见基金经理」写成 mechanism——这是日程进展，不是传导机制。
   正例：mechanism =「基金被限制在 TEFAS 交易 → 资金转寻场外通道 → 监管进一步收紧处罚」。
4. 若一条信息只能串出"事件进展"（A 出事、然后 B 出事、然后 C 开会），**不要建链**——那不是知识链，是新闻时间线。
5. 没料就不输出对应字段（空数组）。
6. **每条新链尽量给一个 verify 环节**：从链条推演里提炼一个未来能验证的推论（如"若机制成立，X 指标将在 Y 时间内变化"），给具体日期。这是链条的自我验证，缺了它链条就只是叙事。
6. **每条新链尽量给一个 verify 环节**：从链条推演里提炼一个未来能验证的推论（如"若机制成立，X 指标将在 Y 时间内变化"），给具体日期。这是链条的自我验证，缺了它链条就只是叙事。`;

  let parsed: Record<string, unknown> | null = null;
  try {
    const raw = await chat(prompt, "请按 JSON 格式输出。", {
      maxTokens: 4000,
      temperature: 0.25,
      purpose: "chain_build",
      model: CHAIN_MODEL,
    });
    parsed = parseJsonObject(raw);
    if (!parsed) {
      const raw2 = await chat(prompt, "只输出 JSON，不要任何解释。", {
        maxTokens: 4000,
        temperature: 0.4,
        purpose: "chain_build_retry",
        model: CHAIN_MODEL,
      });
      parsed = parseJsonObject(raw2);
    }
  } catch {
    return result;
  }
  if (!parsed) return result;

  const validIds = new Set(items.map((i) => i.id));
  const insStep = db.prepare(
    `INSERT OR IGNORE INTO chain_steps (chain_id, seq, role, claim, item_ids, verify_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const validRoles = ["trigger", "mechanism", "effect", "verify"];

  // ---- 延伸已有链条 ----
  const extendsArr = Array.isArray(parsed.extends) ? (parsed.extends as Record<string, unknown>[]) : [];
  for (const ex of extendsArr) {
    const cid = Number(ex.chain_id);
    if (!chains.some((c) => c.id === cid)) continue;
    const steps = Array.isArray(ex.steps) ? (ex.steps as Record<string, unknown>[]) : [];
    const maxSeq = (
      db.prepare(`SELECT COALESCE(MAX(seq),0) s FROM chain_steps WHERE chain_id = ?`).get(cid) as unknown as { s: number }
    ).s;
    let seq = maxSeq;
    for (const st of steps) {
      const role = String(st.role ?? "");
      const claim = String(st.claim ?? "").trim();
      const ids = (Array.isArray(st.item_ids) ? st.item_ids : []).map(Number).filter((x) => validIds.has(x));
      if (!validRoles.includes(role) || claim.length < 6 || ids.length === 0) continue;
      seq++;
      insStep.run(cid, seq, role, claim.slice(0, 300), JSON.stringify(ids), String(st.verify_by ?? ""));
      result.extended++;
    }
    if (seq > maxSeq) {
      db.prepare(`UPDATE chains SET updated_at = datetime('now') WHERE id = ?`).run(cid);
    }
  }

  // ---- 新建链条（要求 ≥2 环节） ----
  const newsArr = Array.isArray(parsed.news) ? (parsed.news as Record<string, unknown>[]) : [];
  for (const ch of newsArr) {
    const title = String(ch.title ?? "").trim();
    const thesis = String(ch.thesis ?? "").trim();
    const steps = Array.isArray(ch.steps) ? (ch.steps as Record<string, unknown>[]) : [];
    const cleanSteps = steps
      .map((st) => ({
        role: String(st.role ?? ""),
        claim: String(st.claim ?? "").trim(),
        ids: (Array.isArray(st.item_ids) ? st.item_ids : []).map(Number).filter((x) => validIds.has(x)),
        verifyBy: String(st.verify_by ?? ""),
      }))
      .filter((st) => validRoles.includes(st.role) && st.claim.length >= 6 && st.ids.length > 0);
    if (title.length < 4 || thesis.length < 6 || cleanSteps.length < 2) continue;

    const info = db
      .prepare(`INSERT INTO chains (title, thesis, domain, status, confidence) VALUES (?, ?, ?, 'active', 0.6)`)
      .run(
        title.slice(0, 40),
        thesis.slice(0, 200),
        ["finance", "ai", "tech"].includes(String(ch.domain)) ? String(ch.domain) : "finance"
      ) as unknown as { lastInsertRowid: number | bigint };
    const cid = Number(info.lastInsertRowid);
    const verifyNuggets: { nid: number; statement: string }[] = [];
    cleanSteps.forEach((st, i) => {
      const info = insStep.run(cid, i + 1, st.role, st.claim.slice(0, 300), JSON.stringify(st.ids), st.verifyBy.slice(0, 10)) as unknown as {
        lastInsertRowid: number | bigint;
      };
      // verify 环节 → 落成 judgment 原子，进入对账体系（链条的验证就是它的对账）
      if (st.role === "verify" && st.verifyBy) {
        const ninfo = db
          .prepare(
            `INSERT INTO nuggets (type, statement, elaboration, domain, confidence, source_items, distill_date, origin)
             VALUES ('judgment', ?, ?, 'finance', 0.6, ?, date('now'), 'chain')`
          )
          .run(
            st.claim.slice(0, 500),
            `来自知识链条 #${cid} 的待验证推演`,
            JSON.stringify(st.ids)
          ) as unknown as { lastInsertRowid: number | bigint };
        const nid = Number(ninfo.lastInsertRowid);
        db.prepare(`UPDATE chain_steps SET nugget_id = ? WHERE id = ?`).run(nid, Number(info.lastInsertRowid));
        verifyNuggets.push({ nid, statement: st.claim });
      }
    });
    if (verifyNuggets.length > 0) {
      try {
        const { ensureVerifications } = await import("@/lib/verify/ledger");
        await ensureVerifications(verifyNuggets);
      } catch {
        /* 对账生成失败不影响链条 */
      }
    }
    result.created++;
  }

  // ---- 断裂标记 ----
  const breaksArr = Array.isArray(parsed.breaks) ? (parsed.breaks as Record<string, unknown>[]) : [];
  for (const br of breaksArr) {
    const cid = Number(br.chain_id);
    if (!chains.some((c) => c.id === cid)) continue;
    const ids = (Array.isArray(br.item_ids) ? br.item_ids : []).map(Number).filter((x) => validIds.has(x));
    if (ids.length === 0) continue;
    const reason = String(br.reason ?? "").slice(0, 300);
    db.prepare(`UPDATE chains SET status = 'broken', updated_at = datetime('now') WHERE id = ?`).run(cid);
    const maxSeq = (
      db.prepare(`SELECT COALESCE(MAX(seq),0) s FROM chain_steps WHERE chain_id = ?`).get(cid) as unknown as { s: number }
    ).s;
    insStep.run(cid, maxSeq + 1, "verify", `链条断裂：${reason}`, JSON.stringify(ids), "");
    result.broken++;
  }

  return result;
}

/** 链条列表（页面用）：带环节数与最近环节 */
export function listChains(limit = 30): {
  id: number; title: string; thesis: string; status: string; domain: string; confidence: number;
  stepCount: number; lastStep: string; updated_at: string;
}[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.id, c.title, c.thesis, c.status, c.domain, c.confidence, c.updated_at,
              (SELECT COUNT(*) FROM chain_steps s WHERE s.chain_id = c.id) AS stepCount,
              (SELECT s.claim FROM chain_steps s WHERE s.chain_id = c.id ORDER BY s.seq DESC LIMIT 1) AS lastStep
       FROM chains c
       WHERE c.status != 'archived'
       ORDER BY (c.status = 'broken') DESC, c.updated_at DESC LIMIT ?`
    )
    .all(limit) as unknown as {
    id: number; title: string; thesis: string; status: string; domain: string; confidence: number;
    stepCount: number; lastStep: string; updated_at: string;
  }[];
}
