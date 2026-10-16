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

const ENTITY_COLOR: Record<string, string> = {
  macro: "#d92b3c",
  company: "#0071a8",
  person: "#b8720c",
  concept: "#0f6e56",
  region: "#71717a",
};

const ATOM_COLOR: Record<string, string> = {
  mechanism: "#0071a8",
  pattern: "#b8720c",
  fact: "#6b7280",
  counterexample: "#d92b3c",
  judgment: "#0f6e56",
  question: "#5348b7",
  norm: "#a3326b",
};

const ATOM_CN: Record<string, string> = {
  mechanism: "机制", pattern: "模式", fact: "硬事实",
  counterexample: "反例", judgment: "判断", question: "开放问题", norm: "潜规则",
};

const RELATION_COLOR: Record<string, string> = {
  supports: "#2E9E5B",
  contradicts: "#d92b3c",
  explains: "#0071a8",
  extends: "#b8720c",
  analogy: "#9ca3af",
};

const RELATION_CN: Record<string, string> = {
  supports: "支持", contradicts: "矛盾", explains: "解释",
  extends: "延伸", analogy: "类比",
};

/* ------------------------------------------------------------------ */
/* 力导向仿真 hook                                                     */
/* ------------------------------------------------------------------ */

type Pos = { x: number; y: number; vx: number; vy: number };

function useForceLayout(
  svgRef: React.RefObject<SVGSVGElement | null>,
  nodes: { id: number }[],
  edges: { src_id: number; dst_id: number; strength: number }[],
  active: boolean
) {
  const posRef = useRef<Map<number, Pos>>(new Map());

  useEffect(() => {
    if (!active || nodes.length === 0) return;
    const W = 680;
    const H = 560;
    const pos = posRef.current;
    pos.clear();
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2;
      const r = 170 + (i % 3) * 26;
      pos.set(n.id, {
        x: W / 2 + Math.cos(a) * r,
        y: H / 2 + Math.sin(a) * r * 0.82,
        vx: 0,
        vy: 0,
      });
    });

    let frame = 0;
    let alpha = 1;
    let raf = 0;
    const tick = () => {
      if (alpha < 0.006 || frame > 620) return;
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
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges, active]);
}

/* ------------------------------------------------------------------ */
/* 主组件：双层图谱                                                    */
/* ------------------------------------------------------------------ */

export default function GraphCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>("atoms");
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
  useForceLayout(svgRef, entityNodes, entityEdges, mode === "entities");

  /* ---- 原子层 ---- */
  const atomNodes = useMemo(() => atomData?.nodes ?? [], [atomData]);
  const atomEdges = useMemo(
    () => (atomData?.edges ?? []).map((e) => ({ src_id: e.src_id, dst_id: e.dst_id, strength: 1 })),
    [atomData]
  );
  useForceLayout(svgRef, atomNodes, atomEdges, mode === "atoms");

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

  const atomMap = useMemo(() => new Map(atomNodes.map((n) => [n.id, n])), [atomNodes]);
  const atomEdgesOf = (id: number) =>
    (atomData?.edges ?? []).filter((e) => e.src_id === id || e.dst_id === id);

  /* ---- 空态 ---- */
  const hasEntities = (entityData?.nodes.length ?? 0) > 0;
  const hasAtoms = (atomData?.edges.length ?? 0) > 0;
  const showEmpty = mode === "atoms" ? !hasAtoms : !hasEntities;

  return (
    <div>
      {/* 层切换 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setMode("atoms")}
          className={`pill magnetic ${mode === "atoms" ? "pill-active" : ""}`}
        >
          原子关系网
          <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">
            {atomData?.nodes.length ?? 0}
          </span>
        </button>
        <button
          onClick={() => setMode("entities")}
          className={`pill magnetic ${mode === "entities" ? "pill-active" : ""}`}
        >
          实体共现
          <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">
            {entityData?.nodes.length ?? 0}
          </span>
        </button>
        <span className="ml-auto text-[12px] text-zinc-400">
          {mode === "atoms"
            ? "节点=认知原子 · 边=五种关系（支持/矛盾/解释/延伸/类比）"
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
            viewBox="0 0 680 560"
            className="w-full rounded-2xl border border-zinc-200 bg-[#fcfcfd]"
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
                    stroke="#c9c9cf"
                    strokeWidth={0.5 + (e.weight / maxW) * 2}
                    strokeOpacity={0.35 + (e.weight / maxW) * 0.4}
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
                  stroke={RELATION_COLOR[e.relation] ?? "#9ca3af"}
                  strokeWidth={1.2}
                  strokeOpacity={0.55}
                  strokeDasharray={e.relation === "contradicts" ? "5 3" : undefined}
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
                  style={{ cursor: "default" }}
                >
                  <circle
                    r={6 + Math.min(10, Math.sqrt(n.weight) * 2.5)}
                    fill={ENTITY_COLOR[n.type] ?? "#71717a"}
                    fillOpacity={0.85}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                  <text y={-10} textAnchor="middle" fontSize={10.5} fill="#3f3f46" fontWeight={500}>
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
                  onClick={() => setSelectedAtom(selectedAtom?.id === n.id ? null : n)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r={8 + n.confidence * 10}
                    fill={ATOM_COLOR[n.type] ?? "#6b7280"}
                    fillOpacity={selectedAtom?.id === n.id ? 1 : 0.82}
                    stroke={selectedAtom?.id === n.id ? "#18181b" : "#fff"}
                    strokeWidth={selectedAtom?.id === n.id ? 2.5 : 1}
                  />
                  <text y={-13} textAnchor="middle" fontSize={10} fill="#3f3f46" fontWeight={500}>
                    {ATOM_CN[n.type] ?? n.type}
                  </text>
                </g>
              ))}
          </svg>

          {/* 实体悬停卡 */}
          {mode === "entities" && hoverEntity && (
            <div className="absolute top-3 right-3 max-w-[260px] rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-[12.5px] shadow-sm">
              <span className="font-semibold">{hoverEntity.name}</span>
              <span className="ml-2 text-zinc-400">
                {hoverEntity.type} · 提及 {hoverEntity.weight} 次
              </span>
            </div>
          )}

          {/* 原子点击详情 */}
          {mode === "atoms" && selectedAtom && (
            <div className="absolute top-3 right-3 w-[300px] rounded-2xl border border-zinc-200 bg-white p-5 shadow-lg">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: ATOM_COLOR[selectedAtom.type] }}
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
                            background: `${RELATION_COLOR[e.relation]}18`,
                            color: RELATION_COLOR[e.relation],
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

          {/* 图例 */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-[12px] text-zinc-500">
            {mode === "entities" ? (
              <>
                {Object.entries({ macro: "宏观", company: "公司", person: "人物", concept: "概念", region: "地区" }).map(
                  ([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: ENTITY_COLOR[k] }} />
                      {v}
                    </span>
                  )
                )}
              </>
            ) : (
              <>
                {Object.entries(ATOM_CN).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: ATOM_COLOR[k] }} />
                    {v}
                  </span>
                ))}
                <span className="ml-auto inline-flex items-center gap-2">
                  <svg width="26" height="6">
                    <line x1="0" y1="3" x2="26" y2="3" stroke="#2E9E5B" strokeWidth={1.5} />
                  </svg>
                  支持
                  <svg width="26" height="6">
                    <line x1="0" y1="3" x2="26" y2="3" stroke="#d92b3c" strokeWidth={1.5} strokeDasharray="5 3" />
                  </svg>
                  矛盾
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
