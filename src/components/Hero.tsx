/**
 * Hero — 首页首屏。
 *
 * 结构：淡方格底纹 → 居中巨型标题（逐字入场）→ 数字副标（滚动+擦入）
 *      → 真实数据方块矩阵（TileMatrix，客户端轮询实时刷新）→ 分类标签行 → 信源墙
 *
 * 方块矩阵内容是**真实抓取的快讯**，不是装饰色块：
 * 每块显示标题摘要 + 信源名 + T 级，按层级配色（红/橙/蓝/灰）。
 * 滚动方向交错、速度各异，悬停暂停并放大 —— 对应 Mobbin 的卡片墙手感。
 */
import CountUp from "@/components/CountUp";
import SplitText from "@/components/SplitText";
import TileMatrix from "@/components/TileMatrix";
import type { TileData } from "@/lib/tiles";

export default function Hero({
  items,
  articles,
  nuggets,
  due,
  llmCalls,
  sources,
  latestItems,
}: {
  items: number;
  articles: number;
  nuggets: number;
  due: number;
  llmCalls: number;
  sources: string[];
  latestItems: TileData[];
}) {
  return (
    <section className="relative pt-10 sm:pt-16">
      {/* Mobbin 招牌的极淡方格底纹，藏在标题后方 */}
      <div className="grid-veil pointer-events-none absolute inset-x-0 top-0 h-[620px]" aria-hidden />

      {/* 巨型标题 */}
      <div className="relative text-center">
        {/* kicker：小圆点脉冲 + 文字淡入 */}
        <div className="hero-kicker inline-flex items-center gap-2.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#00b8d4] opacity-70 hero-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00b8d4]" />
          </span>
          <span className="mono text-[11px] uppercase tracking-[0.18em] text-[#007a8c]">
            Collect · Read · Interrogate · Retain
          </span>
        </div>

        {/* 逐字遮罩上推 */}
        <h1 className="mt-7 text-[44px] sm:text-[68px] lg:text-[82px] leading-[0.98] font-semibold tracking-[-0.045em]">
          <span className="block overflow-hidden">
            <span className="block hero-line" style={{ ["--d" as string]: "80ms" }}>
              <SplitText text="读过的世界" />
            </span>
          </span>
          <span className="block overflow-hidden">
            <span
              className="block hero-line"
              style={{ ["--d" as string]: "200ms" }}
            >
              <SplitText text="变成你自己的理解" delay={180} />
            </span>
          </span>
        </h1>

        {/* 画龙点睛①：标题下方的青色短线，从中心展开 */}
        <div className="mt-8 flex justify-center">
          <span className="hero-rule" />
        </div>

        {/* 副标：clip-path 从左擦入 */}
        <p
          className="hero-line wipe mt-7 text-[17px] sm:text-[19px] leading-relaxed text-zinc-600 max-w-[60ch] mx-auto"
          style={{ ["--d" as string]: "420ms" }}
        >
          <CountUp value={items} /> 条真实信息采集入库，
          <CountUp value={articles} /> 篇深度长文全文可读。
          <br className="hidden sm:block" />
          AI 不替你理解——它出题、等你作答、指出你漏掉的那一层。
        </p>

        {/* CTA：磁性按钮 + 光泽扫过 */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/inbox"
            className="cta cta-accent hero-line magnetic"
            style={{ ["--d" as string]: "320ms" }}
          >
            挑一篇开始精读 <span className="hero-arrow">→</span>
          </a>
          <a
            href="/review"
            className="ghost hero-line magnetic"
            style={{ ["--d" as string]: "380ms" }}
          >
            {due > 0 ? `${due} 张卡片待复习` : "复习队列"}
          </a>
        </div>

        {/* 数据条 */}
        <div
          className="hero-line mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-5 text-[11.5px] sm:text-[12.5px] text-zinc-400"
          style={{ ["--d" as string]: "440ms" }}
        >
          <span className="mono tabular-nums"><CountUp value={items} /> 信息</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums"><CountUp value={articles} /> 长文</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums"><CountUp value={nuggets} /> 原子</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums">LLM <CountUp value={llmCalls} /> 次/日</span>
        </div>
      </div>

      {/* 真实数据方块矩阵：手机 3 列 / 桌面 6 列，客户端每 60s 轮询实时刷新 */}
      <TileMatrix initialTiles={latestItems} />

      {/* 信源墙 — 对应 Mobbin 的 "Trusted by teams and agents at"，读真实启用源 */}
      <div className="mt-16 sm:mt-20">
        <p className="text-center text-[13px] text-zinc-400">
          {sources.length} 个启用信源 · T0–T3 分级 · 每条信息可溯源
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-10 gap-y-3 sm:gap-y-5">
          {sources.map((s) => (
            <span
              key={s}
              className="text-[14.5px] sm:text-[19px] font-semibold tracking-[-0.02em] text-zinc-300 hover:text-zinc-500 transition-colors duration-300 cursor-default select-none"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}