import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { ingestAll } from "@/lib/ingest/rss";
import { ingestCninfo } from "@/lib/ingest/cninfo";
import { extractPending } from "@/lib/extract/entities";
import { ensureSeed } from "@/app/api/seed/route";
import { jobState, startJob, startedBody } from "@/lib/background";

/** 采集 26 个源实测 60-90 秒，超过网关的 60 秒上限——必须后台跑，POST 立即返回 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { started } = startJob("ingest", async () => {
    ensureSeed();
    const ingest = await ingestAll();
    const cninfo = await ingestCninfo();
    const extract = await extractPending();
    const fetched = ingest.reduce((s, x) => s + x.fetched, 0);
    const inserted = ingest.reduce((s, x) => s + x.inserted, 0);
    const failed = ingest.filter((x) => x.error).length;
    const cn = Object.values(cninfo).reduce((s, n) => s + n, 0);
    return `采集 ${fetched} 条 / 入库 ${inserted + cn} 条 / 失败源 ${failed} · 抽实体 ${extract.processed}`;
  });
  return NextResponse.json(startedBody("采集", started, "采集已启动"));
}

/** 状态查询：前端可轮询，也可直接刷新页面看新数据 */
export async function GET() {
  return NextResponse.json({ ok: true, job: jobState("ingest") });
}
