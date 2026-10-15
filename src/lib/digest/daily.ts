import { getDb } from "@/lib/db";
import { chat, llmEnabled } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 每日简报：按实体聚类当日信息 → LLM 叙事综述（无 key 时规则模板兜底）。
// 存 digests 表，date 唯一，重复调用覆盖更新。
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
    content = await chat(
      `你是世界理解引擎的简报主编。基于带信源分级标签的财经快讯，输出 markdown 简报：
1. 开头3-5条「今日主线」（一句话一条，带信源标签）
2. 按主题分节综述，标明信息源等级，区分事实(T0/T1)与观点(T3)
3. 结尾「值得追踪」列2-3个待验证的信号
只输出 markdown，不要客套。`,
      corpus.slice(0, 12000),
      { maxTokens: 3000, temperature: 0.3 }
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
