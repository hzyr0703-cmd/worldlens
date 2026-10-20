"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* 数据类型                                                            */
/* ------------------------------------------------------------------ */

type EntityNode = { id: number; name: string; type: string; weight: number };
type EntityEdge = { src_id: number; dst_id: number; weight: number };

type AtomNode = {
  id: number;
  type: string;
  statement: string;
  confidence: number;
  domain: string;
  status: string;
  degree: number;
};
type AtomEdge = { src_id: number; dst_id: number; relation: string; rationale: string };

type Mode = "entities" | "atoms";

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

/**
 * 配色：分类色用低饱和柔和色板（同类语义，饱和度整体压低，避免图谱变成调色盘）。
 * 类型色承载"这是什么"，明度/半径承载"有多强"——两套编码各管一件事。
 */
const ENTITY_FILL: Record<string, string> = {
  macro: "#b04a5f",
  company: "#2f6f9e",
  person: "#a9782c",
  concept: "#2f7a5f",
  region: "#8a8f96",
};
const ENTITY_FILL_FALLBACK = "#6b7076";

const ENTITY_CN: Record<string, string> = {
  macro: "宏观", company: "公司", person: "人物", concept: "概念", region: "地区",
};

const ATOM_FILL: Record<string, string> = {
  mechanism: "#3f6f9e",
  pattern: "#a9762e",
  fact: "#6b7280",
  counterexample: "#b04a5f",
  judgment: "#2f7a5f",
  question: "#6b5aa8",
  norm: "#9c4d7a",
};

const ATOM_CN: Record<string, string> = {
  mechanism: "机制", pattern: "模式", fact: "硬事实",
  counterexample: "反例", judgment: "判断", question: "开放问题", norm: "潜规则",
};

/** 关系边色：低饱和版，线型仍区分语义 */
const RELATION_COLOR: Record<string, string> = {
  supports: "#4f8a6d",
  contradicts: "#b04a5f",
  explains: "#3f6f9e",
  extends: "#a9762e",
  analogy: "#8a8f96",
};

const RELATION_DASH: Record<string, string | undefined> = {
  contradicts: "5 3",
  analogy: "2 4",
};

const RELATION_CN: Record<string, string> = {
  supports: "支持", contradicts: "矛盾", explains: "解释",
  extends: "延伸", analogy: "类比",
};

/* ------------------------------------------------------------------ */
/* 力导向仿真 hook                                                     */
/* ------------------------------------------------------------------ */

type Pos = { x: number; y: number; vx: number; vy: number; pinned?: boolean };

