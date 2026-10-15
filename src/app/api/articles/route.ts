import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** 手动投喂深度文章 + RSS 长文筛选入库 */
export async function POST(req: NextRequest) {
  const { title, body, url, domain, origin } = (await req.json()) as {
    title?: string; body?: string; url?: string; domain?: string; origin?: string;
  };
  if (!body || body.length < 300) {
    return NextResponse.json({ ok: false, error: "正文太短（<300字），深度文章才有拷问价值" }, { status: 400 });
  }
  const db = getDb();
  const info = db
    .prepare(`INSERT INTO articles (title, url, body, domain, origin, word_count) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      title ?? body.slice(0, 40),
      url ?? "",
      body,
      domain === "ai" ? "ai" : "finance",
      origin ?? "paste",
      body.length
    ) as unknown as { lastInsertRowid: number | bigint };
  return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) });
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.url, a.domain, a.origin, a.word_count, a.quizzed, a.added_at,
              (SELECT COUNT(*) FROM quizzes q WHERE q.article_id = a.id) AS quiz_count,
              (SELECT COUNT(*) FROM quizzes q WHERE q.article_id = a.id AND q.state = 'answered') AS answered_count
       FROM articles a ORDER BY a.id DESC LIMIT 50`
    )
    .all();
  return NextResponse.json({ ok: true, articles: rows });
}
