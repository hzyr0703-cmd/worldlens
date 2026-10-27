import { NextRequest, NextResponse } from "next/server";

/**
 * 1. 给每个浏览器发一个匿名访客 ID（wl_vid，一年有效）——访问统计按"设备"去重。
 * 2. API 简易限流——公开站点的 /api/* 会被爬虫盯上，120 次/分钟封顶，
 *    正常使用（页面渲染 + LiveRefresh 轮询）远低于此。
 *
 * middleware 跑在 edge runtime（用不了 node:sqlite），统计写库仍在 RootLayout 做。
 */

// edge runtime 模块级 Map：单实例部署下即全站限流器
const hits = new Map<string, { n: number; reset: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  h.n++;
  // Map 防膨胀：超过 1 万个 IP 时清掉过期的（粗粒度，够用）
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }
  return h.n > 120;
}

export function middleware(req: NextRequest) {
  const fwd = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ip = fwd || req.headers.get("x-real-ip") || "unknown";

  // API 限流先于一切：防数据爬取与接口滥用
  if (req.nextUrl.pathname.startsWith("/api/") && rateLimited(ip)) {
    return new NextResponse(JSON.stringify({ ok: false, error: "too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  // 只对真实浏览器导航发 ID（探针/curl 不带 sec-fetch-mode，不发，省得刷假设备）
  const isNavigate = req.headers.get("sec-fetch-mode") === "navigate";
  const existing = req.cookies.get("wl_vid")?.value;

  const vid = existing ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-wl-vid", vid);
  // recordVisit 依赖这里注入真实路径：next-url 头经 middleware 转发后不可靠
  requestHeaders.set("x-wl-path", req.nextUrl.pathname);

  if (existing) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.cookies.set("wl_vid", vid, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  return res;
}

export const config = {
  // 静态资源不用发 ID；API 请求发也无妨但没必要
  matcher: ["/((?!_next/static|_next/image|favicon|manifest|sw.js).*)"],
};
