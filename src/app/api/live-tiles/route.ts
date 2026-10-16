import { NextResponse } from "next/server";
import { getLiveTiles } from "@/lib/tiles";

export const dynamic = "force-dynamic";

/** Hero 方块矩阵轮询接口：每次返回最新快讯（中文为主，英文 ≤4 条） */
export async function GET() {
  return NextResponse.json({ ok: true, tiles: getLiveTiles() });
}
