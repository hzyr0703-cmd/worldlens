import { NextRequest, NextResponse } from "next/server";

/**
 * API 简易限流——公开站点的 /api/* 会被爬虫盯上，120 次/分钟/IP 封顶，
 * 正常使用（页面渲染 + LiveRefresh 轮询）远低于此。
 * middleware 跑在 edge runtime，模块级 Map 在单实例部署下即全站限流器；
 * 多 worker 实例下阈值按 worker 数放大（防暴力爬取够用，非硬墙）。
 */

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
  return NextResponse.next();
}

export const config = {
  // 静态资源不用限流
  matcher: ["/((?!_next/static|_next/image|favicon|manifest|sw.js).*)"],
};
