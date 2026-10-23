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
    // 预取 / RSC 数据请求不计——next/link 的 prefetch 会被误记成大量 PV
    const mode = h.get("sec-fetch-mode");
    if (mode && mode !== "navigate") return;
    const fwd = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ip = fwd || h.get("x-real-ip") || "unknown";
    // next-url 是 Next 内部头（值为页面路径）；拿不到就记根路径
    const path = (h.get("next-url") || h.get("x-invoke-path") || "/").split("?")[0] || "/";
    const ua = (h.get("user-agent") ?? "").slice(0, 120);
    getDb().prepare(`INSERT INTO visits (ip, path, ua) VALUES (?, ?, ?)`).run(ip, path, ua);
  } catch {
    /* 统计失败绝不阻塞页面渲染 */
  }
}

export type VisitStats = {
  uniqueTotal: number;
  uniqueToday: number;
  pvTotal: number;
  pvToday: number;
  days: { day: string; ips: number; pv: number }[];
  topPaths: { path: string; pv: number; ips: number }[];
  recent: { ip: string; path: string; ts: string }[];
};

export function visitStats(): VisitStats {
  const db = getDb();
  const q = <T,>(sql: string, ...args: (string | number)[]) =>
    db.prepare(sql).all(...args) as unknown as T[];

  const [tot] = q<{ u: number; pv: number }>(
    `SELECT COUNT(DISTINCT ip) u, COUNT(*) pv FROM visits`
  );
  // ts 存的是 UTC；"今天"按北京时间对齐（date(ts, '+8 hours')）
  const days = q<{ day: string; ips: number; pv: number }>(
    `SELECT date(ts, '+8 hours') day, COUNT(DISTINCT ip) ips, COUNT(*) pv
     FROM visits GROUP BY day ORDER BY day DESC LIMIT 7`
  );
  const topPaths = q<{ path: string; pv: number; ips: number }>(
    `SELECT path, COUNT(*) pv, COUNT(DISTINCT ip) ips
     FROM visits GROUP BY path ORDER BY pv DESC LIMIT 6`
  );
  const recent = q<{ ip: string; path: string; ts: string }>(
    `SELECT ip, path, ts FROM visits ORDER BY id DESC LIMIT 12`
  );
  const todayKey = days[0]?.day ?? "";
  return {
    uniqueTotal: tot?.u ?? 0,
    pvTotal: tot?.pv ?? 0,
    // 今日 = 北京时间今天（days 按天倒序，第一行就是它）
    uniqueToday: days.find((d) => d.day === todayKey)?.ips ?? 0,
    pvToday: days.find((d) => d.day === todayKey)?.pv ?? 0,
    days,
    topPaths,
    recent,
  };
}
