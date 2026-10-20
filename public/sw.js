/**
 * WorldLens Service Worker — 轻量 PWA 离线支撑。
 *
 * 策略（保守，避免"改版后用户看到旧页面"）：
 * - 导航请求（HTML）：network-first，失败回退缓存的首页（离线也能打开壳）
 * - 静态资源 /_next/static/*：cache-first（带内容 hash，天然版本化，永不过期）
 * - API（/api/*）：永远直连，不缓存——数据必须新鲜
 * - 其它请求：直连，失败就失败（横幅会提示离线）
 */
const CACHE = "wl-cache-v1";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // 数据永远直连

  // 导航：network-first，离线回退首页壳
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error()))
    );
    return;
  }

  // 带内容 hash 的静态资源：cache-first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
  }
});