function useForceLayout(
  svgRef: React.RefObject<SVGSVGElement | null>,
  nodes: { id: number }[],
  edges: { src_id: number; dst_id: number; strength: number }[],
  active: boolean
) {
  const posRef = useRef<Map<number, Pos>>(new Map());
  const rafRef = useRef(0);
  // tick 在 effect 内定义（含 Math.random，不能放渲染作用域），经 ref 供外部唤醒
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active || nodes.length === 0) return;
    const W = 900;
    const H = 620;
    const pos = posRef.current;
    pos.clear();
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2;
      const r = 240 + (i % 3) * 34;
      pos.set(n.id, {
        x: W / 2 + Math.cos(a) * r,
        y: H / 2 + Math.sin(a) * r * 0.82,
        vx: 0,
        vy: 0,
      });
    });

    let alpha = 1;
    let frame = 0;
    const tick = () => {
      if (alpha < 0.006 || frame > 2000) return;
      const arr = [...pos.entries()];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i][1];
          const b = arr[j][1];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random();
            dy = Math.random();
            d2 = 1;
          }
          const f = (2600 * alpha) / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * f;
          a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f;
          b.vy += (dy / d) * f;
        }
      }
      for (const e of edges) {
        const a = pos.get(e.src_id);
        const b = pos.get(e.dst_id);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = 120;
        const f = ((d - rest) * 0.022 * alpha * Math.min(3, e.strength)) / 1;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      for (const [, p] of pos) {
        // 拖拽固定的节点：不参与位移积分，但它的斥力仍作用于其它节点
        if (p.pinned) {
          p.vx = 0;
          p.vy = 0;
          continue;
        }
        p.vx += (W / 2 - p.x) * 0.0032 * alpha;
        p.vy += (H / 2 - p.y) * 0.0032 * alpha;
        p.x += Math.max(-12, Math.min(12, p.vx));
        p.y += Math.max(-12, Math.min(12, p.vy));
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x = Math.max(44, Math.min(W - 44, p.x));
        p.y = Math.max(30, Math.min(H - 30, p.y));
      }
      alpha *= 0.985;
      frame++;
      const svg = svgRef.current;
      if (!svg) return;
      svg.querySelectorAll<SVGLineElement>("line.edge").forEach((el) => {
        const a = pos.get(Number(el.dataset.src));
        const b = pos.get(Number(el.dataset.dst));
        if (a && b) {
          el.setAttribute("x1", String(a.x));
          el.setAttribute("y1", String(a.y));
          el.setAttribute("x2", String(b.x));
          el.setAttribute("y2", String(b.y));
        }
      });
      svg.querySelectorAll<SVGGElement>("g.gnode").forEach((g) => {
        const p = pos.get(Number(g.dataset.id));
        if (p) g.setAttribute("transform", `translate(${p.x},${p.y})`);
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    tickRef.current = () => {
      // 外部唤醒：把衰减中的 alpha 拉回来重新跑（拖拽/解除固定时调用）
      alpha = Math.max(alpha, 0.35);
      frame = 0;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // svgRef 是稳定的 ref 对象，纳入依赖不会引起额外重跑
  }, [nodes, edges, active, svgRef]);

  /** 拖拽：钉住节点到指定坐标，并唤醒仿真把其它节点推开 */
  const setPinned = (id: number, x: number, y: number) => {
    const p = posRef.current.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.pinned = true;
    tickRef.current();
  };

  /** 解除固定，节点回到力导向布局 */
  const unpin = (id: number) => {
    const p = posRef.current.get(id);
    if (p) p.pinned = false;
    tickRef.current();
  };

  return { setPinned, unpin };
}

/* ------------------------------------------------------------------ */
/* 主组件：双层图谱                                                    */
/* ------------------------------------------------------------------ */

export default function GraphCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  // 默认展示实体共现：60 个实体的网络比十几个同类型原子更有"图"的信息量
  const [mode, setMode] = useState<Mode>("entities");
  const [entityData, setEntityData] = useState<{ nodes: EntityNode[]; edges: EntityEdge[] } | null>(null);
  const [atomData, setAtomData] = useState<{ nodes: AtomNode[]; edges: AtomEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoverEntity, setHoverEntity] = useState<EntityNode | null>(null);
  const [selectedAtom, setSelectedAtom] = useState<AtomNode | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    const get = (m: string) =>
      fetch(`/api/graph?mode=${m}`, { signal: ctl.signal }).then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      });
    Promise.all([get("entities"), get("atoms")])
      .then(([ent, atm]) => {
        setEntityData({ nodes: Array.isArray(ent?.nodes) ? ent.nodes : [], edges: Array.isArray(ent?.edges) ? ent.edges : [] });
        setAtomData({ nodes: Array.isArray(atm?.nodes) ? atm.nodes : [], edges: Array.isArray(atm?.edges) ? atm.edges : [] });
        setLoading(false);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setLoadError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, []);

  /* ---- 实体层 ---- */
  const entityNodes = useMemo(() => entityData?.nodes ?? [], [entityData]);
  const entityEdges = useMemo(
    () => (entityData?.edges ?? []).map((e) => ({ src_id: e.src_id, dst_id: e.dst_id, strength: e.weight })),
    [entityData]
  );
  const entityLayout = useForceLayout(svgRef, entityNodes, entityEdges, mode === "entities");

  /* ---- 原子层 ---- */
  const atomNodes = useMemo(() => atomData?.nodes ?? [], [atomData]);
  const atomEdges = useMemo(
    () => (atomData?.edges ?? []).map((e) => ({ src_id: e.src_id, dst_id: e.dst_id, strength: 1 })),
    [atomData]
  );
  const atomLayout = useForceLayout(svgRef, atomNodes, atomEdges, mode === "atoms");

  /* ---- 节点拖拽固定 ----
   * 按住拖动 = 钉在该处（琥珀描边），双击 = 解除固定回到力导向。
   * 移动超过 4px 才算拖拽，避免吞掉原子层的点击（看详情）。 */
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(() => new Set());
  const dragRef = useRef<{ id: number; dx: number; dy: number; moved: boolean; layout: { setPinned: (id: number, x: number, y: number) => void; unpin: (id: number) => void } } | null>(null);
  const suppressClickRef = useRef(false);

  const svgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };

  const beginDrag = (e: React.PointerEvent, id: number, layout: typeof entityLayout) => {
    if (e.button !== 0) return;
    const pt = svgPoint(e.clientX, e.clientY);
    if (!pt) return;
    dragRef.current = { id, dx: pt.x, dy: pt.y, moved: false, layout };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = svgPoint(ev.clientX, ev.clientY);
      if (!p) return;
      if (!d.moved && Math.hypot(p.x - d.dx, p.y - d.dy) < 4) return;
      d.moved = true;
      suppressClickRef.current = true;
      d.layout.setPinned(d.id, p.x, p.y);
      setPinnedIds((s) => new Set(s).add(d.id));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
      setTimeout(() => (suppressClickRef.current = false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const togglePin = (id: number, layout: typeof entityLayout) => {
    setPinnedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
        layout.unpin(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const atomMap = useMemo(() => new Map(atomNodes.map((n) => [n.id, n])), [atomNodes]);
  const atomEdgesOf = (id: number) =>
    (atomData?.edges ?? []).filter((e) => e.src_id === id || e.dst_id === id);

  if (loading) {
    return (
      <div className="shimmer relative overflow-hidden rounded-2xl">
        <p className="py-16 text-center text-[13.5px] text-zinc-400">加载图谱…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="empty">
        <p className="text-[15px] font-medium">图谱数据加载失败</p>
        <p className="mono mt-3 text-[12px] text-red-600">{loadError}</p>
        <button onClick={() => window.location.reload()} className="btn-solid mt-6">
          重试
        </button>
      </div>
    );
  }

  /* ---- 空态 ---- */
  const hasEntities = (entityData?.nodes.length ?? 0) > 0;
  const hasAtoms = (atomData?.edges.length ?? 0) > 0;
  const showEmpty = mode === "atoms" ? !hasAtoms : !hasEntities;

  return (
    <div>
      {/* 层切换 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setMode("atoms");
            setPinnedIds(new Set()); // 两层布局独立，切层清空固定状态
          }}
          className={`pill magnetic ${mode === "atoms" ? "pill-active" : ""}`}
        >
          原子关系网
          <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">
            {atomData?.nodes.length ?? 0}
          </span>
        </button>
        <button
          onClick={() => {
            setMode("entities");
            setPinnedIds(new Set());
          }}
          className={`pill magnetic ${mode === "entities" ? "pill-active" : ""}`}
        >
          实体共现
          <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">
            {entityData?.nodes.length ?? 0}
          </span>
        </button>
        <span className="ml-auto text-[12.5px] text-zinc-500">
          {mode === "atoms"
            ? "节点=认知原子 · 边=支持 / 矛盾 / 解释 / 延伸 / 类比"
            : "节点=实体 · 边=30 天内共同出现强度"}
        </span>
      </div>

      {showEmpty ? (
        <div className="empty">
          <p className="text-[15px] font-medium">
            {mode === "atoms" ? "原子关系网还没生长出来" : "实体共现网还没生长出来"}
          </p>
          <p className="mx-auto mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-zinc-500">
            {mode === "atoms"
              ? "蒸馏或拷问产生的原子之间建立关系（支持/矛盾/解释）后，这里会连成你的认知网络。"
              : "多跑几轮「采集信息」，实体共现边会随信息密度生长。"}
          </p>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox="0 0 900 620"
            preserveAspectRatio="xMidYMid meet"
            className="w-full max-h-[70vh] rounded-2xl border border-zinc-200 bg-[#fcfcfd]"
          >
            {/* 边 */}
            {mode === "entities" &&
              entityData!.edges.map((e, i) => {
                const maxW = Math.max(...entityData!.edges.map((x) => x.weight), 1);
                return (
                  <line
                    key={`ee-${i}`}
                    className="edge"
                    data-src={e.src_id}
                    data-dst={e.dst_id}
                    x1="0" y1="0" x2="0" y2="0"
                    stroke="#c2c2c8"
                    strokeWidth={0.5 + (e.weight / maxW) * 2.2}
                    strokeOpacity={0.3 + (e.weight / maxW) * 0.4}
                  />
                );
              })}
            {mode === "atoms" &&
              atomData!.edges.map((e, i) => (
                <line
                  key={`ae-${i}`}
                  className="edge"
                  data-src={e.src_id}
                  data-dst={e.dst_id}
                  x1="0" y1="0" x2="0" y2="0"
                  stroke={RELATION_COLOR[e.relation] ?? "#8a8f96"}
                  strokeWidth={1.3}
                  strokeOpacity={0.55}
                  strokeDasharray={RELATION_DASH[e.relation]}
                />
              ))}
            {/* 节点 */}
            {mode === "entities" &&
              entityData!.nodes.map((n) => (
                <g
                  key={n.id}
                  className="gnode"
                  data-id={n.id}
                  onMouseEnter={() => setHoverEntity(n)}
                  onMouseLeave={() => setHoverEntity(null)}
                  onPointerDown={(e) => beginDrag(e, n.id, entityLayout)}
                  onDoubleClick={() => togglePin(n.id, entityLayout)}
                  style={{ cursor: pinnedIds.has(n.id) ? "grabbing" : "grab" }}
                >
                  <circle
                    r={(6 + Math.min(10, Math.sqrt(n.weight) * 2.5)) * 1.15}
                    fill={ENTITY_FILL[n.type] ?? ENTITY_FILL_FALLBACK}
                    fillOpacity={0.88}
                    stroke={pinnedIds.has(n.id) ? "#d9a441" : "#fff"}
                    strokeWidth={pinnedIds.has(n.id) ? 2.2 : 1.2}
                  />
                  <text
                    y={-12}
                    textAnchor="middle"
                    fontSize={10.5}
                    fill="#3f3f46"
                    fontWeight={500}
                    stroke="#fcfcfd"
                    strokeWidth={2.6}
                    paintOrder="stroke"
                  >
                    {n.name.slice(0, 8)}
                  </text>
                </g>
              ))}
            {mode === "atoms" &&
              atomData!.nodes.map((n) => (
                <g
                  key={n.id}
                  className="gnode"
                  data-id={n.id}
                  onPointerDown={(e) => beginDrag(e, n.id, atomLayout)}
                  onClick={() => {
                    if (suppressClickRef.current) return; // 拖拽结束不触发点击
                    setSelectedAtom(selectedAtom?.id === n.id ? null : n);
                  }}
                  onDoubleClick={() => togglePin(n.id, atomLayout)}
                  style={{ cursor: pinnedIds.has(n.id) ? "grabbing" : "pointer" }}
                >
                  <circle
                    r={(8 + n.confidence * 10) * 1.15}
                    fill={ATOM_FILL[n.type] ?? "#6b7280"}
                    fillOpacity={selectedAtom?.id === n.id ? 1 : 0.85}
                    stroke={
                      pinnedIds.has(n.id)
                        ? "#d9a441"
                        : selectedAtom?.id === n.id
                          ? "#0a0a0b"
                          : "#fff"
                    }
                    strokeWidth={selectedAtom?.id === n.id || pinnedIds.has(n.id) ? 2.2 : 1.2}
                  />
                  <text
                    y={-16}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#3f3f46"
                    fontWeight={500}
                    stroke="#fcfcfd"
                    strokeWidth={2.6}
                    paintOrder="stroke"
                  >
                    {n.statement.slice(0, 7)}
                  </text>
                </g>
              ))}
          </svg>

          {/* 实体悬停卡 */}
          {mode === "entities" && hoverEntity && (
            <div className="panel absolute top-3 right-3 max-w-[260px] px-4 py-2.5 text-[12.5px]">
              <span className="font-semibold">{hoverEntity.name}</span>
              <span className="ml-2 text-zinc-500">
                {ENTITY_CN[hoverEntity.type] ?? hoverEntity.type} · 提及 {hoverEntity.weight} 次
              </span>
            </div>
          )}

          {/* 原子点击详情 */}
          {mode === "atoms" && selectedAtom && (
            <div className="panel absolute top-3 right-3 w-[300px] p-5">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: ATOM_FILL[selectedAtom.type] ?? "#6b7280" }}
                />
                <span className="text-[12.5px] font-semibold">
                  {ATOM_CN[selectedAtom.type] ?? selectedAtom.type}
                </span>
                <span className="mono ml-auto text-[11px] text-zinc-400 tabular-nums">
                  置信 {Math.round(selectedAtom.confidence * 100)}% · {selectedAtom.degree} 条关系
                </span>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-zinc-800">
                {selectedAtom.statement}
              </p>
              {atomEdgesOf(selectedAtom.id).length > 0 && (
                <div className="mt-4 space-y-2 border-t border-zinc-100 pt-3">
                  {atomEdgesOf(selectedAtom.id).slice(0, 6).map((e, i) => {
                    const otherId = e.src_id === selectedAtom.id ? e.dst_id : e.src_id;
                    const other = atomMap.get(otherId);
                    return (
                      <div key={i} className="flex items-start gap-2 text-[12px]">
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 font-medium"
                          style={{
                            background: `${RELATION_COLOR[e.relation] ?? "#8a8f96"}1f`,
                            color: RELATION_COLOR[e.relation] ?? "#6b7076",
                          }}
                        >
                          {RELATION_CN[e.relation] ?? e.relation}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-zinc-600" title={e.rationale}>
                          {other?.statement.slice(0, 36) ?? `#${otherId}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <a
                href={`/library?q=${encodeURIComponent(selectedAtom.statement.slice(0, 12))}`}
                className="mt-4 inline-block text-[12px] text-[#007a8c] hover:underline"
              >
                在认知库中查看 →
              </a>
              <button
                onClick={() => setSelectedAtom(null)}
                className="absolute top-3 right-3 text-zinc-300 hover:text-zinc-600"
              >
                ×
              </button>
            </div>
          )}

          {/* 图例：颜色=类型，尺寸=强弱 */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-zinc-500">
            {mode === "entities" ? (
              <>
                {Object.entries(ENTITY_CN).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: ENTITY_FILL[k] }} />
                    {v}
                  </span>
                ))}
                <span className="inline-flex items-center gap-2">
                  <svg width="34" height="14" aria-hidden>
                    <circle cx="6" cy="7" r="3.5" fill="#6b7076" />
                    <circle cx="26" cy="7" r="8" fill="#6b7076" fillOpacity={0.88} />
                  </svg>
                  提及越多越大
                </span>
                <span className="inline-flex items-center gap-2">
                  <svg width="34" height="10" aria-hidden>
                    <line x1="1" y1="5" x2="33" y2="5" stroke="#c2c2c8" strokeWidth={2.4} />
                  </svg>
                  边越粗＝共现越强
                </span>
              </>
            ) : (
              <>
                {Object.entries(ATOM_CN).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: ATOM_FILL[k] }} />
                    {v}
                  </span>
                ))}
                <span className="ml-auto inline-flex items-center gap-3">
                  {(["supports", "contradicts", "explains", "extends", "analogy"] as const).map((k) => (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <svg width="26" height="8" aria-hidden>
                        <line
                          x1="1" y1="4" x2="25" y2="4"
                          stroke={RELATION_COLOR[k]}
                          strokeWidth={1.3}
                          strokeDasharray={RELATION_DASH[k]}
                        />
                      </svg>
                      {RELATION_CN[k]}
                    </span>
                  ))}
                </span>
              </>
            )}
            <span className={mode === "atoms" ? "" : "ml-auto"}>
              {mode === "atoms"
                ? "点击看详情 · 拖动固定 · 双击解除"
                : "悬停看详情 · 拖动固定 · 双击解除"}
            </span>
            {pinnedIds.size > 0 && (
              <button
                onClick={() => {
                  pinnedIds.forEach((id) => (mode === "entities" ? entityLayout.unpin(id) : atomLayout.unpin(id)));
                  setPinnedIds(new Set());
                }}
                className="ml-auto text-[12px] text-[#007a8c] hover:underline cursor-pointer"
              >
                重置布局（{pinnedIds.size} 个已固定）
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
