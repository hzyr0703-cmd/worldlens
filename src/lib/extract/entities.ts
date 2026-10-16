import { getDb } from "@/lib/db";
import { chat, llmEnabled } from "./llm";

// ---------------------------------------------------------------------------
// 实体/主张抽取：规则词典优先（零成本），LLM 可选增强。
// 产出：items.processed=1 + entities 提及计数 + claims + co_mention 边。
// ---------------------------------------------------------------------------

type EntityRow = { id: number; name: string; type: string; aliases: string };

/** 展开词典：主名+别名 → 实体id 映射，按长度降序避免短词截胡 */
function buildMatcher(entities: EntityRow[]) {
  const dict: { term: string; id: number }[] = [];
  for (const e of entities) {
    let aliases: string[] = [];
    try {
      aliases = JSON.parse(e.aliases ?? "[]");
    } catch {
      aliases = [];
    }
    for (const term of [e.name, ...aliases]) {
      if (term && term.length >= 2) dict.push({ term, id: e.id });
    }
  }
  return dict.sort((a, b) => b.term.length - a.term.length);
}

function matchEntities(text: string, dict: { term: string; id: number }[]): number[] {
  const hits = new Set<number>();
  for (const { term, id } of dict) {
    if (text.includes(term)) hits.add(id);
    if (hits.size >= 8) break; // 单条最多 8 实体，防噪声
  }
  return [...hits];
}

const POLARITY_WORDS: Record<string, string[]> = {
  bullish: ["上涨", "大涨", "涨停", "利好", "增长", "超预期", "突破", "新高", "走强", "飙升"],
  bearish: ["下跌", "大跌", "跌停", "利空", "下滑", "低于预期", "新低", "走弱", "暴跌", "裁员", "亏损"],
};

function guessPolarity(text: string): string {
  let bullish = 0;
  let bearish = 0;
  for (const w of POLARITY_WORDS.bullish) if (text.includes(w)) bullish++;
  for (const w of POLARITY_WORDS.bearish) if (text.includes(w)) bearish++;
  if (bullish > bearish) return "bullish";
  if (bearish > bullish) return "bearish";
  return "factual";
}

/** LLM 增强抽取：识别词典外的实体。失败静默降级（规则结果已入库）。 */
async function llmExtraEntities(text: string, known: Set<string>): Promise<string[]> {
  if (!llmEnabled) return [];
  try {
    const out = await chat(
      "你是金融信息实体抽取器。从文本中抽取[公司/宏观机构/概念]实体，只输出JSON数组，每项为{name,type}，type∈company|macro|concept。不要输出词典已有实体。无新实体输出[]。",
      `已有实体(勿重复): ${[...known].slice(0, 50).join("、")}\n文本: ${text.slice(0, 1500)}`
    );
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as { name?: string; type?: string }[];
    return arr
      .filter((x) => x.name && x.name.length >= 2 && x.name.length <= 20)
      .map((x) => JSON.stringify({ name: x.name!.trim(), type: x.type ?? "concept" }));
  } catch {
    return [];
  }
}

export type ExtractResult = { processed: number; entitiesTouched: number; claims: number };

export async function extractPending(limit = 200): Promise<ExtractResult> {
  const db = getDb();
  const entities = db
    .prepare(`SELECT id, name, type, aliases FROM entities`)
    .all() as unknown as EntityRow[];
  const dict = buildMatcher(entities);
  const knownNames = new Set(entities.map((e) => e.name));

  const rows = db
    .prepare(`SELECT id, title, content FROM items WHERE processed = 0 ORDER BY id DESC LIMIT ?`)
    .all(limit) as unknown as { id: number; title: string; content: string }[];

  let claims = 0;
  const touched = new Set<number>();

  for (const row of rows) {
    const text = `${row.title}。${row.content}`.slice(0, 2000);
    const ids = matchEntities(text, dict);

    // LLM 增强（仅当规则零命中且配置了 key，控制成本）
    if (ids.length === 0 && llmEnabled) {
      const extras = await llmExtraEntities(text, knownNames);
      for (const raw of extras) {
        const { name, type } = JSON.parse(raw) as { name: string; type: string };
        const existing = db.prepare(`SELECT id FROM entities WHERE name = ?`).get(name) as
          | { id: number }
          | undefined;
        const eid =
          existing?.id ??
          (
            db
              .prepare(`INSERT INTO entities (name, type) VALUES (?, ?)`)
              .run(name, type) as unknown as { lastInsertRowid: number | bigint }
          ).lastInsertRowid;
        ids.push(Number(eid));
        knownNames.add(name);
      }
    }

    for (const eid of ids) {
      touched.add(eid);
      db.prepare(`INSERT INTO claims (item_id, entity_id, text, polarity) VALUES (?, ?, ?, ?)`).run(
        row.id,
        eid,
        row.title.slice(0, 300),
        guessPolarity(text)
      );
      claims++;
    }

    // 共现边（图谱骨架）
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        db.prepare(
          `INSERT INTO edges (src_id, dst_id, relation, weight, last_seen)
           VALUES (?, ?, 'co_mention', 1, datetime('now'))
           ON CONFLICT(src_id, dst_id, relation)
           DO UPDATE SET weight = weight + 1, last_seen = datetime('now')`
        ).run(ids[i], ids[j]);
      }
    }

    db.prepare(`UPDATE items SET processed = 1 WHERE id = ?`).run(row.id);
  }

  // 实体提及计数刷新
  db.prepare(
    `UPDATE entities SET mention_count = (SELECT COUNT(*) FROM claims WHERE entity_id = entities.id)`
  ).run();

  return { processed: rows.length, entitiesTouched: touched.size, claims };
}
