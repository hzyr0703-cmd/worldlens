// ---------------------------------------------------------------------------
// 默认信源种子 — T0-T3 信源分级体系
// T0 官方一手（公告/央行/统计局） | T1 通讯社/权威财经 | T2 行业媒体 | T3 自媒体观点
// RSSHub 公共实例默认走 hub.slarker.me（rsshub.app 国内不可达），可配置覆盖。
// ---------------------------------------------------------------------------

/** RSSHub 公共镜像池：主镜像失败自动轮换下一台（rsshub.app 国内不可达，仅作末位） */
export const RSSHUB_MIRRORS = [
  process.env.RSSHUB_BASE ?? "",
  "https://hub.slarker.me",
  "https://rsshub.rssforever.com",
  "https://rsshub.app",
].filter(Boolean);

export const RSSHUB_BASE = RSSHUB_MIRRORS[0];

export type SeedSource = {
  name: string;
  url: string;
  tier: 0 | 1 | 2 | 3;
  category: "macro" | "company" | "overseas" | "opinion";
};

export const SEED_SOURCES: SeedSource[] = [
  // T1 权威财经快讯（中文主源）
  { name: "财联社·电报", url: `${RSSHUB_BASE}/cls/telegraph`, tier: 1, category: "macro" },
  { name: "华尔街见闻·直播", url: `${RSSHUB_BASE}/wallstreetcn/live`, tier: 1, category: "macro" },
  { name: "金十数据·快讯", url: `${RSSHUB_BASE}/jin10`, tier: 1, category: "macro" },
  { name: "财新·最新", url: `${RSSHUB_BASE}/caixin/latest`, tier: 1, category: "macro" },
  { name: "第一财经", url: `${RSSHUB_BASE}/yicai/news`, tier: 1, category: "macro" },
  // T2 行业/深度
  { name: "36氪", url: `${RSSHUB_BASE}/36kr/newsflashes`, tier: 2, category: "company" },
  { name: "量子位", url: "https://www.qbitai.com/feed", tier: 2, category: "company" },
  { name: "少数派", url: "https://sspai.com/feed", tier: 2, category: "company" },
  // T3 观点侧
  { name: "雪球·今日话题", url: `${RSSHUB_BASE}/xueqiu/todaytopic`, tier: 3, category: "opinion" },
  { name: "阮一峰·科技爱好者周刊", url: "https://www.ruanyifeng.com/blog/atom.xml", tier: 3, category: "opinion" },
  // 海外 T1（直连）
  { name: "WSJ·Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", tier: 1, category: "overseas" },
  { name: "CNBC·Business", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", tier: 1, category: "overseas" },
  { name: "arXiv·q-fin", url: "https://export.arxiv.org/rss/q-fin.ST", tier: 1, category: "overseas" },
  // 海外 T2 科技/AI（直连）
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", tier: 2, category: "overseas" },
  { name: "TechCrunch·AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", tier: 2, category: "overseas" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", tier: 2, category: "overseas" },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/", tier: 2, category: "overseas" },
  // 海外 T3 AI 观点
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", tier: 3, category: "opinion" },
  // —— 以下源实测不可达，保留配置待镜像恢复后启用 ——

  // { name: "Reuters·Biz", url: "https://feeds.reuters.com/reuters/business", tier: 1, category: "overseas" },  // 超时
  // { name: "东方财富·研报", url: `${RSSHUB_BASE}/eastmoney/report/stock`, tier: 2, category: "company" },      // 镜像上游超时
  // { name: "国务院·最新政策", url: `${RSSHUB_BASE}/gov/zhengce/zuixin`, tier: 0, category: "macro" },          // 镜像上游超时
  // { name: "界面新闻·财经", url: `${RSSHUB_BASE}/jiemian/list/4`, tier: 2, category: "company" },              // 404
  // { name: "澎湃·财经", url: `${RSSHUB_BASE}/thepaper/channel/25`, tier: 2, category: "company" },             // 超时
  // { name: "新浪财经·滚动", url: `${RSSHUB_BASE}/sina/rollnews/roll_finance`, tier: 1, category: "macro" },    // 超时
  // { name: "机器之心", url: `${RSSHUB_BASE}/jiqizhixin/daily`, tier: 2, category: "company" },                 // 404；直连 200 但 items:0
  // { name: "VentureBeat·AI", url: "https://venturebeat.com/category/ai/feed/", tier: 2, category: "overseas" }, // 429 反爬
];

/** 首次建库即禁用的源（实测 404/超时/反爬，恢复后手动 UPDATE enabled=1） */
export const DISABLED_SOURCE_URLS = [
  `${RSSHUB_BASE}/xueqiu/todaytopic`, // 404 镜像无此路由
  `${RSSHUB_BASE}/xueqiu/hots`,       // 503
  `${RSSHUB_BASE}/pbc/goutongjiaoliu`, // 404
  `${RSSHUB_BASE}/csrc/news`,          // 404
  `${RSSHUB_BASE}/gelonghui`,          // 404
];

// 用户关注域实体种子（可被 LLM 抽取结果自动扩充）
export const SEED_ENTITIES: { name: string; type: string; aliases: string[] }[] = [
  { name: "美联储", type: "macro", aliases: ["Fed", "FOMC", "联邦储备"] },
  { name: "中国人民银行", type: "macro", aliases: ["央行", "央行", "MLF", "LPR", "逆回购"] },
  { name: "国家统计局", type: "macro", aliases: ["CPI", "PPI", "PMI", "GDP", "社融"] },
  { name: "中际旭创", type: "company", aliases: ["300308"] },
  { name: "新易盛", type: "company", aliases: ["300502"] },
  { name: "天孚通信", type: "company", aliases: ["300394"] },
  { name: "CPO", type: "concept", aliases: ["光模块", "共封装光学", "光电共封装", "800G", "1.6T"] },
  { name: "PCB", type: "concept", aliases: ["印制电路板", "覆铜板"] },
  { name: "半导体", type: "concept", aliases: ["芯片", "晶圆", "先进制程", "存储"] },
  { name: "纳指100", type: "concept", aliases: ["纳斯达克", "NDX", "纳指"] },
  { name: "AI算力", type: "concept", aliases: ["算力", "GPU", "英伟达", "NVIDIA", "AI芯片"] },
  // 英文实体（WSJ/arXiv 等海外源）
  { name: "美联储", type: "macro", aliases: ["Federal Reserve", "interest rate", "rate cut", "rate hike", "FOMC"] },
  { name: "英伟达", type: "company", aliases: ["NVIDIA", "NVDA"] },
  { name: "苹果", type: "company", aliases: ["Apple", "AAPL"] },
  { name: "微软", type: "company", aliases: ["Microsoft", "MSFT"] },
  { name: "特斯拉", type: "company", aliases: ["Tesla", "TSLA"] },
  { name: "纳斯达克", type: "macro", aliases: ["Nasdaq", "S&P 500", "Dow Jones", "Wall Street"] },
];
