import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * 图谱数据。
 *
 * 设计原则：图上每一条线都要能回答"凭什么连"。
 * - entities 模式原先直接按"同篇文章共同出现"连边，结果最粗的线是「金十数据—金十」
 *   （同一实体的两种写法）和「交易所—交易」（词频）——噪音把真结构淹没了。
 *   现在：过滤媒体名/元词实体，每个节点只保留最强的 K 条边，并给每条边附共现证据原文。
 * - atoms 模式保留全部关系边（关系类型本身有语义），节点标签在前端用完整 statement 生成。
 */

/** 媒体名 / 数据商 / 元词：它们与谁"同篇出现"不构成关系，只会污染图 */
const NOISE_ENTITIES = new Set([
  "财联社", "金十数据", "金十", "证券时报", "东方财富", "华尔街见闻", "华尔街日报",
  "路透", "路透社", "彭博", "彭博社", "新华社", "人民日报", "央视", "第一财经",
  "The Verge", "TechCrunch", "Reuters", "Bloomberg",
  "交易所", "交易", "关联交易", "资金", "处罚", "公告", "公司", "市场",
  "投资者", "股价", "股价上涨", "股市", "A股", "港股", "美股",
  "产品", "创新", "行业", "数据", "报告", "消息", "分析师",
]);
/** 纯时间词做实体毫无意义（「2027年」和谁都能共现） */
const NOISE_PATTERN = /^(\d{4}年|\d{1,2}月|\d{4}-\d{2}|今年|明年|去年|本季度|同比|环比)$/;

/** 抽取时没能归一的同义实体（已知数据债）：指向同一对象，不能互为"关系" */
const SAME_PAIRS: [string, string][] = [
  ["工信部", "工业和信息化部"],
  ["MSCI", "明晟公司"],
  ["纳斯达克", "纳指100"],
];

/** 每个节点保留的最强边数——K 越大越密，4 是 60 节点下的可读上限 */
const EDGES_PER_NODE = 4;
const MAX_NODES = 60;

