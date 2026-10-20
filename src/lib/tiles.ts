/**
 * Hero 方块矩阵的实时数据层。
 * 首页 SSR（page.tsx）与 /api/live-tiles（客户端轮询）共用同一个取数函数，
 * 保证两边看到的内容一致。
 *
 * 规则：中文快讯为主；英文条目固定只留 3–4 条（用户要求，英文只是点缀）。
 */
import { getDb } from "@/lib/db";

export type TileData = {
  id: number;
  title: string;
  tier: number;
  source: string;
  link: string;
  date: string; // 信息日期 YYYY-MM-DD（发布时间缺失时回退抓取时间）
};

const CJK = /[\u4e00-\u9fff]/;

export function getLiveTiles(limit = 42, maxEnglish = 4, offset = 0): TileData[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.tier, i.link, s.name AS source,
              date(COALESCE(i.published_at, i.fetched_at)) AS date
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE length(i.title) > 4
       ORDER BY i.id DESC LIMIT ? OFFSET ?`
    )
    .all(limit + offset, offset) as unknown as TileData[];

  // node:sqlite 返回的行是 null-prototype 对象，直接传给 Client Components
  // 会被 React 序列化校验拒绝（"Classes or null prototypes are not supported"），
  // 必须显式重建为普通对象。
  const tiles: TileData[] = rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    tier: Number(r.tier),
    source: String(r.source),
    link: String(r.link),
    date: r.date ? String(r.date) : "",
  }));

  const zh = tiles.filter((r) => CJK.test(r.title));
  const en = tiles.filter((r) => !CJK.test(r.title));

  // 中文优先占满，英文最多 maxEnglish 条；中文不够也不让英文补超
  const enTake = Math.min(maxEnglish, limit - Math.min(zh.length, limit - maxEnglish));
  return [...zh.slice(0, limit - enTake), ...en.slice(0, enTake)];
}
