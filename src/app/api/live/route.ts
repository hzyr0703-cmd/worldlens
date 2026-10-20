import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** 实时版本号：客户端轮询此接口，任一数字变化就 refresh 页面 */
export async function GET() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         (SELECT COALESCE(MAX(id),0) FROM items) AS items,
         (SELECT COALESCE(MAX(id),0) FROM claims) AS claims,
         (SELECT COALESCE(MAX(id),0) FROM nuggets) AS nuggets,
         (SELECT COALESCE(MAX(created_at),'') FROM digests) AS digest_at,
         (SELECT COUNT(*) FROM review_cards WHERE due <= datetime('now')) AS due`
    )
    .get() as unknown as { items: number; claims: number; nuggets: number; digest_at: string; due: number };
  return NextResponse.json(row, { headers: { "Cache-Control": "no-store" } });
}
