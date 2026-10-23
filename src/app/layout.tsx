import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import MotionLayer from "@/components/MotionLayer";
import LiveRefresh from "@/components/LiveRefresh";
import MobileMenu from "@/components/MobileMenu";
import OfflineBanner from "@/components/OfflineBanner";
import { recordVisit } from "@/lib/visits";

export const metadata: Metadata = {
  title: "WorldLens · 认知复利引擎",
  description: "拷问式精读 × 认知原子 × FSRS 复习 — 增强你对世界的理解",
  manifest: "/manifest.json",
};

/** 导航按使用节奏分三组：今日消费 / 深度加工 / 回查。
 *  路由不变——只是把三种动线在视觉上分开，降低"该点哪"的认知负担。 */
const NAV_GROUPS = [
  {
    group: "今日",
    items: [
      { href: "/", label: "首页" },
      { href: "/watch", label: "监控" },
      { href: "/search", label: "搜索" },
    ],
  },
  {
    group: "知识",
    items: [
      { href: "/chains", label: "链条" },
      { href: "/library", label: "认知库" },
      { href: "/graph", label: "图谱" },
    ],
  },
  {
    group: "我",
    items: [
      { href: "/review", label: "对账" },
      { href: "/log", label: "日志" },
      { href: "/status", label: "运转" },
    ],
  },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 访问统计：导航请求（sec-fetch-mode: navigate）记一条 IP/路径，失败不阻塞渲染
  await recordVisit();

  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <MotionLayer />
        <LiveRefresh />

        <header className="topbar sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-zinc-200">
          <div className="max-w-[1240px] mx-auto px-6 h-14 flex items-center justify-between gap-6">
            <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
              <span className="w-6 h-6 rounded-[7px] bg-zinc-900 grid place-items-center transition-transform duration-200 group-hover:scale-105">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-[#00b8d4]" />
              </span>
              <span className="text-[15px] font-semibold tracking-[-0.01em]">WorldLens</span>
            </Link>

            {/* 横向导航只在 lg 以上出现——768~1024px 会被 flex 压成竖排单字 */}
            <nav className="hidden lg:flex items-center gap-1 text-[13.5px]">
              {NAV_GROUPS.map((g, gi) => (
                <span key={g.group} className="flex items-center gap-1">
                  {gi > 0 && <span className="w-px h-4 bg-zinc-200 mx-1.5" aria-hidden />}
                  {g.items.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      prefetch
                      className="nav-link px-3 py-1.5 rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors duration-150"
                    >
                      {l.label}
                    </Link>
                  ))}
                </span>
              ))}
            </nav>

            <div className="flex items-center gap-2 shrink-0">
              {/* 移动端腾出空间：投喂文章收进菜单，CTA 缩小 */}
              <Link href="/inbox" prefetch className="ghost hidden lg:inline-flex magnetic">
                投喂文章
              </Link>
              <Link href="/review" prefetch className="cta magnetic !px-3.5 !py-2 sm:!px-4 sm:!py-2.5 !text-[12.5px] sm:!text-[13px]">
                去对账
              </Link>
            </div>
          </div>
        </header>

        {/* PWA 离线横幅 + SW 注册（sticky 挂在顶栏正下方） */}
        <OfflineBanner />

        {/*汉堡按钮 + 全屏菜单。必须渲染在 header 之外：
            header 的 backdrop-blur-xl 会成为 fixed 后代的定位参照，
            放在 header 内会让 fixed inset-0 退化成 56px 高。 */}
        <MobileMenu items={NAV} cta={{ href: "/review", label: "开始复习" }} />

        <main className="flex-1 w-full max-w-[1240px] mx-auto px-6 py-12 sm:py-16 page-enter">
          {children}
        </main>

        <footer className="border-t border-zinc-200 mt-16">
          <div className="max-w-[1240px] mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12.5px] text-zinc-400">
            <span>WorldLens — 收集 · 建链 · 验证</span>
            <span className="mono text-[11px] tracking-wide">COLLECT · TRACE · VERIFY</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
