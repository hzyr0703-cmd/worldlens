import Parser from "rss-parser";
import { getDb, contentHash } from "@/lib/db";

// ---------------------------------------------------------------------------
// RSS 采集：拉取 → 解析 → 去重 → 入库。幂等，可反复触发。
// ---------------------------------------------------------------------------

const parser: Parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "WorldLens/0.1 (+personal cognitive collector)" },
});

export type IngestResult = {
  source: string;
  fetched: number;
  inserted: number;
  error?: string;
};

/** guid 缺失时的兜底指纹 */
function guidOf(link: string, title: string): string {
  return link || `t:${contentHash(title)}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchSource(source: {
  id: number;
  name: string;
  url: string;
  tier: number;
}): Promise<IngestResult> {
  const db = getDb();
  try {
    const feed = await parser.parseURL(source.url);
    let inserted = 0;
    const fetched = feed.items.length;

    for (const item of feed.items) {
      const title = stripHtml(item.title ?? "").slice(0, 500);
      if (!title) continue;
      const link = item.link ?? "";
      const guid = guidOf(link, title);
      const content = stripHtml(
        (item as { content?: string }).content ?? item.contentSnippet ?? ""
      ).slice(0, 5000);
      const published = item.isoDate ?? item.pubDate ?? null;
      const hash = contentHash(title);

      // 幂等：guid 唯一约束 + 同日同标题跨源去重（content_hash 相近的跳过）
      const dup = db
        .prepare(
          `SELECT id FROM items WHERE guid = ? OR (content_hash = ? AND date(published_at) = date(?))`
        )
        .get(guid, hash, published ?? new Date().toISOString());
      if (dup) continue;

      db.prepare(
        `INSERT INTO items (source_id, guid, title, content, link, tier, published_at, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        source.id,
        guid,
        title,
        content || title,
        link,
        source.tier,
        published,
        hash
      );
      inserted++;
    }

    db.prepare(`UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?`).run(
      source.id
    );
    return { source: source.name, fetched, inserted };
  } catch (e) {
    return {
      source: source.name,
      fetched: 0,
      inserted: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function ingestAll(): Promise<IngestResult[]> {
  const db = getDb();
  const sources = db
    .prepare(`SELECT id, name, url, tier FROM sources WHERE enabled = 1`)
    .all() as unknown as { id: number; name: string; url: string; tier: number }[];

  // 串行拉取避免公共 RSSHub 实例限流
  const results: IngestResult[] = [];
  for (const s of sources) {
    results.push(await fetchSource(s));
  }
  return results;
}
