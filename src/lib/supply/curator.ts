import Parser from "rss-parser";
import { getDb } from "@/lib/db";
import { chat, llmEnabled } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 深度文章供给管线 — 快讯是背景流，这里负责找"值得精读的一篇"。
// 通道：① RSS 全文直取（阮一峰周刊等） ② 摘要型源 → 抓取文章页正文（36kr/sspai 等）
// 入库标准：正文 ≥ 500 字；URL 去重；>3000 字先 AI 精简到 ≤3000 字再入库（保留全部论点/机制/数据/反例）。
// ---------------------------------------------------------------------------

const MAX_ARTICLE_CHARS = 3000;

const parser: Parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (WorldLens/0.2; personal cognitive trainer)" },
});

type FeedDef = {
  name: string;
  url: string;
  domain: "finance" | "ai" | "tech";
  mode: "fulltext" | "scrape"; // fulltext: RSS 即全文；scrape: 拿链接后抓正文
};

// 只供给中文文章（用户明确不要英文文章）；英文源仅作快讯背景流
export const SUPPLY_FEEDS: FeedDef[] = [
  { name: "阮一峰·科技爱好者周刊", url: "https://www.ruanyifeng.com/blog/atom.xml", domain: "tech", mode: "fulltext" },
  { name: "少数派", url: "https://sspai.com/feed", domain: "tech", mode: "scrape" },
  { name: "36氪", url: "https://hub.slarker.me/36kr/newsflashes", domain: "finance", mode: "scrape" },
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 通用正文提取：SSR 文章页取长段落拼合（36kr/sspai/虎嗅类站点实测可用） */
export async function scrapeArticle(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`scrape ${res.status}`);
  const html = await res.text();
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]).replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 30);
  return paras.join("\n\n");
}

export type SupplyResult = { feed: string; fetched: number; added: number; error?: string };

/** 长文入库前精简：压缩到 ≤3000 字，失败重试一次，仍失败返回 null（该篇跳过不入库） */
export async function condenseForStorage(body: string): Promise<string | null> {
  if (body.length <= MAX_ARTICLE_CHARS) return body;
  if (!llmEnabled) return body.slice(0, MAX_ARTICLE_CHARS); // 无 LLM 时退化为截断
  const prompt = `把这篇文章压缩到 1500-3000 字（原文越长越取上限）。这是语义压缩，严禁机械截断。要求：
1. 逐条盘点原文的核心论点、因果机制、数字锚点、反例、适用边界——一个都不能丢，压缩只允许发生在行文密度上
2. 每个论点至少保留 2-3 句完整表述（含数据），不允许只留标题式短句
3. 删掉的只能是场景描写、重复铺垫、营销话术、无关展开
4. 用简体中文；只输出压缩后的正文，无任何前言后语`;
  for (let i = 0; i < 2; i++) {
    try {
      const out = await chat(prompt, body.slice(0, 30000), {
        maxTokens: 3000,
        temperature: i === 0 ? 0.2 : 0.35,
        purpose: i === 0 ? "condense" : "condense_retry",
      });
      const clean = out.trim();
      if (clean.length >= 900 && clean.length <= MAX_ARTICLE_CHARS + 400) return clean;
    } catch {
      /* 重试 */
    }
  }
  return null;
}

export async function curateFeed(feed: FeedDef): Promise<SupplyResult> {
  const db = getDb();
  let fetched = 0;
  let added = 0;
  try {
    // 主题订阅：设置了关键词时，只收标题/正文前 600 字命中任一关键词的文章
    const pref = db.prepare(`SELECT value FROM prefs WHERE key = 'topic_keywords'`).get() as
      | { value: string }
      | undefined;
    const keywords: string[] = pref ? JSON.parse(pref.value) : [];

    const rss = await parser.parseURL(feed.url);
    for (const item of rss.items.slice(0, 8)) {
      fetched++;
      const link = item.link ?? "";
      if (!link) continue;
      const dup = db.prepare(`SELECT id FROM articles WHERE url = ?`).get(link);
      if (dup) continue;

      let body = "";
      let title = (item.title ?? "").trim();
      if (feed.mode === "fulltext") {
        body = stripHtml((item as { content?: string }).content ?? item.contentSnippet ?? "");
      } else {
        // 有关键词时先看标题再决定是否抓正文，省抓取
        if (keywords.length > 0 && !keywords.some((k) => title.includes(k))) continue;
        try {
          body = await scrapeArticle(link);
        } catch {
          continue; // 抓取失败跳过，不阻塞其他条目
        }
      }
      // 供给源默认 official（官方/媒体），口述类只走手动投喂
      if (body.length < 500) continue;
      if (!title) title = body.slice(0, 40);
      if (keywords.length > 0 && !keywords.some((k) => title.includes(k) || body.slice(0, 600).includes(k))) {
        continue;
      }

      // 长文先语义压缩再入库（>3000 字触发；失败则跳过该篇）；原文永远保留在 original_body 供对照
      let stored = body;
      let original = "";
      if (body.length > MAX_ARTICLE_CHARS) {
        const condensed = await condenseForStorage(body);
        if (!condensed) continue;
        original = body;
        stored = condensed;
      }

      db.prepare(
        `INSERT INTO articles (title, url, body, original_body, domain, origin, word_count) VALUES (?, ?, ?, ?, ?, 'rss', ?)`
      ).run(title.slice(0, 300), link, stored.slice(0, 30000), original.slice(0, 30000), feed.domain, stored.length);
      added++;
    }
    return { feed: feed.name, fetched, added };
  } catch (e) {
    return { feed: feed.name, fetched, added, error: String(e).slice(0, 80) };
  }
}

export async function curateAll(): Promise<SupplyResult[]> {
  const results: SupplyResult[] = [];
  for (const f of SUPPLY_FEEDS) {
    results.push(await curateFeed(f));
  }
  return results;
}
