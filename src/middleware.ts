import { NextRequest, NextResponse } from "next/server";

/**
 * 给每个浏览器发一个匿名访客 ID（wl_vid，一年有效）。
 * 访问统计用它按"设备"去重——同一台设备换网络（Wi-Fi ↔ 流量）不再被算成两个访客，
 * 比纯 IP 口径更接近真实人数。ID 是随机 UUID，不含任何身份信息。
 *
 * middleware 跑在 edge runtime（用不了 node:sqlite），所以这里只负责发 ID / 注入请求头，
 * 写库仍在 RootLayout 的 recordVisit() 里做。
 */
export function middleware(req: NextRequest) {
  const mode = req.headers.get("sec-fetch-mode");
  const isNavigate = !mode || mode === "navigate";
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
