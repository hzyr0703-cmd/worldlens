"use client";

/**
 * OfflineBanner — PWA 离线提示 + Service Worker 注册。
 *
 * 离线时顶栏下方出现横幅（同步项目的编辑排版语言）；
 * 恢复网络自动消失。SW 注册失败静默忽略（http 环境/浏览器不支持都无所谓）。
 */
import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // SW 注册（生产环境所有域名一致，无需区分）
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      className="sticky top-14 z-30 flex items-center justify-center gap-2.5 border-b border-[#f0e0c0] bg-[#fdf8ef] px-4 py-2 text-[12.5px] text-[#8a5a08]"
      role="status"
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d9a441] opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#d9a441]" />
      </span>
      当前离线 — 已打开的页面来自缓存，数据可能不是最新的；恢复网络后此提示自动消失。
    </div>
  );
}
