import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { linkNewAtomsBatch } from "@/lib/links/linker";
import { jobState, startJob, startedBody } from "@/lib/background";

/** 全库补连边：找出零连边原子，逐个走共享连边引擎入网。
 *  用途：引擎上线前的存量原子修复、全文检索方案切换后的补连。
 *  连边是 LLM 长任务（60 原子约 3-5 分钟），后台跑。 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const orphans = db
    .prepare(
      `SELECT n.id FROM nuggets n
       WHERE n.status != 'retired'
         AND NOT EXISTS (SELECT 1 FROM nugget_links l WHERE l.src_id = n.id OR l.dst_id = n.id)
       ORDER BY n.id LIMIT 60`
    )
    .all() as unknown as { id: number }[];

  if (orphans.length === 0) {
    return NextResponse.json({ ok: true, started: false, message: "没有孤立原子，无需补连" });
  }

  const ids = orphans.map((o) => o.id);
  const { started } = startJob("relink", async () => {
    const r = await linkNewAtomsBatch(ids, new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
    return `扫描 ${ids.length} · 连边 ${r.links} · 印证 ${r.reinforced} · 矛盾 ${r.contradicted}`;
  });
  return NextResponse.json(startedBody("补连边", started, "补连边已启动"));
}

export async function GET() {
  return NextResponse.json({ ok: true, job: jobState("relink") });
}