export async function GET(req: NextRequest) {
  const db = getDb();
  const mode = req.nextUrl.searchParams.get("mode") ?? "entities";

  if (mode === "atoms") {
    // 按度数（而不是置信度）取节点：先挑出真正参与关系的原子，
    // 否则高置信度的孤立原子会占满名额，图上只剩散点（曾出现 80 节点只有 36 条边）
    const nodes = db
      .prepare(
        `SELECT n.id, n.type, n.statement, n.confidence, n.domain, n.status,
                (SELECT COUNT(*) FROM nugget_links l WHERE l.src_id = n.id OR l.dst_id = n.id) AS degree
         FROM nuggets n
         WHERE n.status != 'retired'
           AND n.id IN (SELECT src_id FROM nugget_links UNION SELECT dst_id FROM nugget_links)
         ORDER BY degree DESC, n.confidence DESC LIMIT 80`
      )
      .all() as unknown as {
      id: number; type: string; statement: string; confidence: number; domain: string; status: string; degree: number;
    }[];

    const ids = new Set(nodes.map((n) => n.id));
    const edges = (
      db
        .prepare(
          `SELECT src_id, dst_id, relation, rationale FROM nugget_links
           WHERE src_id IN (SELECT id FROM nuggets WHERE status != 'retired')
             AND dst_id IN (SELECT id FROM nuggets WHERE status != 'retired')
           LIMIT 600`
        )
        .all() as unknown as { src_id: number; dst_id: number; relation: string; rationale: string }[]
    ).filter((e) => ids.has(e.src_id) && ids.has(e.dst_id));

    return NextResponse.json({ mode, nodes, edges });
  }

  // ── 实体共现 ──────────────────────────────────────────────────────────────
  // 45 天窗口内、双方提及数 ≥3 的实体对。
  // 关键：不能按"共同出现的文章数"排序——那会把 AI/中国/美国 这类泛实体顶到最前
  // （AI—中国 共现 102 次，但重叠度只有 0.077）。改用重叠度 Jaccard = w/(ma+mb-w)，
  // 真正绑在一起的对象才会浮上来：SK海力士—三星电子 0.415、上证—深证成指 0.400。
  const pairRows = db
    .prepare(
      `SELECT c1.entity_id AS a, c2.entity_id AS b, COUNT(DISTINCT c1.item_id) AS w,
              e1.mention_count AS ma, e2.mention_count AS mb
       FROM claims c1
       JOIN claims c2 ON c1.item_id = c2.item_id AND c1.entity_id < c2.entity_id
       JOIN entities e1 ON e1.id = c1.entity_id AND e1.mention_count >= 3
       JOIN entities e2 ON e2.id = c2.entity_id AND e2.mention_count >= 3
       WHERE date(COALESCE((SELECT published_at FROM items WHERE id = c1.item_id), '2000-01-01')) >= date('now', '-45 day')
          OR (SELECT published_at FROM items WHERE id = c1.item_id) IS NULL
       GROUP BY a, b
       ORDER BY w DESC LIMIT 800`
    )
    .all() as unknown as { a: number; b: number; w: number; ma: number; mb: number }[];

  /** 重叠度：两实体共现文章数 / 它们出现过的文章并集 */
  const jaccardOf = (p: { w: number; ma: number; mb: number }) =>
    p.w / Math.max(1, p.ma + p.mb - p.w);

  const entRows = db
    .prepare(`SELECT id, name, type, mention_count, aliases FROM entities WHERE mention_count >= 3`)
    .all() as unknown as { id: number; name: string; type: string; mention_count: number; aliases: string }[];
  const entMap = new Map(entRows.map((e) => [e.id, e]));
  const isNoise = (id: number) => {
    const e = entMap.get(id);
    return !e || NOISE_ENTITIES.has(e.name) || NOISE_PATTERN.test(e.name);
  };

  /* 别名互斥：一句话提到「英伟达」会同时命中实体「英伟达」和把英伟达当别名的「AI算力」，
     于是两者共现 88 次——那不是关系，是同一实体的两种写法自己跟自己。同类还有
     纳斯达克/纳指100。凡是 A 的名字出现在 B 的 alias 里（或反之），这条边不画。 */
  const aliasOwner = new Map<string, Set<number>>();
  for (const e of entRows) {
    try {
      for (const a of JSON.parse(e.aliases ?? "[]") as string[]) {
        if (typeof a !== "string" || a === e.name) continue;
        const set = aliasOwner.get(a) ?? new Set<number>();
        set.add(e.id);
        aliasOwner.set(a, set);
      }
    } catch {
      /* 坏别名忽略 */
    }
  }
  const samePairs = new Set<string>();
  for (const [x, y] of SAME_PAIRS) {
    samePairs.add(`${x}|${y}`);
    samePairs.add(`${y}|${x}`);
  }
  const sameIdentity = (a: number, b: number) => {
    const na = entMap.get(a)?.name;
    const nb = entMap.get(b)?.name;
    if (!na || !nb) return false;
    if (samePairs.has(`${na}|${nb}`)) return true;
    return Boolean(aliasOwner.get(na)?.has(b) || aliasOwner.get(nb)?.has(a));
  };

  const clean = pairRows
    .filter((p) => !isNoise(p.a) && !isNoise(p.b) && !sameIdentity(p.a, p.b))
    .map((p) => ({ ...p, j: jaccardOf(p) }))
    // 重叠度 <5% = 只是"碰巧同在一篇文章"，不配占一条线
    .filter((p) => p.j >= 0.05);

  // 每个节点只留最强 K 条边：线少一半，结构反而看得清
  const perNode = new Map<number, typeof clean>();
  for (const e of clean) {
    for (const k of [e.a, e.b]) {
      const arr = perNode.get(k);
      if (arr) arr.push(e);
      else perNode.set(k, [e]);
    }
  }
  const keptKeys = new Set<string>();
  const kept: typeof clean = [];
  for (const arr of perNode.values()) {
    arr.sort((x, y) => y.j - x.j);
    for (const e of arr.slice(0, EDGES_PER_NODE)) {
      const key = `${e.a}-${e.b}`;
      if (keptKeys.has(key)) continue;
      keptKeys.add(key);
      kept.push(e);
    }
  }

  const degree = new Map<number, number>();
  for (const e of kept) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const nodes = [...degree.keys()]
    .map((id) => entMap.get(id)!)
    .sort((x, y) => (degree.get(y.id)! - degree.get(x.id)!) || (y.mention_count - x.mention_count))
    .slice(0, MAX_NODES)
    .map((n) => ({ id: n.id, name: n.name, type: n.type, weight: n.mention_count, degree: degree.get(n.id)! }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const finalEdges = kept
    .filter((e) => nodeIds.has(e.a) && nodeIds.has(e.b))
    .sort((x, y) => y.j - x.j)
    .slice(0, 240);

  // 共现证据：每条边给最近 2 篇原文标题——"它们凭什么连"必须能点开看
  const evidence = new Map<string, { id: number; title: string; date: string }[]>();
  if (finalEdges.length > 0) {
    const evRows = db
      .prepare(
        `SELECT c1.entity_id AS a, c2.entity_id AS b, c1.item_id AS id, i.title,
                substr(COALESCE(i.published_at, i.fetched_at), 1, 10) AS d
         FROM claims c1
         JOIN claims c2 ON c1.item_id = c2.item_id AND c1.entity_id < c2.entity_id
         JOIN items i ON i.id = c1.item_id
         JOIN entities e1 ON e1.id = c1.entity_id AND e1.mention_count >= 3
         JOIN entities e2 ON e2.id = c2.entity_id AND e2.mention_count >= 3
         WHERE date(COALESCE(i.published_at, i.fetched_at)) >= date('now', '-45 day')
         ORDER BY COALESCE(i.published_at, i.fetched_at) DESC
         LIMIT 6000`
      )
      .all() as unknown as { a: number; b: number; id: number; title: string; d: string }[];
    for (const r of evRows) {
      const key = `${r.a}-${r.b}`;
      if (!keptKeys.has(key)) continue;
      const arr = evidence.get(key) ?? [];
      if (arr.length >= 2) continue;
      arr.push({ id: r.id, title: r.title.slice(0, 60), date: r.d ?? "" });
      evidence.set(key, arr);
    }
  }

  const edges = finalEdges.map((e) => ({
    src_id: e.a,
    dst_id: e.b,
    weight: e.w,
    /** 重叠度：0-1。用来画线宽与排序——比绝对次数更能代表"真的绑在一起" */
    overlap: Number(e.j.toFixed(3)),
    evidence: evidence.get(`${e.a}-${e.b}`) ?? [],
  }));

  return NextResponse.json({ mode: "entities", nodes, edges });
}
