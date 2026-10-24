import "server-only";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";

// ---------------------------------------------------------------------------
// 访问统计：只记 IP / 路径 / UA，不含任何身份信息。
// 在 RootLayout 里调用 recordVisit()——headers() 是动态 API，会让所有页面
// 按动态渲染（本项目页面本来就全是 force-dynamic，无额外代价）。
// 公开页（/status）展示的 IP 一律掩码，完整 IP 只存库不外显。
// ---------------------------------------------------------------------------

/** IPv4 → 1.2.3.x；IPv6 → 前 3 组 + …；其余截断 */
export function maskIp(ip: string): string {
  if (!ip || ip === "unknown") return "未知";
  // ::ffff:1.2.3.4 是 IPv4 的 IPv6 映射写法，剥掉再按 IPv4 掩码
  const v4 = ip.replace(/^::ffff:/i, "");
  if (!v4.includes(":")) {
    const p = v4.split(".");
    if (p.length === 4) return `${p[0]}.${p[1]}.${p[2]}.x`;
  }
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + ":…";
  return ip.slice(0, 10) + "…";
}

export async function recordVisit(): Promise<void> {
  try {
    const h = await headers();
    // 只记真实浏览器导航：
    // - sec-fetch-mode: navigate 是浏览器发页面请求时的固定标记；探针/curl/RSC 预取都不带或不是它。
    //   漏掉这个判断会让平台存活探针（每几十秒 GET / 一次、不带 cookie）被当成"新设备"，
    //   一夜能刷出几千个假访客。
    // - 真实浏览器 UA 一律以 Mozilla 开头（Chrome/Safari/Firefox/Edge/移动端皆是），
    //   探针（Go-http-client/空/okhttp 等）不是——双保险。
    const mode = h.get("sec-fetch-mode");
    if (mode !== "navigate") return;
    const ua = (h.get("user-agent") ?? "").slice(0, 120);
    if (!ua.startsWith("Mozilla")) return;
    const fwd = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ip = fwd || h.get("x-real-ip") || "unknown";
    // 路径由 middleware 注入（x-wl-path）；旧回退仅兜底
    const path = h.get("x-wl-path") || (h.get("next-url") || h.get("x-invoke-path") || "/").split("?")[0] || "/";
    // 匿名访客 ID：middleware 对没有 wl_vid cookie 的导航请求下发并注入此头
    const vid = h.get("x-wl-vid") ?? "";
    getDb().prepare(`INSERT INTO visits (ip, path, ua, vid) VALUES (?, ?, ?, ?)`).run(ip, path, ua, vid);
  } catch {
    /* 统计失败绝不阻塞页面渲染 */
  }
}

export type VisitStats = {
  /** 累计独立访客（按匿名设备 ID 去重——主口径） */
  uniqueTotal: number;
  /** 累计独立 IP（对照口径） */
  uniqueIpTotal: number;
  uniqueToday: number;
  uniqueIpToday: number;
  pvTotal: number;
  pvToday: number;
  days: { day: string; ips: number; ipv: number; pv: number }[];
  topPaths: { path: string; pv: number; ips: number }[];
  recent: { ip: string; path: string; ts: string }[];
};

export function visitStats(): VisitStats {
  const db = getDb();
  const q = <T,>(sql: string, ...args: (string | number)[]) =>
    db.prepare(sql).all(...args) as unknown as T[];

  // 访客主口径 = 匿名设备 ID（vid）；IP 口径保留作对照。vid 为空的历史行不计入。
  const [tot] = q<{ u: number; ipu: number; pv: number }>(
    `SELECT COUNT(DISTINCT CASE WHEN vid != '' THEN vid END) u,
            COUNT(DISTINCT ip) ipu, COUNT(*) pv FROM visits`
  );
  const days = q<{ day: string; ips: number; ipv: number; pv: number }>(
    `SELECT date(ts, '+8 hours') day,
            COUNT(DISTINCT ip) ips,
            COUNT(DISTINCT CASE WHEN vid != '' THEN vid END) ipv,
            COUNT(*) pv
     FROM visits GROUP BY day ORDER BY day DESC LIMIT 7`
  );
  const topPaths = q<{ path: string; pv: number; ips: number }>(
    `SELECT path, COUNT(*) pv, COUNT(DISTINCT ip) ips
     FROM visits GROUP BY path ORDER BY pv DESC LIMIT 6`
  );
  const recent = q<{ ip: string; path: string; ts: string }>(
    `SELECT ip, path, ts FROM visits ORDER BY id DESC LIMIT 12`
  );
  // "今天"必须按北京时间算——days[0] 是"最近一个有访问的日子"，
  // 一整天没人来时它会指向前天，访客数看起来凭空多出一天
  const todayKey = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  return {
    uniqueTotal: tot?.u ?? 0,
    uniqueIpTotal: tot?.ipu ?? 0,
    pvTotal: tot?.pv ?? 0,
    uniqueToday: days.find((d) => d.day === todayKey)?.ipv ?? 0,
    uniqueIpToday: days.find((d) => d.day === todayKey)?.ips ?? 0,
    pvToday: days.find((d) => d.day === todayKey)?.pv ?? 0,
    days,
    topPaths,
    recent,
  };
}
