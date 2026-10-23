import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { buildChains, ensureVerifyPoints, refreshChainViews, refreshChainViewsByRule } from "@/lib/chain/builder";
import { getDb } from "@/lib/db";
import { jobState, startJob, startedBody } from "@/lib/background";

/** 建链单次 LLM 调用实测平均 116 秒，远超网关 60 秒上限——后台跑 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { refreshAll?: boolean };

  // 只刷新存量链条的「现在/接下来」（不建新链）
  if (body.refreshAll) {
    const { started } = startJob("chains-refresh", async () => {
      const db = getDb();
      const ids = (db
        .prepare(`SELECT id FROM chains WHERE status != 'archived' ORDER BY updated_at DESC LIMIT 8`)
        .all() as unknown as { id: number }[]).map((r) => r.id);
      const base = refreshChainViewsByRule(ids); // 规则版保底
      const llm = await refreshChainViews(ids); // LLM 版覆盖（可能为 0）
      const verified = await ensureVerifyPoints(5); // 补过期/缺失的验证点
      return `刷新 ${base} 条（LLM 增强 ${llm} 条）· 补验证点 ${verified}`;
    });
    return NextResponse.json(startedBody("链条刷新", started, "链条刷新已启动"));
  }

  const { started } = startJob("chains", async () => {
    const r = await buildChains();
    const verified = await ensureVerifyPoints(3); // 没有新链时也要维护验证点
    return `新建 ${r.created} 条 · 延展 ${r.extended} 环 · 断裂 ${r.broken} · 补验证点 ${verified}`;
  });
  return NextResponse.json(startedBody("建链", started, "建链已启动"));
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    build: jobState("chains"),
    refresh: jobState("chains-refresh"),
  });
}
