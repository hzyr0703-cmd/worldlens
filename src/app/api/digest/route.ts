import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDigest } from "@/lib/digest/daily";
import { isAuthed } from "@/lib/auth";
import { jobState, startJob, startedBody } from "@/lib/background";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const db = getDb();
  const d = date ?? new Date().toISOString().slice(0, 10);

  const existing = db.prepare(`SELECT content, stats FROM digests WHERE date = ?`).get(d) as
    | { content: string; stats: string }
    | undefined;

  if (existing) return NextResponse.json({ date: d, content: existing.content, stats: existing.stats, cached: true });

  // 无缓存时构建会花掉一次 16000+ max_tokens 的 LLM 调用——只允许已登录者触发
  if (!isAuthed(req)) {
    return NextResponse.json({ ok: false, error: "该日暂无简报，生成需要登录" }, { status: 404 });
  }
  const built = await buildDigest(d);
  return NextResponse.json({ ...built, cached: false });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { date, deep, refresh } = (await req.json().catch(() => ({}))) as {
    date?: string;
    deep?: boolean;
    refresh?: boolean;
  };
  const d = date ?? new Date().toISOString().slice(0, 10);
  try {
    // 当日已有简报就直接返回：重建要 30-150 秒，是这个按钮最容易"点了没反应"的原因。
    // 需要重写时传 refresh:true（或走 deep 深度版）。
    if (!refresh && !deep) {
      const existing = getDb().prepare(`SELECT content FROM digests WHERE date = ?`).get(d) as
        | { content: string }
        | undefined;
      if (existing?.content) {
        return NextResponse.json({ date: d, content: existing.content, model: "cached", cached: true });
      }
    }
    // 深度版要跑 100-150 秒，同样超网关限制——后台跑
    if (deep) {
      const { started } = startJob("digest-deep", async () => {
        const built = await buildDigest(date, { deep: true });
        return `深度简报 ${built.content.length} 字`;
      });
      return NextResponse.json(startedBody("深度简报", started, "深度简报已启动"));
    }
    const built = await buildDigest(date, { deep: false });
    return NextResponse.json(built);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
