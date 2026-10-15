// 链路探测器：批量测试候选信息源可达性（零依赖，node --no-warnings scripts/probe.mjs）
const HUB = process.env.RSSHUB_BASE ?? "https://hub.slarker.me";

const targets = [
  // —— RSSHub 金融/宏观路由（走镜像）——
  { name: "财新·最新", url: `${HUB}/caixin/latest`, via: "RSSHub" },
  { name: "东方财富·研报", url: `${HUB}/eastmoney/report/stock`, via: "RSSHub" },
  { name: "国务院·最新政策", url: `${HUB}/gov/zhengce/zuixin`, via: "RSSHub" },
  { name: "央行·沟通交流", url: `${HUB}/pbc/goutongjiaoliu`, via: "RSSHub" },
  { name: "证监会·新闻", url: `${HUB}/csrc/news`, via: "RSSHub" },
  { name: "雪球·今日话题", url: `${HUB}/xueqiu/todaytopic`, via: "RSSHub" },
  { name: "雪球·热帖", url: `${HUB}/xueqiu/hots`, via: "RSSHub" },
  { name: "格隆汇·焦点", url: `${HUB}/gelonghui`, via: "RSSHub" },
  { name: "金十数据·快讯", url: `${HUB}/jin10`, via: "RSSHub" },
  { name: "上交所·公告", url: `${HUB}/sse/disclosure`, via: "RSSHub" },
  // —— 直连源（不依赖 RSSHub）——
  { name: "HackerNews·Front", url: "https://hnrss.org/frontpage", via: "直连" },
  { name: "arXiv·q-fin", url: "https://export.arxiv.org/rss/q-fin.ST", via: "直连" },
  { name: "YahooFinance", url: "https://finance.yahoo.com/news/rssindex", via: "直连" },
  { name: "WSJ·Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", via: "直连" },
  { name: "知乎·每日精选", url: "https://www.zhihu.com/rss", via: "直连" },
  { name: "GithubTrending", url: "https://github.com/trending.atom", via: "直连" },
];

const results = [];
await Promise.all(
  targets.map(async (t) => {
    const t0 = Date.now();
    try {
      const res = await fetch(t.url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 WorldLens/0.1" },
      });
      const ms = Date.now() - t0;
      const text = await res.text();
      const isRSS = /<rss[\s>]|<feed[\s>]/i.test(text.slice(0, 2000));
      const items = (text.match(/<item[\s>]/g) ?? []).length || (text.match(/<entry[\s>]/g) ?? []).length;
      let kind = isRSS ? "RSS" : "非RSS";
      if (!isRSS && text.trimStart().startsWith("{")) kind = "JSON";
      results.push({
        name: t.name, via: t.via, status: res.status, kind,
        items, ms,
        ok: res.ok && items > 0 ? "✅" : "⚠️",
      });
    } catch (e) {
      results.push({
        name: t.name, via: t.via, status: "ERR", kind: "-", items: 0,
        ms: Date.now() - t0,
        ok: "❌", err: e instanceof Error ? e.message.slice(0, 40) : String(e).slice(0, 40),
      });
    }
  })
);

results.sort((a, b) => (a.via === b.via ? b.items - a.items : a.via.localeCompare(b.via)));
console.table(results.map((r) => ({ ...r, err: r.err ?? "" })));
