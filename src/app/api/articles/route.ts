import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { condenseForStorage } from "@/lib/supply/curator";

/** 手动投喂深度文章（来源标注：official/anecdote/rumor，口述传闻沉淀时置信打折） */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { title, body, url, domain, origin, sourceKind } = (await req.json()) as {
    title?: string; body?: string; url?: string; domain?: string; origin?: string; sourceKind?: string;
  };
  if (!body || body.length < 300) {
    return NextResponse.json({ ok: false, error: "正文太短（<300字），深度文章才有拷问价值" }, { status: 400 });
  }
  const kind = ["official", "anecdote", "rumor"].includes(sourceKind ?? "") ? sourceKind! : "official";
  const db = getDb();
  // 手动投喂同样执行字数治理：>3000 字先语义压缩，原文留档（失败则保留原样并提示）
  let stored = body;
  let original = "";
  if (body.length > 3000) {
    const condensed = await condenseForStorage(body);
    if (condensed) {
      original = body;
      stored = condensed;
    }
  }
  const info = db
    .prepare(`INSERT INTO articles (title, url, body, original_body, domain, origin, source_kind, word_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      title ?? stored.slice(0, 40),
      url ?? "",
      stored,
      original,
      domain === "ai" ? "ai" : domain === "tech" ? "tech" : "finance",
      origin ?? "paste",
      kind,
      stored.length
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
