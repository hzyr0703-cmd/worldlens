"use client";

/**
 * TileMatrix — 首页方块矩阵（客户端组件，实时轮询）。
 *
 * SSR 传入初始数据保证首屏就有内容；之后每 60s 拉 /api/live-tiles，
 * 数据有变化才 setState（避免无谓重渲染打断 marquee 动画）。
 * 拉取失败静默忽略——矩阵继续用上一份数据滚动。
 */
import { useEffect, useRef, useState } from "react";

type TileData = {
  id: number;
  title: string;
  tier: number;
  source: string;
  link: string;
  date: string;
};

/** YYYY-MM-DD → MM-DD（当年信息省年份，信息流常规格式） */
function fmtDate(d: string): string {
  return d.length >= 10 ? d.slice(5, 10) : "";
}

/**
 * 方块配色：暖中性明度阶。T0 炭黑（最重）→ T3 纸白（最淡），
 * 六列滚动时是一条干净的明度流，不抢内容、不打架。
 * line 描边按深浅分向：深块透白、浅块压深墨，保证浅色块在浅背景上仍有轮廓。
 */
const TIER_STYLE = {
  0: { from: "#22262b", to: "#171a1e", ink: "#f6f6f5", label: "T0", line: "rgba(255,255,255,0.14)" },
  1: { from: "#4a4f55", to: "#3a3f45", ink: "#f4f4f3", label: "T1", line: "rgba(255,255,255,0.13)" },
  2: { from: "#9a9fa5", to: "#868c93", ink: "#ffffff", label: "T2", line: "rgba(255,255,255,0.34)" },
  3: { from: "#ece9e3", to: "#ddd9d1", ink: "#2a2d31", label: "T3", line: "rgba(36,39,43,0.10)" },
} as const;

/** 摘要：中文取前 22 字，英文按词取前 6 个，避免长标题撑破方块 */
function summarize(t: string, max = 22): string {
  const s = t.trim();
  if (/[\u4e00-\u9fff]/.test(s)) return s.slice(0, max);
  const words = s.split(/\s+/).slice(0, 6).join(" ");
  return words.length > 42 ? words.slice(0, 42) + "…" : words;
}

/** 把快讯按 id 稳定洗牌，再切成 6 列（每列内容不同但都能无缝循环） */
function splitCols(tiles: TileData[]): TileData[][] {
  const shuffled = [...tiles].sort((a, b) => (a.id % 7) - (b.id % 7) || b.id - a.id);
  const perCol = Math.max(3, Math.ceil(shuffled.length / 6));
  const cols: TileData[][] = [];
  for (let i = 0; i < 6; i++) {
    const slice = shuffled.slice(i * perCol, (i + 1) * perCol);
    cols.push(slice.length >= 3 ? slice : shuffled.slice(0, 3));
  }
  return cols;
}

