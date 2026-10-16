"use client";

import { useEffect, useRef } from "react";

/**
 * Reveal — 区块进入视口时给自身加 .in，触发 CSS transition 错峰入场。
 * 纯 CSS 过渡 + 一次性 IntersectionObserver，无依赖。
 *
 * variant：
 *   block  （默认）整块淡入上浮
 *   stagger 直接子项（网格卡片）逐个浮起，最多 8 级
 *   rows   直接子项（列表行）逐行滑入，最多 14 级
 */
export default function Reveal({
  children,
  className = "",
  variant = "block",
  threshold = 0.06,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: "block" | "stagger" | "rows";
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("in");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("in");
            io.unobserve(el);
          }
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  // rows 变体需要把 .in 同时挂到每一行上，容器和行都要
  useEffect(() => {
    if (variant !== "rows") return;
    const el = ref.current;
    if (!el) return;

    const apply = () => el.querySelectorAll(".row-in").forEach((n) => n.classList.add("in"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            apply();
            io.disconnect();
          }
        }
      },
      { threshold: 0.02, rootMargin: "0px 0px -4% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [variant]);

  const variantClass =
    variant === "stagger" ? "stagger-grid" : variant === "rows" ? "rows-in" : "";

  return (
    <div ref={ref} className={`reveal-scope ${variantClass} ${className}`}>
      {children}
    </div>
  );
}