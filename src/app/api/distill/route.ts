import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { distillDaily } from "@/lib/distill/pipeline";
import { jobState, startJob, startedBody } from "@/lib/background";

/** 蒸馏是 LLM 推理，几分钟到几十分钟，同步返回必超时——后台跑 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { date } = (await req.json().catch(() => ({}))) as { date?: string };
  const { started } = startJob("distill", async () => {
    const r = await distillDaily(date);
    return `扫描 ${r.scanned} 条 → 新原子 ${r.created} · 连边 ${r.links} · 印证 ${r.reinforced} · 矛盾 ${r.contradicted}`;
  });
  return NextResponse.json(startedBody("蒸馏", started, "蒸馏已启动"));
}

export async function GET() {
  return NextResponse.json({ ok: true, job: jobState("distill") });
}
