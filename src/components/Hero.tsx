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

/** 行内指标：数字用 tabular-nums，单位弱化 */
function Metric({ value, label }: { value: number; label: string }) {
  return (
    <span className="font-semibold text-zinc-800">
      <span className="tabular-nums">{value}</span> {label}
    </span>
  );
}

export default function Hero({
  items,
  articles,
  nuggets,
  due,
  llmCalls,
  sources,
  latestItems,
  chains,
  steps,
  verifyDue,
}: {
  items: number;
  articles: number;
  nuggets: number;
  due: number;
  llmCalls: number;
  sources: string[];
  latestItems: TileData[];
  chains: number;
  steps: number;
  verifyDue: number;
}) {
  return (
    <section className="relative pt-6 sm:pt-10">
      {/* Mobbin 招牌的极淡方格底纹，藏在标题后方 */}
      <div className="grid-veil pointer-events-none absolute inset-x-0 top-0 h-[420px]" aria-hidden />

      {/* 巨型标题 */}
      <div className="relative text-center">
        {/* kicker：小圆点脉冲 + 文字淡入 */}
        <div className="hero-kicker inline-flex items-center gap-2.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#00b8d4] opacity-70 hero-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00b8d4]" />
          </span>
          <span className="mono text-[11px] uppercase tracking-[0.18em] text-[#007a8c]">
            Collect · Trace · Verify
          </span>
        </div>

        {/* 逐字遮罩上推 */}
        <h1 className="mt-7 text-[32px] sm:text-[56px] lg:text-[82px] leading-[1.02] sm:leading-[0.98] font-semibold tracking-[-0.03em] sm:tracking-[-0.045em] break-words">
          <span className="block overflow-hidden">
            <span className="block hero-line" style={{ ["--d" as string]: "80ms" }}>
              <SplitText text="把一天的信息" />
            </span>
          </span>
          <span className="block overflow-hidden">
            <span
              className="block hero-line"
              style={{ ["--d" as string]: "200ms" }}
            >
              <SplitText text="压成能验证的因果链" delay={180} />
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
          来自 <CountUp value={items} /> 条实采信息、{sources.length} 个信源。引擎不做摘要——
          <br className="hidden sm:block" />
          它把信息串成 <Metric value={chains} label="条因果链" />，每一环挂着原始出处，到期自动对账。
        </p>

        {/* CTA：磁性按钮 + 光泽扫过 */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/chains"
            className="cta cta-accent hero-line magnetic"
            style={{ ["--d" as string]: "320ms" }}
          >
            看今天的因果链 <span className="hero-arrow">→</span>
          </a>
          <a
            href="#brief"
            className="ghost hero-line magnetic"
            style={{ ["--d" as string]: "380ms" }}
          >
            先读简报
          </a>
        </div>

        {/* 数据条 */}
        <div
          className="hero-line mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-5 text-[11.5px] sm:text-[12.5px] text-zinc-400"
          style={{ ["--d" as string]: "440ms" }}
        >
          <span className="mono tabular-nums"><CountUp value={items} /> 信息</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums"><CountUp value={chains} /> 条链</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums"><CountUp value={steps} /> 个环节</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums">待验证 <CountUp value={verifyDue} /> 条</span>
        </div>
      </div>

      {/* 真实数据方块矩阵：手机 3 列 / 桌面 6 列，客户端每 60s 轮询实时刷新 */}
      <TileMatrix initialTiles={latestItems} />

      {/* 信源墙 — 对应 Mobbin 的 "Trusted by teams and agents at"，读真实启用源 */}
      <div className="mt-10 sm:mt-14">
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