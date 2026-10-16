"use client";

import { useEffect, useRef } from "react";

/**
 * MotionLayer — 全局动效总线，一次挂载，多处复用。
 *
 * 职责（全部走 CSS 变量 + rAF，不引第三方库）：
 *  1. 指针跟随光斑     .cursor-glow  ← --cx / --cy
 *  2. 卡片聚光         .panel       ← --mx / --my
 *  3. 磁性元素         .magnetic    ← --mx / --my + is-active
 *  4. 滚动进度条       .scroll-progress ← --p
 *  5. 顶栏收紧         .topbar      + .is-scrolled
 *  6. 视差层           .parallax    ← --py
 *
 * 用 rAF + 直接写 CSS 变量，绕开 React 重渲染，滚动时零卡顿。
 */

export default function MotionLayer() {
  const raf = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const scrollY = useRef(0);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };

      // 卡片聚光：只处理当前悬停的 .panel，避免遍历整棵树
      const el = (e.target as HTMLElement | null)?.closest?.(".panel") as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
      }

      // 磁性元素
      const mag = (e.target as HTMLElement | null)?.closest?.(".magnetic") as HTMLElement | null;
      if (mag && !reduced) {
        const r = mag.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        // 距离衰减：越靠边吸力越强，最大 7px
        const k = Math.min(1, Math.hypot(dx, dy) / 260);
        mag.style.setProperty("--mx", String(dx * 0.06 * k));
        mag.style.setProperty("--my", String(dy * 0.09 * k));
        mag.classList.add("is-active");
      }
    };

    const onLeaveWindow = () => {
      document
        .querySelectorAll<HTMLElement>(".magnetic.is-active")
        .forEach((n) => {
          n.classList.remove("is-active");
          n.style.setProperty("--mx", "0");
          n.style.setProperty("--my", "0");
        });
    };

    const onScroll = () => {
      scrollY.current = window.scrollY;
      const topbar = document.querySelector<HTMLElement>(".topbar");
      if (topbar) topbar.classList.toggle("is-scrolled", window.scrollY > 8);
    };

    const loop = () => {
      // 1) 指针光斑：轻微跟随（0.18 是插值系数，越小越"黏"）
      if (fine && !reduced) {
        const glow = document.querySelector<HTMLElement>(".cursor-glow");
        if (glow) {
          const cur = glow.style;
          const cx = parseFloat(cur.getPropertyValue("--cx")) || window.innerWidth / 2;
          const cy = parseFloat(cur.getPropertyValue("--cy")) || window.innerHeight / 3;
          const nx = cx + (pointer.current.x - cx) * 0.18;
          const ny = cy + (pointer.current.y - cy) * 0.18;
          cur.setProperty("--cx", `${nx}px`);
          cur.setProperty("--cy", `${ny}px`);
        }

        // 2) 视差：按元素在视口中的位置给不同系数
        document.querySelectorAll<HTMLElement>(".parallax").forEach((n) => {
          const r = n.getBoundingClientRect();
          if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
          const depth = parseFloat(n.dataset.depth ?? "0.18");
          const center = r.top + r.height / 2 - window.innerHeight / 2;
          n.style.setProperty("--py", (-center * depth).toFixed(2));
        });
      }

      // 3) 滚动进度
      const bar = document.querySelector<HTMLElement>(".scroll-progress > i");
      if (bar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? Math.min(1, Math.max(0, scrollY.current / max)) : 0;
        bar.style.setProperty("--p", p.toFixed(4));
      }

      // 3b) 阅读进度：只跟踪 .read-body 正文，忽略页头和文末按钮。
      // 语义：打开页面正文可见时从 0 开始；正文底端滚出视口底 = 100%，
      // 之后的 CTA/footer 不占进度。短文（底端本就在首屏内）滚一点即满。
      const rb = document.querySelector<HTMLElement>(".read-body");
      const rbar = document.querySelector<HTMLElement>(".reading-progress > i");
      if (rb && rbar) {
        const r = rb.getBoundingClientRect();
        const vh = window.innerHeight;
        const sy = window.scrollY;
        const bodyTop = r.top + sy;
        const start = Math.max(0, bodyTop - vh * 0.9);
        const end = Math.max(start + 1, bodyTop + r.height - vh);
        const p = (sy - start) / (end - start);
        rbar.style.setProperty("--p", Math.min(1, Math.max(0, p)).toFixed(4));
      }

      raf.current = requestAnimationFrame(loop);
    };

    onScroll();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeaveWindow);
    window.addEventListener("scroll", onScroll, { passive: true });
    raf.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeaveWindow);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      <div className="cursor-glow" aria-hidden />
      <div className="scroll-progress" aria-hidden>
        <i />
      </div>
      {/* 阅读页专用的正文进度条：MotionLayer 里由 .read-body 位置驱动 */}
      <div className="reading-progress" aria-hidden>
        <i />
      </div>
    </>
  );
}