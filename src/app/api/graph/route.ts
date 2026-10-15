import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** 图谱数据：近30天 co_mention 边，weight>=2 的有效骨架 */
export async function GET() {
  const db = getDb();
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

  return NextResponse.json({ nodes, edges });
}