function TileColumn({ items, down, dur, hideBelowLg }: {
  items: TileData[];
  down?: boolean;
  dur: string;
  hideBelowLg?: boolean;
}) {
  // 复制一份实现无缝循环（translateY(-50%) 对齐）
  const doubled = [...items, ...items];
  return (
    <div className={`marquee ${down ? "marquee-down" : ""} ${hideBelowLg ? "hidden lg:block" : ""}`}>
      <div className="marquee-track" style={{ ["--dur" as string]: dur }}>
        {doubled.map((it, i) => {
          const st = TIER_STYLE[Math.min(3, Math.max(0, it.tier)) as 0 | 1 | 2 | 3];
          const hasLink = it.link.startsWith("http");
          const body = (
            <>
              <div className="text-[15px] font-semibold leading-[1.32] tracking-[-0.012em] line-clamp-3">
                {summarize(it.title)}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] opacity-80 mono leading-none mt-2">
                <span className="font-semibold">{st.label}</span>
                {fmtDate(it.date) && (
                  <span className="opacity-70 tabular-nums shrink-0">{fmtDate(it.date)}</span>
                )}
                <span className="opacity-60 truncate">{it.source}</span>
                {hasLink && (
                  <span className="ml-auto opacity-0 group-hover:opacity-70 transition-opacity duration-200 shrink-0">
                    ↗
                  </span>
                )}
              </div>
            </>
          );
          const style = {
            background: `linear-gradient(145deg, ${st.from}, ${st.to})`,
            color: st.ink,
            ["--line" as string]: st.line,
            ["--d" as string]: `${(i % items.length) * 60 + (i >= items.length ? 120 : 0)}ms`,
          };
          return hasLink ? (
            <a
              key={`${it.id}-${i}`}
              className="tile tile-in group"
              style={style}
              href={it.link}
              target="_blank"
              rel="noreferrer"
              title={it.title}
            >
              {body}
            </a>
          ) : (
            <div key={`${it.id}-${i}`} className="tile tile-in" style={style}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const POLL_MS = 60_000;
/** 每批条数（与 API 的 limit 一致），"换一批"按批循环 */
const BATCH = 42;

export default function TileMatrix({ initialTiles }: { initialTiles: TileData[] }) {
  const [tiles, setTiles] = useState<TileData[]>(initialTiles);
  const snapshot = useRef(JSON.stringify(initialTiles));
  const [offset, setOffset] = useState(0);
  const [shifting, setShifting] = useState(false);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        // 轮询永远拉最新一批；用户手动换批后，offset 会覆盖回来（下一轮回到最新）
        const res = await fetch(`/api/live-tiles?offset=${offset}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { tiles?: TileData[] };
        if (!data.tiles?.length) return;
        const next = JSON.stringify(data.tiles);
        if (next === snapshot.current) return; // 内容没变就不打断动画
        snapshot.current = next;
        setTiles(data.tiles);
      } catch {
        /* 网络抖动：保留现有矩阵继续滚动 */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [offset]);

  /** 换一批：向后翻页循环（到底回第一批），立即拉取不打断动画节奏 */
  const shift = async () => {
    if (shifting) return;
    setShifting(true);
    try {
      const nextOffset = offset + BATCH;
      const res = await fetch(`/api/live-tiles?offset=${nextOffset}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { tiles?: TileData[] };
        if (data.tiles?.length && data.tiles.length >= 12) {
          snapshot.current = JSON.stringify(data.tiles);
          setTiles(data.tiles);
          setOffset(nextOffset);
        } else {
          // 到底了：回到第一批
          const res2 = await fetch("/api/live-tiles", { cache: "no-store" });
          if (res2.ok) {
            const d2 = (await res2.json()) as { tiles?: TileData[] };
            if (d2.tiles?.length) {
              snapshot.current = JSON.stringify(d2.tiles);
              setTiles(d2.tiles);
              setOffset(0);
            }
          }
        }
      }
    } catch {
      /* 失败保持现状 */
    } finally {
      setShifting(false);
    }
  };

  const cols = splitCols(tiles);

  return (
    <>
      <div className="hero-matrix parallax mt-12 sm:mt-20 grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 h-[340px] sm:h-[520px]">
        <TileColumn items={cols[0]} dur="52s" />
        <TileColumn items={cols[1]} down dur="61s" />
        <TileColumn items={cols[2]} dur="44s" />
        <TileColumn items={cols[3]} down dur="56s" hideBelowLg />
        <TileColumn items={cols[4]} dur="64s" hideBelowLg />
        <TileColumn items={cols[5]} down dur="48s" hideBelowLg />
      </div>

      {/* 手动换一批：向后循环取数 */}
      <div className="mt-6 flex justify-center">
        <button onClick={shift} disabled={shifting} className="pill magnetic !py-2 !px-4">
          {shifting ? "换一批…" : "换一批"}
          <span className="mono text-[11px] text-zinc-400">{shifting ? "" : " ↻"}</span>
        </button>
      </div>
    </>
  );
}
