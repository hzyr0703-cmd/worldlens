import { getDb } from "@/lib/db";
import { chat, parseJsonArray } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// v5 拷问式精读引擎
// 长文先 AI 精炼（≤2000 字，缓存于 articles.refined）→ 出题/阅卷均基于精炼稿
// 阅卷输出【META】行：type/domain/pass —— pass=0 的答案不沉淀原子（质量门槛）
// digest 为每张复习卡预生成一道"变式问法"（variant），复习时 reps>0 启用
// ---------------------------------------------------------------------------

type QuizRow = {
  id: number;
  article_id: number;
  question: string;
  expects: string;
  user_answer: string;
  ai_verdict: string;
};

const NUGGET_TYPES = ["mechanism", "pattern", "fact", "counterexample", "judgment", "question", "norm"] as const;
const DOMAINS = ["finance", "ai", "tech"] as const;

/** JSON 解析失败自动重试一次（温度略升打碎确定性格式错） */
async function chatJson<T>(
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number; purpose: string }
): Promise<T[]> {
  let raw = await chat(system, user, opts);
  let parsed = parseJsonArray<T>(raw);
  if (parsed.length === 0) {
    raw = await chat(system, user, { ...opts, temperature: (opts.temperature ?? 0.2) + 0.2 });
    parsed = parseJsonArray<T>(raw);
  }
  return parsed;
}

/** 考试用底稿：优先精炼稿，无则回退原文截断 */
function examSource(article: { body: string; refined: string }): string {
  const r = (article.refined ?? "").trim();
  return r.length >= 300 ? r : article.body.slice(0, 12000);
}

/** Step 0: 长文精炼 — 只压缩"考试范围"，不替换阅读正文（阅读页永远显示全文） */
export async function refineArticle(articleId: number): Promise<string> {
  const db = getDb();
  const article = db
    .prepare(`SELECT id, body, refined FROM articles WHERE id = ?`)
    .get(articleId) as unknown as { id: number; body: string; refined: string } | undefined;
  if (!article) throw new Error("article not found");

  const cached = (article.refined ?? "").trim();
  if (cached.length >= 300) return cached;
  // 入库文章已由 condenseForStorage 压到 ≤~3400 字，直接用全文做底稿
  if (article.body.length <= 3400) {
    db.prepare(`UPDATE articles SET refined = ? WHERE id = ?`).run(article.body, articleId);
    return article.body;
  }

  const refined = await chat(
    `你是精读教练。把文章精炼成一份 ≤2000 字的"考试底稿"，要求：
1. 保留全部核心论点、因果机制、数字锚点、反例、适用边界——这些是出题素材，丢一条就考不到
2. 删掉场景描写、重复铺垫、营销话术
3. 用简体中文（原文是英文也翻成中文）
4. 只输出精炼正文，不要任何前言后语`,
    article.body.slice(0, 30000),
    { maxTokens: 3000, temperature: 0.2, purpose: "refine" }
  );
  const clean = refined.trim().slice(0, 6000);
  if (clean.length < 300) throw new Error("refine failed: too short");
  db.prepare(`UPDATE articles SET refined = ? WHERE id = ?`).run(clean, articleId);
  return clean;
}

/** Step 1: 出题（基于精炼稿） */
export async function generateQuiz(articleId: number): Promise<number> {
  const db = getDb();
  const article = db
    .prepare(`SELECT id, title, body, refined, domain FROM articles WHERE id = ?`)
    .get(articleId) as unknown as { id: number; title: string; body: string; refined: string; domain: string } | undefined;
  if (!article) throw new Error("article not found");

  const existing = db
    .prepare(`SELECT COUNT(*) n FROM quizzes WHERE article_id = ?`)
    .get(articleId) as unknown as { n: number };
  if (existing.n > 0) return existing.n;

  const source = article.refined?.trim().length >= 300 ? article.refined : await refineArticle(articleId);

  // LLM 偶发短输出（1 题）或解析杂质——不足 4 题自动补题，最多 3 轮
  const questions: { q_order?: number; question?: string; expects?: string }[] = [];
  for (let round = 0; round < 3 && questions.length < 4; round++) {
    const batch = await chatJson<{ q_order?: number; question?: string; expects?: string }>(
      `你是严苛的阅读考官。针对文章出 ${round === 0 ? "4-6" : "4"} 道简答题，考察读者是否真正理解了文章：
1. 覆盖核心论点、关键机制/因果链、数据锚点、适用条件或反例
2. 问题必须凭记忆作答才有意义（不要能从问题字面直接抄出答案的问题）
3. 全部用简体中文出题（无论原文语言）
4. expects 字段写下你认为的完整答案要点（阅卷对照用，读者不可见），也用简体中文
${round > 0 ? `注意：上一轮出题不足，这轮请务必输出完整的 4 题。已有题目（不要重复）：${questions.map((q) => q.question).join("；")}` : ""}
只输出 JSON 数组：[{"q_order":1,"question":"...","expects":"..."}]`,
      `标题: ${article.title}\n\n正文(精炼稿):\n${source}`,
      { maxTokens: 4096, temperature: round === 0 ? 0.3 : 0.45, purpose: round === 0 ? "generate_quiz" : "generate_quiz_retry" }
    );
    const seen = new Set(questions.map((q) => q.question));
    for (const q of batch) {
      if (q.question && !seen.has(q.question)) {
        questions.push(q);
        seen.add(q.question);
      }
      if (questions.length >= 6) break;
    }
  }

  const ins = db.prepare(
    `INSERT INTO quizzes (article_id, q_order, question, expects) VALUES (?, ?, ?, ?)`
  );
  questions.forEach((q, i) => ins.run(articleId, q.q_order ?? i + 1, q.question!, q.expects ?? ""));

  db.prepare(`UPDATE articles SET quizzed = 1 WHERE id = ?`).run(articleId);
  return questions.length;
}

