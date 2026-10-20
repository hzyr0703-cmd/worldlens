import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { linkNewAtoms } from "@/lib/links/linker";

export const maxDuration = 300;

/** 全库补连边：找出零连边原子，逐个走共享连边引擎入网。
 *  用途：引擎上线前的存量原子修复、FTS 索引重建后的补连。 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const orphans = db
    .prepare(
      `SELECT n.id FROM nuggets n
       WHERE n.status != 'retired'
         AND NOT EXISTS (SELECT 1 FROM nugget_links l WHERE l.src_id = n.id OR l.dst_id = n.id)
       ORDER BY n.id LIMIT 40`
    )
    .all() as unknown as { id: number }[];

  if (orphans.length === 0) return NextResponse.json({ ok: true, scanned: 0, ...{ links: 0, reinforced: 0, contradicted: 0 } });

  const r = await linkNewAtoms(
    orphans.map((o) => o.id),
    new Date().toISOString().slice(0, 10)
  );
  return NextResponse.json({ ok: true, scanned: orphans.length, ...r });
}
