import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { curateAll } from "@/lib/supply/curator";
import { jobState, startJob, startedBody } from "@/lib/background";

/** 供给要抓取多篇长文再 LLM 筛选，几十秒到几分钟——后台跑 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { started } = startJob("supply", async () => {
    const results = await curateAll();
    const added = results.reduce((s, r) => s + r.added, 0);
    return `新增 ${added} 篇深度文章`;
  });
  return NextResponse.json(startedBody("供给", started, "供给已启动"));
}

export async function GET() {
  return NextResponse.json({ ok: true, job: jobState("supply") });
}