/** 解析阅卷 META 行：【META】type=mechanism|domain=finance|pass=1 */
function parseMeta(verdict: string): { type: string; domain: string; pass: boolean } | null {
  const m = verdict.match(/【META】\s*type=(\w+)\|domain=(\w+)\|pass=(\d)/);
  if (!m) return null;
  return {
    type: NUGGET_TYPES.includes(m[1] as (typeof NUGGET_TYPES)[number]) ? m[1] : "mechanism",
    domain: DOMAINS.includes(m[2] as (typeof DOMAINS)[number]) ? m[2] : "finance",
    pass: m[3] === "1",
  };
}

/** Step 2: 单题阅卷 — 对照精炼稿点评 + 元数据判定 */
export async function gradeAnswer(quizId: number, answer: string): Promise<string> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT q.id, q.question, q.expects, a.title, a.body, a.refined FROM quizzes q
       JOIN articles a ON a.id = q.article_id WHERE q.id = ?`
    )
    .get(quizId) as unknown as
    | { id: number; question: string; expects: string; title: string; body: string; refined: string }
    | undefined;
  if (!row) throw new Error("quiz not found");

  const source = (row.refined ?? "").trim().length >= 300 ? row.refined : row.body.slice(0, 8000);

  const verdict = await chat(
    `你是阅读阅卷官。读者凭记忆回答了问题。对照文章与标准要点：
