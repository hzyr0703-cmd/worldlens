import { getDb, contentHash } from "@/lib/db";

// ---------------------------------------------------------------------------
// 巨潮资讯公告采集 —— 财联社们不报道的富矿：
//   处罚（立案/警示函/罚款）· 中标（招投标/重大合同）· 人事（辞职/聘任/换届）
// RSSHub 没有这些政务路由，但上市公司必须发的公告里全都有。
// 公开接口，无需登录；公告为 PDF，这里只存标题与链接（可溯源）。
// ---------------------------------------------------------------------------

const API = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
const PDF_BASE = "http://static.cninfo.com.cn/";

/** 监控类目 → 搜索关键词（巨潮全文搜索） */
export const WATCH_KINDS: Record<string, { cn: string; keys: string[] }> = {
  penalty: { cn: "监管处罚", keys: ["处罚", "立案", "警示函", "罚款"] },
  bid: { cn: "招投标", keys: ["中标", "重大合同"] },
  personnel: { cn: "人事变动", keys: ["辞职", "聘任"] },
  judicial: { cn: "司法风险", keys: ["诉讼", "仲裁", "被执行", "股权冻结"] },
  risk: { cn: "风险提示", keys: ["资金占用", "退市风险", "违规担保"] },
  deals: { cn: "关联交易", keys: ["关联交易", "对外担保"] },
};

type Announcement = {
  secCode: string;
  secName: string;
  announcementTitle: string;
  announcementTime: number;
  adjunctUrl: string;
};

async function fetchByKey(searchkey: string, pageSize = 15): Promise<Announcement[]> {
  const body = new URLSearchParams({
    pageNum: "1",
    pageSize: String(pageSize),
    column: "szse",
    tabName: "fulltext",
    plate: "",
    stock: "",
    searchkey,
    secid: "",
    category: "",
    trade: "",
    seDate: "",
    sortName: "",
    sortType: "",
    isHLtitle: "true",
  });
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0",
      Referer: "http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice",
    },
    body,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { announcements?: Announcement[] };
  return data.announcements ?? [];
}

/** 采集三类公告，写入 items（source=巨潮·公告）。返回各类新增数。 */
export async function ingestCninfo(): Promise<Record<string, number>> {
  const db = getDb();
  const src = db.prepare(`SELECT id, tier FROM sources WHERE name = ?`).get("巨潮·公告") as
    | { id: number; tier: number }
    | undefined;
  if (!src) return {};

  // items.guid 是 NOT NULL UNIQUE（RSS guid 或 link 哈希）——公告用 link 作 guid
  const ins = db.prepare(
    `INSERT OR IGNORE INTO items (source_id, guid, title, link, content, published_at, tier, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const result: Record<string, number> = {};
  for (const [kind, cfg] of Object.entries(WATCH_KINDS)) {
    let added = 0;
    for (const key of cfg.keys) {
      try {
        const rows = await fetchByKey(key, 12);
        for (const a of rows) {
          const title = `${a.secName}(${a.secCode})：${a.announcementTitle}`;
          if (!a.adjunctUrl || title.length < 8) continue;
          const link = PDF_BASE + a.adjunctUrl;
          const published = new Date(a.announcementTime).toISOString().slice(0, 19).replace("T", " ");
          const r = ins.run(
            src.id,
            link,
            title.slice(0, 200),
            link,
            `[${cfg.cn}] ${key}`,
            published,
            src.tier,
            contentHash(title + link)
          );
          if (r.changes > 0) added++;
        }
      } catch (e) {
        console.error(`[cninfo] key="${key}" failed:`, e instanceof Error ? e.message : String(e));
      }
    }
    result[kind] = added;
  }
  return result;
}
