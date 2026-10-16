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

  // 默认：实体共现
  const nodes = db
    .prepare(
      `SELECT e.id, e.name, e.type, e.mention_count as weight
       FROM entities e
       WHERE e.id IN (
         SELECT src_id FROM edges WHERE last_seen >= datetime('now', '-30 day') AND weight >= 1
         UNION
         SELECT dst_id FROM edges WHERE last_seen >= datetime('now', '-30 day') AND weight >= 1
       )
       ORDER BY e.mention_count DESC LIMIT 60`
    )
    .all() as unknown as { id: number; name: string; type: string; weight: number }[];

  const ids = new Set(nodes.map((n) => n.id));
  const edges = (
    db
      .prepare(
        `SELECT src_id, dst_id, weight FROM edges
         WHERE relation = 'co_mention' AND weight >= 1
           AND last_seen >= datetime('now', '-30 day') LIMIT 200`
      )
      .all() as unknown as { src_id: number; dst_id: number; weight: number }[]
  ).filter((e) => ids.has(e.src_id) && ids.has(e.dst_id));

  return NextResponse.json({ mode: "entities", nodes, edges });
}
