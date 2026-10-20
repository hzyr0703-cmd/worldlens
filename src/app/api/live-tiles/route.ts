import { NextRequest, NextResponse } from "next/server";
import { getLiveTiles } from "@/lib/tiles";

export const dynamic = "force-dynamic";

/** Hero 方块矩阵轮询接口：每次返回最新快讯（中文为主，英文 ≤4 条）。
 *  offset 用于"换一批"：跳过最近 offset 条往后取。 */
export async function GET(req: NextRequest) {
  const offsetRaw = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  return NextResponse.json({ ok: true, tiles: getLiveTiles(42, 4, offset) });
}
