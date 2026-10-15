import Parser from "rss-parser";

// 深度文章源探测：可达性 + 条目长度（判断是否全文）
const parser = new Parser({ timeout: 20000, headers: { "User-Agent": "Mozilla/5.0 WorldLens/0.2" } });

const HUB = "https://hub.slarker.me";
const FEEDS = [
  { name: "阮一峰周刊", url: "https://www.ruanyifeng.com/blog/atom.xml", via: "直连", domain: "tech" },
  { name: "少数派", url: "https://sspai.com/feed", via: "直连", domain: "tech" },
  { name: "量子位", url: `${HUB}/qbitai`, via: "RSSHub", domain: "ai" },
  { name: "机器之心", url: `${HUB}/jiqizhixin/daily`, via: "RSSHub", domain: "ai" },
  { name: "爱范儿", url: `${HUB}/ifanr/app`, via: "RSSHub", domain: "tech" },
  { name: "Solidot", url: `${HUB}/solidot`, via: "RSSHub", domain: "tech" },
  { name: "虎嗅", url: `${HUB}/huxiu/article`, via: "RSSHub", domain: "finance" },
  { name: "36氪·文章", url: `${HUB}/36kr/newsflashes`, via: "RSSHub", domain: "finance" },
  { name: "arXiv·cs.AI", url: "https://export.arxiv.org/rss/cs.AI", via: "直连", domain: "ai" },
  { name: "远川研究所", url: `${HUB}/chuansongme`, via: "RSSHub", domain: "finance" },
];

const results = [];
await Promise.all(
  FEEDS.map(async (f) => {
    try {
      const feed = await parser.parseURL(f.url);
      const lens = feed.items.slice(0, 10).map((i) => {
        const c = (i.content || i.contentSnippet || "");
        return c.replace(/<[^>]+>/g, "").trim().length;
      });
      const maxLen = Math.max(0, ...lens);
      const over800 = lens.filter((l) => l >= 800).length;
      results.push({ name: f.name, via: f.via, items: feed.items.length, maxLen, over800, ok: "✅" });
    } catch (e) {
      results.push({ name: f.name, via: f.via, items: 0, maxLen: 0, over800: 0, ok: "❌", err: String(e).slice(0, 40) });
    }
  })
);
results.sort((a, b) => b.maxLen - a.maxLen);
console.table(results);
