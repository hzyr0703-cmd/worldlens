/**
 * Hero — 复刻 Mobbin 首屏结构：
 * 居中巨型标题（逐行遮罩上推入场）→ 数字副标 → 多列交错上下滚动的彩色方块矩阵
 * 列数随断点变化（手机 3 列 / 桌面 6 列），保证方块在所有尺寸下都接近正方形，
 * 避免宽屏下被拉成扁长条。方块内容全部来自真实认知原子类型，不造假。
 */

type Tile = { label: string; sub: string; from: string; to: string; ink: string };

const TILE_STYLE: Tile[] = [
  { label: "机制", sub: "mechanism", from: "#00b8d4", to: "#0e7490", ink: "#fff" },
  { label: "反例", sub: "counterexample", from: "#fb7185", to: "#e11d48", ink: "#fff" },
  { label: "硬事实", sub: "fact", from: "#fbbf24", to: "#d97706", ink: "#3b1d02" },
  { label: "模式", sub: "pattern", from: "#a78bfa", to: "#7c3aed", ink: "#fff" },
  { label: "判断", sub: "judgment", from: "#34d399", to: "#059669", ink: "#022c22" },
  { label: "开放问题", sub: "question", from: "#60a5fa", to: "#2563eb", ink: "#fff" },
  { label: "印证", sub: "reinforced", from: "#f472b6", to: "#db2777", ink: "#fff" },
  { label: "修正", sub: "revised", from: "#fcd34d", to: "#f59e0b", ink: "#3b1d02" },
];

function TileGrid({ items, down, dur, hideBelowLg }: {
  items: Tile[];
  down?: boolean;
  dur: string;
  /** 桌面 6 列时，后 3 列在手机上隐藏 */
  hideBelowLg?: boolean;
}) {
  // 复制一份实现无缝循环（translateY(-50%) 对齐）
  const doubled = [...items, ...items];
  return (
    <div className={`marquee ${down ? "marquee-down" : ""} ${hideBelowLg ? "hidden lg:block" : ""}`}>
      <div className="marquee-track" style={{ ["--dur" as string]: dur }}>
        {doubled.map((t, i) => (
          <div
            key={`${t.label}-${i}`}
            className="tile tile-in"
            style={{
              background: `linear-gradient(145deg, ${t.from}, ${t.to})`,
              color: t.ink,
              // 每列首屏内的方块逐块 60ms 错峰入场，第二份副本延迟一个周期
              ["--d" as string]: `${(i % items.length) * 60 + (i >= items.length ? 120 : 0)}ms`,
            }}
          >
            <div className="text-[15px] font-semibold leading-none tracking-[-0.01em]">{t.label}</div>
            <div className="text-[10px] opacity-75 mono leading-none">{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Hero({
  items,
  articles,
  nuggets,
  due,
  typeCounts,
  llmCalls,
  sources,
}: {
  items: number;
  articles: number;
  nuggets: number;
  due: number;
  typeCounts: Record<string, number>;
  llmCalls: number;
  sources: string[];
}) {
  const c1 = [TILE_STYLE[0], TILE_STYLE[3], TILE_STYLE[5], TILE_STYLE[1], TILE_STYLE[7]];
  const c2 = [TILE_STYLE[2], TILE_STYLE[6], TILE_STYLE[4], TILE_STYLE[0], TILE_STYLE[5]];
  const c3 = [TILE_STYLE[1], TILE_STYLE[4], TILE_STYLE[2], TILE_STYLE[7], TILE_STYLE[3]];
  // 桌面端追加 3 列，把宽屏下的长条比例拉回接近正方
  const c4 = [TILE_STYLE[5], TILE_STYLE[1], TILE_STYLE[6], TILE_STYLE[3], TILE_STYLE[2]];
  const c5 = [TILE_STYLE[4], TILE_STYLE[0], TILE_STYLE[7], TILE_STYLE[5], TILE_STYLE[1]];
  const c6 = [TILE_STYLE[3], TILE_STYLE[2], TILE_STYLE[4], TILE_STYLE[6], TILE_STYLE[0]];

  return (
    <section className="pt-10 sm:pt-16">
      {/* 巨型标题 */}
      <div className="text-center">
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

        {/* 逐行遮罩上推 */}
        <h1 className="mt-7 text-[44px] sm:text-[68px] lg:text-[82px] leading-[0.98] font-semibold tracking-[-0.045em]">
          <span className="block overflow-hidden">
            <span className="block hero-line" style={{ ["--d" as string]: "80ms" }}>
              读过的世界
            </span>
          </span>
          <span className="block overflow-hidden">
            <span
              className="block hero-line"
              style={{ ["--d" as string]: "200ms" }}
            >
              变成你自己的理解
            </span>
          </span>
        </h1>

        {/* 画龙点睛①：标题下方的青色短线，从中心展开 */}
        <div className="mt-8 flex justify-center">
          <span className="hero-rule" />
        </div>

        {/* 副标 */}
        <p className="hero-line mt-7 text-[17px] sm:text-[19px] leading-relaxed text-zinc-600 max-w-[60ch] mx-auto">
          {items.toLocaleString()} 条真实信息采集入库，{articles} 篇深度长文全文可读。
          <br className="hidden sm:block" />
          AI 不替你理解——它出题、等你作答、指出你漏掉的那一层。
        </p>

        {/* CTA */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a href="/inbox" className="cta cta-accent hero-line" style={{ ["--d" as string]: "320ms" }}>
            挑一篇开始精读 <span className="hero-arrow">→</span>
          </a>
          <a
            href="/review"
            className="ghost hero-line"
            style={{ ["--d" as string]: "380ms" }}
          >
            {due > 0 ? `${due} 张卡片待复习` : "复习队列"}
          </a>
        </div>

        {/* 数据条 */}
        <div className="hero-line mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-5 text-[11.5px] sm:text-[12.5px] text-zinc-400" style={{ ["--d" as string]: "440ms" }}>
          <span className="mono tabular-nums">{items} 信息</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums">{articles} 长文</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums">{nuggets} 原子</span>
          <span className="hero-dot" />
          <span className="mono tabular-nums">LLM {llmCalls} 次/日</span>
        </div>
      </div>

      {/* 彩色方块矩阵：手机 3 列 / 桌面 6 列，比例在所有尺寸下都接近正方 */}
      <div className="hero-matrix mt-12 sm:mt-20 grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 h-[300px] sm:h-[480px]">
        <TileGrid items={c1} dur="52s" />
        <TileGrid items={c2} down dur="61s" />
        <TileGrid items={c3} dur="44s" />
        <TileGrid items={c4} down dur="56s" hideBelowLg />
        <TileGrid items={c5} dur="64s" hideBelowLg />
        <TileGrid items={c6} down dur="48s" hideBelowLg />
      </div>

      {/* 分类标签行 — Mobbin 的招牌导航形态 */}
      <div className="mt-14 sm:mt-16 flex flex-wrap items-center justify-center gap-2">
        {[
          { l: "机制", k: "mechanism" },
          { l: "模式", k: "pattern" },
          { l: "硬事实", k: "fact" },
          { l: "反例", k: "counterexample" },
          { l: "判断", k: "judgment" },
          { l: "开放问题", k: "question" },
        ].map((t) => (
          <a key={t.k} href="/library" className="pill !text-[13px] !py-2 !px-4">
            {t.l}
            <span className="mono text-[11px] text-zinc-400 tabular-nums">
              {typeCounts[t.k] ?? 0}
            </span>
          </a>
        ))}
      </div>

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
