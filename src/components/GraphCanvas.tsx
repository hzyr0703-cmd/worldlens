"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* 数据类型                                                            */
/* ------------------------------------------------------------------ */

type EntityNode = { id: number; name: string; type: string; weight: number; degree?: number; r?: number };
type EntityEdge = {
  src_id: number;
  dst_id: number;
  weight: number;
  /** 重叠度（共现文章 / 两者出现过的文章并集）：画线宽用，比绝对次数更能代表关系强度 */
  overlap?: number;
  evidence?: { id: number; title: string; date: string }[];
};

type AtomNode = {
  id: number;
  type: string;
  statement: string;
  confidence: number;
  domain: string;
  status: string;
  degree: number;
  r?: number;
};
type AtomEdge = { src_id: number; dst_id: number; relation: string; rationale: string };

type Mode = "entities" | "atoms";

/**
 * 原子节点标签：statement.slice(0,7) 得到的是「2026年9月」「黄金市场中，E」这类残句。
 * 优先取第一个分句（读到逗号/句号/冒号为止），最长 12 字——再长会压到邻居的标签。
 */
function atomLabel(s: string): string {
  const head = s.split(/[，。；：、,;:]/)[0].trim();
  if (head.length >= 4 && head.length <= 12) return head;
  return s.slice(0, 12);
}

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
  nodes: { id: number; r?: number }[],
  edges: { src_id: number; dst_id: number; strength: number }[],
  active: boolean
) {
  const posRef = useRef<Map<number, Pos>>(new Map());
  const rafRef = useRef(0);
  // tick 在 effect 内定义（含 Math.random，不能放渲染作用域），经 ref 供外部唤醒
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active || nodes.length === 0) return;
    const W = 1200;
    const H = 800;
    const pos = posRef.current;
    pos.clear();
    // 碰撞半径：圆点不能叠在一起，标签也要留出位置
    const radiusOf = new Map(nodes.map((n) => [n.id, n.r ?? 20]));
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2;
      const r = 340 + (i % 3) * 46;
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
          const f = (5200 * alpha) / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * f;
          a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f;
          b.vy += (dy / d) * f;
          // 碰撞分离：斥力按 d² 衰减，两个节点的圆已经开始重叠时反而推不开，
          // 必须按实际半径硬撑开——否则会出现「AI / AI算力」叠成一个疙瘩。
          // +44 是留给标签的：7 个字约 80px 宽，只按圆半径撑开会标签压标签。
          const minD = (radiusOf.get(arr[i][0]) ?? 20) + (radiusOf.get(arr[j][0]) ?? 20) + 44;
          if (d < minD) {
            const push = (minD - d) * 0.6;
            a.vx -= (dx / d) * push;
            a.vy -= (dy / d) * push;
            b.vx += (dx / d) * push;
            b.vy += (dy / d) * push;
          }
        }
      }
      for (const e of edges) {
        const a = pos.get(e.src_id);
        const b = pos.get(e.dst_id);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = 170;
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
        p.vx += (W / 2 - p.x) * 0.0024 * alpha;
        p.vy += (H / 2 - p.y) * 0.0024 * alpha;
        p.x += Math.max(-12, Math.min(12, p.vx));
        p.y += Math.max(-12, Math.min(12, p.vy));
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x = Math.max(76, Math.min(W - 76, p.x));
        // 上方多留一点：标签画在圆的正上方
        p.y = Math.max(78, Math.min(H - 60, p.y));
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
  /** 点击聚焦：只保留该实体与邻居，其余淡化——60 个点的图，不聚焦看不出结构 */
  const [focusId, setFocusId] = useState<number | null>(null);

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
  // 半径在这里算好传给布局：碰撞检测需要知道每个圆多大，否则圆会叠在一起
  const entityNodes = useMemo(
    () => (entityData?.nodes ?? []).map((n) => ({ ...n, r: 11 + Math.min(12, Math.sqrt(n.weight) * 2.2) })),
    [entityData]
  );
  const entityEdges = useMemo(
    () => (entityData?.edges ?? []).map((e) => ({ src_id: e.src_id, dst_id: e.dst_id, strength: e.weight })),
    [entityData]
  );
  const entityLayout = useForceLayout(svgRef, entityNodes, entityEdges, mode === "entities");

  /* ---- 聚焦：选中实体的邻居（按共现强度排序，带证据）---- */
  const entityMap = useMemo(
    () => new Map<number, EntityNode>(entityNodes.map((n) => [n.id, n])),
    [entityNodes]
  );
  const focusEntity = focusId === null ? null : entityMap.get(focusId) ?? null;
  const focusNeighbors = useMemo(() => {
    if (focusId === null) return [];
    return (entityData?.edges ?? [])
      .filter((e) => e.src_id === focusId || e.dst_id === focusId)
      .map((e) => ({
        other: entityMap.get(e.src_id === focusId ? e.dst_id : e.src_id),
        edge: e,
      }))
      .filter((x): x is { other: EntityNode; edge: EntityEdge } => Boolean(x.other))
      .sort((a, b) => b.edge.weight - a.edge.weight);
  }, [focusId, entityData, entityMap]);
  const neighborSet = useMemo(() => new Set(focusNeighbors.map((x) => x.other.id)), [focusNeighbors]);

  /* ---- 原子层 ---- */
  const atomNodes = useMemo(
    () => (atomData?.nodes ?? []).map((n) => ({ ...n, r: 12 + n.confidence * 11 })),
    [atomData]
  );
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
            setMode("entities");
            setPinnedIds(new Set()); // 两层布局独立，切层清空固定状态
            setFocusId(null);
          }}
          className={`pill magnetic ${mode === "entities" ? "pill-active" : ""}`}
        >
          实体共现
          <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">
            {entityData?.nodes.length ?? 0}
          </span>
        </button>
        <button
          onClick={() => {
            setMode("atoms");
            setPinnedIds(new Set());
            setFocusId(null);
          }}
          className={`pill magnetic ${mode === "atoms" ? "pill-active" : ""}`}
        >
          原子关系网
          <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">
            {atomData?.nodes.length ?? 0}
          </span>
        </button>
        <span className="ml-auto text-[12.5px] text-zinc-500">
          {mode === "atoms"
            ? "点=看这条原子与谁相连 · 边=支持 / 矛盾 / 解释 / 延伸 / 类比"
            : "点一个实体，看它和谁绑在一起、凭什么绑"}
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
            viewBox="0 0 1200 800"
            preserveAspectRatio="xMidYMid meet"
            className="w-full max-h-[70vh] rounded-2xl border border-zinc-200 bg-[#fcfcfd]"
          >
            {/* 边 */}
            {mode === "entities" &&
              entityData!.edges.map((e, i) => {
                const maxJ = Math.max(...entityData!.edges.map((x) => x.overlap ?? 0), 0.01);
                const related = focusId === null || e.src_id === focusId || e.dst_id === focusId;
                const j = e.overlap ?? 0;
                return (
                  <line
                    key={`ee-${i}`}
                    className="edge"
                    data-src={e.src_id}
                    data-dst={e.dst_id}
                    x1="0" y1="0" x2="0" y2="0"
                    stroke={related && focusId !== null ? "#6f7480" : "#a8a8b0"}
                    // 用 sqrt 归一：弱边也至少 1.9px，否则整张图看起来只有散点、没有网络
                    strokeWidth={1.3 + Math.sqrt(j / maxJ) * 2.4 + (related && focusId !== null ? 0.9 : 0)}
                    strokeOpacity={related ? 0.5 + Math.sqrt(j / maxJ) * 0.4 : 0.06}
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
              entityData!.nodes.map((n) => {
                const dimmed = focusId !== null && n.id !== focusId && !neighborSet.has(n.id);
                const isFocus = focusId === n.id;
                return (
                <g
                  key={n.id}
                  className="gnode"
                  data-id={n.id}
                  onMouseEnter={() => setHoverEntity(n)}
                  onMouseLeave={() => setHoverEntity(null)}
                  onPointerDown={(e) => beginDrag(e, n.id, entityLayout)}
                  onClick={() => {
                    if (suppressClickRef.current) return; // 拖拽结束不触发点击
                    setFocusId(isFocus ? null : n.id);
                  }}
                  onDoubleClick={() => togglePin(n.id, entityLayout)}
                  style={{ cursor: pinnedIds.has(n.id) ? "grabbing" : "pointer" }}
                >
                  <circle
                    r={n.r ?? 20}
                    fill={ENTITY_FILL[n.type] ?? ENTITY_FILL_FALLBACK}
                    fillOpacity={dimmed ? 0.12 : 0.88}
                    stroke={pinnedIds.has(n.id) ? "#d9a441" : isFocus ? "#0a0a0b" : "#fff"}
                    strokeWidth={pinnedIds.has(n.id) || isFocus ? 2.6 : 1.4}
                  />
                  <text
                    y={-((n.r ?? 20) + 6)}
                    textAnchor="middle"
                    fontSize={11.5}
                    fill={dimmed ? "#c9c9ce" : "#3f3f46"}
                    fontWeight={isFocus ? 700 : 500}
                    stroke="#fcfcfd"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {n.name.slice(0, 7)}
                  </text>
                </g>
                );
              })}
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
                    r={n.r ?? 20}
                    fill={ATOM_FILL[n.type] ?? "#6b7280"}
                    fillOpacity={selectedAtom?.id === n.id ? 1 : 0.85}
                    stroke={
                      pinnedIds.has(n.id)
                        ? "#d9a441"
                        : selectedAtom?.id === n.id
                          ? "#0a0a0b"
                          : "#fff"
                    }
                    strokeWidth={selectedAtom?.id === n.id || pinnedIds.has(n.id) ? 2.6 : 1.4}
                  />
                  <text
                    y={-((n.r ?? 20) + 7)}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#3f3f46"
                    fontWeight={500}
                    stroke="#fcfcfd"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {atomLabel(n.statement)}
                  </text>
                </g>
              ))}
          </svg>

          {/* 实体聚焦卡：点一个实体，看它和谁绑在一起、凭什么绑 */}
          {mode === "entities" && focusEntity && (
            <div className="panel absolute top-3 right-3 flex max-h-[calc(100%-1.5rem)] w-[330px] flex-col p-5">
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold">{focusEntity.name}</span>
                    <span className="text-[11px] text-zinc-500">
                      {ENTITY_CN[focusEntity.type] ?? focusEntity.type} · 提及 {focusEntity.weight} 次
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-zinc-400">
                    {focusNeighbors.length} 条强关联 · 45 天内共同出现
                  </p>
                </div>
                <button
                  onClick={() => setFocusId(null)}
                  className="ml-auto shrink-0 text-zinc-300 hover:text-zinc-600"
                  aria-label="取消聚焦"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto border-t border-zinc-100 pt-3">
                {focusNeighbors.length === 0 && (
                  <p className="text-[12px] text-zinc-400">还没有强到能画出来的关联。</p>
                )}
                {focusNeighbors.map(({ other, edge }) => (
                  <div key={other.id}>
                    <div className="flex items-baseline gap-2">
                      <button
                        onClick={() => setFocusId(other.id)}
                        className="text-left text-[12.5px] font-medium text-zinc-800 hover:text-[#007a8c]"
                      >
                        {other.name}
                      </button>
                      <span className="mono ml-auto shrink-0 text-[10.5px] text-zinc-400 tabular-nums">
                        重叠 {Math.round((edge.overlap ?? 0) * 100)}% · {edge.weight} 次
                      </span>
                    </div>
                    {(edge.evidence ?? []).map((ev) => (
                      <div key={ev.id} className="mt-1 text-[11px] leading-snug text-zinc-500">
                        <span className="mono text-zinc-400">{ev.date}</span> {ev.title}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <a
                href={`/entity/${focusEntity.id}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 shrink-0 text-[11.5px] text-[#007a8c] hover:underline"
              >
                完整档案（信息 · 公告 · 链条 · 原子）→
              </a>
            </div>
          )}

          {/* 未聚焦时的轻量悬停卡 */}
          {mode === "entities" && !focusEntity && hoverEntity && (
            <div className="panel absolute top-3 right-3 max-w-[280px] px-4 py-2.5 text-[12.5px]">
              <div>
                <span className="font-semibold">{hoverEntity.name}</span>
                <span className="ml-2 text-zinc-500">
                  {ENTITY_CN[hoverEntity.type] ?? hoverEntity.type} · 提及 {hoverEntity.weight} 次
                </span>
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">点一下看它和谁绑在一起</p>
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
                  边越粗＝重叠度越高（两者越"总在同一类事件里出现"）
                </span>
                <span className="text-zinc-400">
                  只画关联最强的 24 个实体 · 每个留最强 4 条边 · 重叠度 &lt;5% 不画
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
                : "点击聚焦 · 拖动固定 · 双击解除"}
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
