import { getDb } from "@/lib/db";
import { chat, llmEnabled } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 每日简报 v2 —— 从「摘要器」升级为「分析器」。
// 三层材料：A 当日快讯（T级） · B 同实体近 30 天历史主张（对照演变）
//          · C 用户的认知原子库（个人理解的沉淀）
// 输出四节：今日主线 / 与历史的对话 / 与你的认知库的对话 / 值得追踪。
// 「对话」两节是灵魂：没有对照关系就诚实说没有，绝不编造。
// ---------------------------------------------------------------------------

type TopicRow = {
  entity_id: number;
  name: string;
  type: string;
  cnt: number;
  items: string; // JSON: [{title, tier, polarity, published_at}]
};

const TIER_LABEL = ["T0官方", "T1权威", "T2行业", "T3观点"] as const;

function fmtItems(itemsJson: string): string {
  const arr = JSON.parse(itemsJson) as {
    title: string;
    tier: number;
    polarity: string;
    published_at: string | null;
  }[];
  return arr
    .map((x) => `- [${TIER_LABEL[x.tier] ?? "T?"}]${x.polarity === "bullish" ? "▲" : x.polarity === "bearish" ? "▼" : ""} ${x.title}`)
    .join("\n");
}

/** B 层：今日命中实体在过去 30 天的历史主张（对照演变用） */
function historyClaims(entityIds: number[]): { entity: string; text: string; d: string }[] {
  if (entityIds.length === 0) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.name AS entity, c.text, date(COALESCE(i.published_at, i.fetched_at)) AS d
       FROM claims c
       JOIN entities e ON e.id = c.entity_id
       JOIN items i ON i.id = c.item_id
       WHERE c.entity_id IN (${entityIds.map(() => "?").join(",")})
         AND date(COALESCE(i.published_at, i.fetched_at)) < date('now')
         AND date(COALESCE(i.published_at, i.fetched_at)) >= date('now', '-30 day')
       ORDER BY c.id DESC LIMIT 40`
    )
    .all(...entityIds) as unknown as { entity: string; text: string; d: string }[];
  return rows;
}

/** C 层：认知原子库全量（38 条级别，statement 短，直接全喂） */
function allAtoms(): { id: number; type: string; statement: string }[] {
  const db = getDb();
  return db
    .prepare(`SELECT id, type, statement FROM nuggets WHERE status != 'retired' ORDER BY confidence DESC LIMIT 40`)
    .all() as unknown as { id: number; type: string; statement: string }[];
}

export async function buildDigest(date?: string): Promise<{ date: string; content: string }> {
  const db = getDb();
  const d = date ?? new Date().toISOString().slice(0, 10);

  const topics = db
    .prepare(
      `SELECT c.entity_id, e.name, e.type, COUNT(*) as cnt,
              JSON_GROUP_ARRAY(JSON_OBJECT('title', i.title, 'tier', i.tier,
                 'polarity', c.polarity, 'published_at', i.published_at)) as items
       FROM claims c
       JOIN entities e ON e.id = c.entity_id
       JOIN items i ON i.id = c.item_id
       WHERE date(COALESCE(i.published_at, i.fetched_at)) = ?
       GROUP BY c.entity_id ORDER BY cnt DESC LIMIT 20`
    )
    .all(d) as unknown as TopicRow[];

  const statsRow = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM items WHERE date(COALESCE(published_at, fetched_at)) = ?) as items,
              (SELECT COUNT(*) FROM claims c JOIN items i ON i.id=c.item_id
                WHERE date(COALESCE(i.published_at, i.fetched_at)) = ?) as claims`
    )
    .get(d, d) as unknown as { items: number; claims: number };

  let content: string;

  if (topics.length === 0) {
    content = `# WorldLens 每日简报 · ${d}\n\n今日暂无匹配关注实体的信息。触发采集后重试。`;
  } else if (llmEnabled) {
    const corpus = topics
      .map((t) => `## ${t.name}（${t.type}，${t.cnt}条）\n${fmtItems(t.items)}`)
      .join("\n\n");

    const entityIds = topics.map((t) => t.entity_id);
    const hist = historyClaims(entityIds);
    const histBlock = hist.length
      ? hist.map((h) => `- [${h.d}]（${h.entity}）${h.text}`).join("\n")
      : "（近 30 天无同实体历史主张）";
    const atoms = allAtoms();
    const atomBlock = atoms.length
      ? atoms.map((a) => `- #${a.id}（${a.type}）${a.statement}`).join("\n")
      : "（认知库为空）";

    content = await chat(
      `你是世界理解引擎的主编。你手上有三层材料：
A. 今日快讯（带信源分级 T0官方/T1权威/T2行业/T3观点，▲看多 ▼看空）
B. 同一实体的历史主张（过去 30 天说过什么）
C. 用户的认知原子库（用户长期保存、亲手沉淀的理解）

输出 markdown 简报，四节结构（总长 800-1500 字）：
## 今日主线
3-5 条。每条格式：**一句话结论**（带信源标签），后接 2-3 句展开（机制、数字、影响路径）。只陈述，不抒情。
## 与历史的对话
今日信息和 B 层历史主张的对照：印证了什么？推翻/修正了什么？同一件事的说法在如何演变？每条对照写清"历史说了 X → 今天出现 Y → 说明 Z"。若 B 层为空或确无对照，就诚实写"今日信息为新增视角，暂无历史对照"——绝不编造对照关系。
## 与你的认知库的对话
今日信息与 C 层原子对照。每条联动格式：**今日信息（一句概括）** ↔ 原子 #n"原句"→ 印证/挑战/补充 + 一句为什么。纪律：只在信息真实触及原子内容时才写——共享主题词不算联动，必须有实质的逻辑关联（同一因果链、同一变量的两面、同一判断的验证）。没有真实联动就诚实写"今日信息与认知库暂无实质关联"。
## 值得追踪
2-3 个待验证的信号（具体、可证伪）。

纪律：只输出 markdown，不要客套；「对话」两节是简报的灵魂——宁可少而真，不可多而凑；但真实的对照要写透（机制+影响），不要一句话带过。`,
      `【A. 今日快讯】\n${corpus.slice(0, 9000)}\n\n【B. 同实体历史主张（近30天）】\n${histBlock.slice(0, 3500)}\n\n【C. 用户认知原子库】\n${atomBlock.slice(0, 3500)}`,
      { maxTokens: 4000, temperature: 0.3, purpose: "digest_v2" }
    );
    content = `# WorldLens 每日简报 · ${d}\n\n${content}`;
  } else {
    // 规则模板兜底
    content = `# WorldLens 每日简报 · ${d}\n\n> 今日采集 ${statsRow.items} 条 / 命中主张 ${statsRow.claims} 条\n\n`;
    content += topics
      .map(
        (t) =>
          `## ${t.name}（${t.type} · ${t.cnt}条）\n\n${fmtItems(t.items)}\n`
      )
      .join("\n");
  }

  db.prepare(
    `INSERT INTO digests (date, content, stats) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET content = excluded.content, stats = excluded.stats,
       created_at = datetime('now')`
  ).run(d, content, JSON.stringify(statsRow));

  return { date: d, content };
}

/** 首页用：命中实体的热度榜（近7天） */
export function topEntities(days = 7): { name: string; type: string; cnt: number }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT e.name, e.type, COUNT(*) as cnt
       FROM claims c JOIN entities e ON e.id = c.entity_id
       JOIN items i ON i.id = c.item_id
       WHERE date(COALESCE(i.published_at, i.fetched_at)) >= date('now', ?)
       GROUP BY e.id ORDER BY cnt DESC LIMIT 15`
    )
    .all(`-${days} day`) as unknown as { name: string; type: string; cnt: number }[];
}