1. 先说答对了什么（具体指出，不客套）
2. 再指出遗漏或错误（引用原文依据）
3. 最后给出"修正后的完整表述"（前缀【修正表述】），这是读者应该掌握的版本
4. 判定这条理解值得长期保存吗（日常琐事=0，机制/反例/可验证判断=1）
最后必须单独输出一行机器可读元数据（格式严格，管道符分隔）：
【META】type=mechanism|domain=finance|pass=1
其中 type 取值：mechanism/pattern/fact/counterexample/judgment/question/norm；domain 取值：finance/ai/tech；pass：值得长期保存=1 否则=0
用中文，点评部分总共不超过 200 字。`,
    `文章标题: ${row.title}\n文章(精炼稿): ${source.slice(0, 6000)}\n\n问题: ${row.question}\n标准要点: ${row.expects}\n\n读者回答: ${answer || "（空白）"}`,
    { maxTokens: 2048, temperature: 0.2, purpose: "grade_answer" }
  );

  db.prepare(`UPDATE quizzes SET user_answer = ?, ai_verdict = ?, state = 'answered' WHERE id = ?`).run(
    answer.slice(0, 2000),
    verdict.slice(0, 2400),
    quizId
  );
  return verdict;
}

/** Step 3: 全卷完成 → 有价值(pass=1)的回答沉淀为原子 + FSRS 卡 + 变式卡 */
export async function digestArticle(articleId: number): Promise<{
  nuggets: number;
  cards: number;
  skipped: number;
  skippedList: { question: string; reason: string }[];
}> {
  const db = getDb();
  const answered = db
    .prepare(
      `SELECT id, question, expects, user_answer, ai_verdict FROM quizzes
       WHERE article_id = ? AND state = 'answered' AND nugget_id IS NULL ORDER BY q_order`
    )
    .all(articleId) as unknown as QuizRow[];

  const article = db.prepare(`SELECT title, domain, url, source_kind FROM articles WHERE id = ?`).get(articleId) as unknown as
    | { title: string; domain: string; url: string; source_kind: string }
    | undefined;
  if (!article) throw new Error("article not found");

  // 口述/传闻来源的原子置信度打折：official 1.0 / anecdote 0.7 / rumor 0.5
  const kindFactor = article.source_kind === "rumor" ? 0.5 : article.source_kind === "anecdote" ? 0.7 : 1.0;
  const baseConf = Math.round(75 * kindFactor) / 100;

  let nuggets = 0;
  let cards = 0;
  let skipped = 0;
  const skippedList: { question: string; reason: string }[] = [];
  const createdQ: { q: string; a: string; nid: number }[] = [];

  for (const q of answered) {
    const meta = parseMeta(q.ai_verdict);
    // 旧格式 verdict（无 META）或 pass=0：不生成原子，避免污染类型系统
    if (!meta || !meta.pass) {
      skipped++;
      skippedList.push({
        question: q.question.slice(0, 60),
        reason: meta
          ? "阅卷判定未达标——回答与原文要点差距较大，不生成原子以免污染类型系统"
          : "阅卷缺少结构化结论（META 行），无法提取原子",
      });
      continue;
    }

    const corrected = extractCorrection(q.ai_verdict) || q.expects;
    const info = db
      .prepare(
        `INSERT INTO nuggets (type, statement, elaboration, domain, confidence, origin, user_answer, ai_correction, source_items, distill_date)
         VALUES (?, ?, ?, ?, ?, 'quiz', ?, ?, '[]', date('now'))`
      )
      .run(
        meta.type,
        corrected.slice(0, 500),
        `出自《${article.title}》。问：${q.question}`,
        meta.domain,
        baseConf,
        q.user_answer.slice(0, 1000),
        (q.ai_verdict || "").slice(0, 1200)
      ) as unknown as { lastInsertRowid: number | bigint };
    const nid = Number(info.lastInsertRowid);
    nuggets++;

    db.prepare(`UPDATE quizzes SET nugget_id = ? WHERE id = ?`).run(nid, q.id);
    db.prepare(
      `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'created', ?, date('now'))`
    ).run(nid, `拷问式精读《${article.title}》`);

    createdQ.push({ q: q.question, a: corrected.slice(0, 500), nid });
  }

  // 批量生成变式问法：一次调用 —— 复习时 reps>0 启用，防止背题不背知识
  if (createdQ.length > 0) {
    let variants: string[] = [];
    try {
      const raw = await chat(
        `为每道问答生成一个"变式问法"：同一个知识点，换一个提问角度（换主体/换方向/换场景），凭记忆作答难度相当。保持简体中文。只输出 JSON 数组，顺序与输入一一对应：["变式1","变式2",...]`,
        createdQ.map((c, i) => `[${i}] 问：${c.q}\n答：${c.a}`).join("\n\n"),
        { maxTokens: 2048, temperature: 0.4, purpose: "variant" }
      );
      variants = parseJsonArray<string>(raw);
    } catch {
      /* 变式生成失败不阻塞沉淀 */
    }

    for (let i = 0; i < createdQ.length; i++) {
      const c = createdQ[i];
      const variant = (variants[i] ?? "").trim().slice(0, 300);
      db.prepare(
        `INSERT INTO review_cards (nugget_id, question, answer, variant) VALUES (?, ?, ?, ?)`
      ).run(c.nid, c.q, c.a, variant);
      cards++;
    }
  }

  // 全部新原子 → 共享连边引擎入网（拷问原子与蒸馏原子同路，不再有孤岛）
  if (createdQ.length > 0) {
    try {
      const { linkNewAtoms } = await import("@/lib/links/linker");
      await linkNewAtoms(createdQ.map((c) => c.nid), new Date().toISOString().slice(0, 10));
    } catch {
      /* 连边失败不阻塞沉淀 */
    }
  }

  // judgment 原子 → 生成预测对账卡（验证条件 + 验证日期）
  const judgments = createdQ
    .map((c) => ({ nid: c.nid, statement: c.a }))
    .filter((x) => {
      const t = db.prepare(`SELECT type FROM nuggets WHERE id = ?`).get(x.nid) as unknown as { type: string };
      return t?.type === "judgment";
    });
  if (judgments.length > 0) {
    try {
      const { ensureVerifications } = await import("@/lib/verify/ledger");
      await ensureVerifications(judgments);
    } catch {
      /* 对账生成失败不阻塞 */
    }
  }

  return { nuggets, cards, skipped, skippedList };
}

function extractCorrection(verdict: string): string {
  const m = verdict.match(/【修正表述】[:：]?\s*([\s\S]+?)(?:\n【META】|$)/);
  return m ? m[1].trim() : "";
}

export { examSource };
