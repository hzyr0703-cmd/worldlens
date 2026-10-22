"use client";

/**
 * MobileMenu — 移动端全屏导航（lg 以下使用）。
 *
 * 为什么不是横向导航：7 个中文导航项在 768–1024px 会被 flex 压到每项一字宽，
 * 挤成竖排"单字串"。这里改为汉堡按钮 + 全屏菜单，一屏放得下、没有压缩。
 *
 * 交互：点遮罩/关闭键/Esc 退出，打开时锁 body 滚动；列表项错峰上浮入场。
 */
import { useEffect, useState } from "react";
import Link from "next/link";

export type NavItem = { href: string; label: string };

export default function MobileMenu({ items, cta }: { items: NavItem[]; cta: { href: string; label: string } }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="打开菜单"
        aria-expanded={open}
        className="lg:hidden h-9 w-9 grid place-items-center rounded-full border border-zinc-200 hover:bg-zinc-100 transition-colors magnetic"
      >
        <span className="flex flex-col gap-[3px]">
          <span className="block h-[1.5px] w-4 bg-zinc-700 rounded-full" />
          <span className="block h-[1.5px] w-4 bg-zinc-700 rounded-full" />
          <span className="block h-[1.5px] w-4 bg-zinc-700 rounded-full" />
        </span>
      </button>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-zinc-900/25 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* 面板：右侧滑入 */}
          <div className="menu-panel absolute inset-y-0 right-0 w-[min(86vw,340px)] bg-white/97 backdrop-blur-2xl border-l border-zinc-200 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between h-14 px-5 border-b border-zinc-100 shrink-0">
              <span className="mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">Menu</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="关闭菜单"
                className="h-9 w-9 grid place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
              >
                ×
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              {items.map((l, i) => (
                <Link
                  key={l.href}
                  href={l.href}
                  prefetch
                  onClick={() => setOpen(false)}
                  className="menu-item flex items-baseline gap-3 px-3 py-3.5 rounded-xl hover:bg-zinc-50 transition-colors duration-150"
                  style={{ ["--d" as string]: `${90 + i * 45}ms` }}
                >
                  <span className="mono text-[10.5px] text-zinc-300 tabular-nums w-4">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[17px] font-medium tracking-[-0.01em]">{l.label}</span>
                </Link>
              ))}
            </nav>

            <div className="px-5 py-5 border-t border-zinc-100 shrink-0 flex items-center gap-3">
              <Link href={cta.href} prefetch onClick={() => setOpen(false)} className="cta flex-1 justify-center">
                {cta.label}
              </Link>
              <a
                href="/inbox"
                onClick={() => setOpen(false)}
                className="ghost flex-1 justify-center"
              >
                投喂文章
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}