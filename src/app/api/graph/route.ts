import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** 图谱数据：?mode=entities（默认，实体共现骨架）| mode=atoms（认知原子关系网） */
export async function GET(req: NextRequest) {
  const db = getDb();
  const mode = req.nextUrl.searchParams.get("mode") ?? "entities";

  if (mode === "atoms") {
    // 原子关系网：节点=活跃原子（含类型/置信度），边=nugget_links 五种关系
    const nodes = db
      .prepare(
        `SELECT n.id, n.type, n.statement, n.confidence, n.domain, n.status,
                (SELECT COUNT(*) FROM nugget_links l WHERE l.src_id = n.id OR l.dst_id = n.id) AS degree
         FROM nuggets n
         WHERE n.status != 'retired'
           AND n.id IN (SELECT src_id FROM nugget_links UNION SELECT dst_id FROM nugget_links)
         ORDER BY n.confidence DESC LIMIT 80`
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
           LIMIT 300`
        )
        .all() as unknown as { src_id: number; dst_id: number; relation: string; rationale: string }[]
    ).filter((e) => ids.has(e.src_id) && ids.has(e.dst_id));

    return NextResponse.json({ mode, nodes, edges });
  }

  // 默认：实体共现 —— 从 claims 实时聚合（同一篇文章里同时出现的实体对）
  // 比 edges 历史累积更准：只反映当前数据里的真实共现，不受历史噪音影响
  const pairRows = db
    .prepare(
      `SELECT c1.entity_id AS a, c2.entity_id AS b, COUNT(DISTINCT c1.item_id) AS w
       FROM claims c1
       JOIN claims c2 ON c1.item_id = c2.item_id AND c1.entity_id < c2.entity_id
       JOIN entities e1 ON e1.id = c1.entity_id AND e1.mention_count >= 3
       JOIN entities e2 ON e2.id = c2.entity_id AND e2.mention_count >= 3
       WHERE date(COALESCE((SELECT published_at FROM items WHERE id = c1.item_id), '2000-01-01')) >= date('now', '-45 day')
          OR (SELECT published_at FROM items WHERE id = c1.item_id) IS NULL
       GROUP BY a, b
       ORDER BY w DESC LIMIT 400`
    )
    .all() as unknown as { a: number; b: number; w: number }[];

  // 节点：出现在边里的实体，按度数 + 提及次数排序取 60
  const degree = new Map<number, number>();
  for (const r of pairRows) {
    degree.set(r.a, (degree.get(r.a) ?? 0) + 1);
    degree.set(r.b, (degree.get(r.b) ?? 0) + 1);
  }
  const nodeRows = db
    .prepare(
      `SELECT id, name, type, mention_count FROM entities WHERE mention_count >= 3`
    )
    .all() as unknown as { id: number; name: string; type: string; mention_count: number }[];
  const nodes = nodeRows
    .filter((n) => degree.has(n.id))
    .sort((x, y) => (degree.get(y.id)! - degree.get(x.id)!) || (y.mention_count - x.mention_count))
    .slice(0, 60)
    .map((n) => ({ id: n.id, name: n.name, type: n.type, weight: n.mention_count }));

  const ids = new Set(nodes.map((n) => n.id));
  const edges = pairRows
    .filter((r) => ids.has(r.a) && ids.has(r.b))
    .map((r) => ({ src_id: r.a, dst_id: r.b, weight: r.w }))
    .slice(0, 300);

  return NextResponse.json({ mode: "entities", nodes, edges });
}
