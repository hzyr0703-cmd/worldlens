import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import MotionLayer from "@/components/MotionLayer";

export const metadata: Metadata = {
  title: "WorldLens · 认知复利引擎",
  description: "拷问式精读 × 认知原子 × FSRS 复习 — 增强你对世界的理解",
  manifest: "/manifest.json",
};

const NAV = [
  { href: "/", label: "首页" },
  { href: "/inbox", label: "文章池" },
  { href: "/review", label: "复习" },
  { href: "/library", label: "认知库" },
  { href: "/graph", label: "图谱" },
  { href: "/feed", label: "快讯" },
  { href: "/log", label: "日志" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <MotionLayer />

        <header className="topbar sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-zinc-200">
          <div className="max-w-[1240px] mx-auto px-6 h-14 flex items-center justify-between gap-6">
            <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
              <span className="w-6 h-6 rounded-[7px] bg-zinc-900 grid place-items-center transition-transform duration-200 group-hover:scale-105">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-[#00b8d4]" />
              </span>
              <span className="text-[15px] font-semibold tracking-[-0.01em]">WorldLens</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1 text-[13.5px]">
              {NAV.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="nav-link px-3 py-1.5 rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors duration-150"
                >
                  {l.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2 shrink-0">
              <a href="/inbox" className="ghost hidden sm:inline-flex magnetic">
                投喂文章
              </a>
              <a href="/review" className="cta magnetic">
                开始复习
              </a>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1240px] mx-auto px-6 py-12 sm:py-16 page-enter">
          {children}
        </main>

        <footer className="border-t border-zinc-200 mt-16">
          <div className="max-w-[1240px] mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12.5px] text-zinc-400">
            <span>WorldLens — 收集 · 精读 · 拷问 · 留存</span>
            <span className="mono text-[11px] tracking-wide">COLLECT · READ · INTERROGATE · RETAIN</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
