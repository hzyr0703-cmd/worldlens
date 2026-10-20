"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * LiveRefresh — 页面数据自更新。
 * 轮询 /api/live 的版本号（items/claims/nuggets/digest/due），任一变化就刷新服务端组件。
 * 顶部出现一条极细的进度提示，让"它在活着"可见。
 */
export default function LiveRefresh() {
  const router = useRouter();
  const version = useRef<string>("");
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          const key = `${d.items}:${d.claims}:${d.nuggets}:${d.digest_at}:${d.due}`;
          if (version.current && key !== version.current) {
            setPulse(true);
            router.refresh();
            setTimeout(() => setPulse(false), 1400);
          }
          version.current = key;
        }
      } catch {
        /* 离线/网络抖动：下次再试 */
      }
      if (alive) timer = setTimeout(check, 45_000);
    };

    // 首轮延迟 8s 建立基线，之后每 45s
    timer = setTimeout(check, 8_000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <span
      aria-hidden
      className={`fixed top-0 left-0 right-0 h-[2px] z-50 pointer-events-none transition-opacity duration-500 ${
        pulse ? "opacity-100" : "opacity-0"
      }`}
      style={{
        background: "linear-gradient(90deg, transparent, #00b8d4, transparent)",
        backgroundSize: "200% 100%",
        animation: pulse ? "live-sweep 1.2s ease-in-out" : undefined,
      }}
    />
  );
}
