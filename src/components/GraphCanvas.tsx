"use client";

import { useEffect, useRef, useState } from "react";

type Node = { id: number; name: string; type: string; weight: number };
type Edge = { src_id: number; dst_id: number; weight: number };

const TYPE_COLOR: Record<string, string> = {
  macro: "#d92b3c",
  company: "#0071a8",
  person: "#b8720c",
  concept: "#0f6e56",
  region: "#71717a",
};

/** 轻量力导向：斥力 + 弹簧 + 中心引力，rAF 迭代至稳定 */
export default function GraphCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<Node | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((d) => {
        setData({ nodes: d.nodes ?? [], edges: d.edges ?? [] });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const simRef = useRef<{ pos: Map<number, { x: number; y: number; vx: number; vy: number }> } | null>(null);

  useEffect(() => {
    if (!data || !svgRef.current) return;
    const W = 680;
    const H = 560;
    // 初始：按类型分簇的环形布局
    const pos = new Map<number, { x: number; y: number; vx: number; vy: number }>();
    data.nodes.forEach((n, i) => {
      const a = (i / data.nodes.length) * Math.PI * 2;
      const r = 180 + (i % 3) * 30;
      pos.set(n.id, { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r * 0.8, vx: 0, vy: 0 });
    });
    simRef.current = { pos };

    let frame = 0;
    let alpha = 1;
    const tick = () => {
      if (alpha < 0.005 || frame > 600) return;
      const arr = [...pos.entries()];
      // 斥力
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i][1], b = arr[j][1];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random(); dy = Math.random(); d2 = 1; }
          const f = (2400 * alpha) / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f; b.vy += (dy / d) * f;
        }
      }
      // 弹簧
      for (const e of data.edges) {
        const a = pos.get(e.src_id), b = pos.get(e.dst_id);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - 110) * 0.02 * alpha) / 1;
        a.vx += (dx / d) * f * e.weight; a.vy += (dy / d) * f * e.weight;
        b.vx -= (dx / d) * f * e.weight; b.vy -= (dy / d) * f * e.weight;
      }
      // 中心引力 + 积分 + 阻尼
      for (const [, p] of pos) {
        p.vx += (W / 2 - p.x) * 0.003 * alpha;
        p.vy += (H / 2 - p.y) * 0.003 * alpha;
        p.x += Math.max(-12, Math.min(12, p.vx));
        p.y += Math.max(-12, Math.min(12, p.vy));
        p.vx *= 0.82; p.vy *= 0.82;
        p.x = Math.max(40, Math.min(W - 40, p.x));
        p.y = Math.max(30, Math.min(H - 30, p.y));
      }
      alpha *= 0.985;
      frame++;
      // 重绘
      const svg = svgRef.current;
      if (!svg) return;
      const edgeEls = svg.querySelectorAll<SVGLineElement>("line.edge");
      edgeEls.forEach((el) => {
        const a = pos.get(Number(el.dataset.src));
        const b = pos.get(Number(el.dataset.dst));
        if (a && b) { el.setAttribute("x1", String(a.x)); el.setAttribute("y1", String(a.y)); el.setAttribute("x2", String(b.x)); el.setAttribute("y2", String(b.y)); }
      });
      svg.querySelectorAll<SVGGElement>("g.gnode").forEach((g) => {
        const p = pos.get(Number(g.dataset.id));
        if (p) g.setAttribute("transform", `translate(${p.x},${p.y})`);
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [data]);

  if (loading)
    return (
      <div className="shimmer relative overflow-hidden rounded-2xl border border-zinc-200">
        <p className="text-[13.5px] text-zinc-400 py-16 text-center">加载图谱…</p>
      </div>
    );
  if (!data || data.nodes.length === 0)
    return (
      <div className="empty panel-in">
        <p className="text-[15px] font-medium">图谱还是空的</p>
        <p className="text-[13.5px] text-zinc-500 mt-2 max-w-[42ch] mx-auto leading-relaxed">
          跑几轮「采集信息」和「蒸馏认知原子」后，实体共现网络会在这里生长出来。
        </p>
      </div>
    );

  const maxW = Math.max(...data.edges.map((e) => e.weight), 1);

  return (
    <div className="relative">
      <div className="panel overflow-hidden panel-in">
        <svg
          ref={svgRef}
          viewBox="0 0 680 560"
          className="graph-shell w-full border-0"
        >
          {data.edges.map((e, i) => (
            <line
              key={i}
              className="edge"
              data-src={e.src_id}
              data-dst={e.dst_id}
              x1="0" y1="0" x2="0" y2="0"
              stroke="#c9c9cf"
              strokeWidth={0.5 + (e.weight / maxW) * 2}
              strokeOpacity={0.35 + (e.weight / maxW) * 0.4}
              style={{ animationDelay: `${Math.min(600, i * 12)}ms` }}
            />
          ))}
          {data.nodes.map((n, i) => (
            <g
              key={n.id}
              className="gnode"
              data-id={n.id}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(null)}
              style={{ animationDelay: `${Math.min(700, 120 + i * 14)}ms` }}
            >
              <circle r={6 + Math.min(10, Math.sqrt(n.weight) * 2.5)} fill={TYPE_COLOR[n.type] ?? "#71717a"} fillOpacity={0.85} stroke="#fff" strokeWidth={1} />
              <text y={-10} textAnchor="middle" fontSize={10.5} fill="#3f3f46" style={{ fontWeight: 500 }}>{n.name.slice(0, 8)}</text>
            </g>
          ))}
        </svg>
      </div>
      {hover && (
        <div className="absolute top-5 right-5 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl px-4 py-2.5 text-[12.5px] shadow-[0_10px_28px_-14px_rgba(10,10,11,0.35)] tooltip-in">
          <span className="font-semibold">{hover.name}</span>
          <span className="text-zinc-400 ml-2">{hover.type} ·共现 {hover.weight} 次</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 mt-4 text-[12px] text-zinc-500">
        {Object.entries({ macro: "宏观", company: "公司", person: "人物", concept: "概念", region: "地区" }).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLOR[k] }} />
            {v}
          </span>
        ))}
        <span className="ml-auto">节点大小 = 提及次数 · 边粗细 = 共现权重 · 近 30 天</span>
      </div>
    </div>
  );
}
