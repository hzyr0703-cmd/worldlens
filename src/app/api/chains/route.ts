import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { buildChains, ensureVerifyPoints, refreshChainViews, refreshChainViewsByRule } from "@/lib/chain/builder";
import { getDb } from "@/lib/db";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { refreshAll?: boolean };

  // 只刷新存量链条的「现在/接下来」（不建新链）
  if (body.refreshAll) {
    const db = getDb();
    const ids = (db
      .prepare(`SELECT id FROM chains WHERE status != 'archived' ORDER BY updated_at DESC LIMIT 8`)
      .all() as unknown as { id: number }[]).map((r) => r.id);
    const base = refreshChainViewsByRule(ids); // 规则版保底
    const llm = await refreshChainViews(ids);  // LLM 版覆盖（可能为 0）
    const verified = await ensureVerifyPoints(5); // 补过期/缺失的验证点
    return NextResponse.json({ ok: true, refreshed: base, llmEnhanced: llm, verified, scanned: ids.length });
  }

  const r = await buildChains();
  const verified = await ensureVerifyPoints(3); // 没有新链时也要维护验证点
  return NextResponse.json({ ok: true, ...r, verified });
}
