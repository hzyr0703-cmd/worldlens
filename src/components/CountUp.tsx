"use client";

import { useEffect, useRef, useState } from "react";

/**
 * CountUp — 数字从 0 递增到目标值。
 * 用 rAF + easeOutExpo，进入视口才启动，只播一次。
 * 数字本身交给 .count 类做 tabular-nums，避免跳动时宽度抖动。
 */
export default function CountUp({
  value,
  duration = 1100,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 尊重"减少动效"：仍然走同一条 IO 回调路径，只是直接落到终值、不做递增动画。
    // 这样 setState 只出现在异步回调里（effect 体内同步 setState 会触发级联渲染）。
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || done.current) return;
        done.current = true;
        io.disconnect();

        if (reduced) {
          setDisplay(value);
          return;
        }

        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / duration);
          // easeOutExpo：起步快、收尾稳，数字读起来像"落定"
          const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
          setDisplay(Math.round(value * eased));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.3 }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  return (
    <span ref={ref} className={`count ${className}`}>
      {display.toLocaleString()}
    </span>
  );
}