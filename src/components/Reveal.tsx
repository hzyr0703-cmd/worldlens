"use client";

import { useEffect, useRef } from "react";

/**
 * 区块进入视口时给子元素加 .in，触发 CSS transition 错峰入场。
 * 纯 CSS 过渡 + 一次性 IntersectionObserver，无依赖。
 */
export default function Reveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 已经滚过屏的（首屏下方很近）直接显示，避免闪烁
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("in");
            io.unobserve(el);
          }
        }
      },
      { threshold: 0.06, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal-scope ${className}`}>
      {children}
    </div>
  );
}
