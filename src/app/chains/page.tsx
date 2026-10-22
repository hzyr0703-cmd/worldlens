import { getDb } from "@/lib/db";
import PageHead from "@/components/PageHead";

export const dynamic = "force-dynamic";

type Chain = {
  id: number;
  title: string;
  thesis: string;
  status: string;
  domain: string;
  confidence: number;
  stepCount: number;
  lastStep: string;
  updated_at: string;
  current_view?: string;
  next_watch?: string;
};

type Step = {
  id: number;
  seq: number;
  role: string;
  claim: string;
  item_ids: string;
  verify_by: string;
  verified: number;
};

const ROLE_META: Record<string, { cn: string; cls: string; dot: string }> = {
  trigger: { cn: "触发", cls: "tier-0", dot: "#d92b3c" },
  mechanism: { cn: "机制", cls: "tier-2", dot: "#0071a8" },
  effect: { cn: "现象", cls: "tier-1", dot: "#b8720c" },
  verify: { cn: "待验证", cls: "tier-2", dot: "#0f6e56" },
};

const STATUS_META: Record<string, { cn: string; cls: string }> = {
  active: { cn: "演进中", cls: "tier-2" },
  resolved: { cn: "已验证", cls: "tier-1" },
  broken: { cn: "已断裂", cls: "tier-0" },
};

export default async function ChainsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; status?: string }>;
}) {
  const { id, status } = await searchParams;
  const statusFilter = ["active", "broken", "resolved"].includes(status ?? "") ? status! : "";
  const db = getDb();

  const chains = db
    .prepare(
      `SELECT c.id, c.title, c.thesis, c.status, c.domain, c.confidence, c.updated_at,
              (SELECT COUNT(*) FROM chain_steps s WHERE s.chain_id = c.id) AS stepCount,
              (SELECT s.claim FROM chain_steps s WHERE s.chain_id = c.id ORDER BY s.seq DESC LIMIT 1) AS lastStep,
              c.current_view, c.next_watch
       FROM chains c WHERE c.status != 'archived' ${statusFilter ? "AND c.status = ?" : ""}
       ORDER BY (c.status = 'broken') DESC, c.updated_at DESC LIMIT 40`
    )
    .all(...(statusFilter ? [statusFilter] : [])) as unknown as Chain[];

  const statusCounts = db
    .prepare(
      `SELECT status, COUNT(*) c FROM chains WHERE status != 'archived' GROUP BY status`
    )
    .all() as unknown as { status: string; c: number }[];
  const countOf = (s: string) => statusCounts.find((x) => x.status === s)?.c ?? 0;
  const totalChains = statusCounts.reduce((s, x) => s + x.c, 0);

  const detailId = Number(id ?? "0");
  const detail = chains.find((c) => c.id === detailId);
  const steps: Step[] = detail
    ? (db.prepare(`SELECT id, seq, role, claim, item_ids, verify_by, verified FROM chain_steps WHERE chain_id = ? ORDER BY seq`).all(detail.id) as unknown as Step[])
    : [];

  return (
    <div>
      <PageHead
        index="09"
        kicker="Knowledge chains"
        title="知识链条"
        desc="信息是点，知识是链。每一环都挂到真实新闻上——可以顺着链条重新理解一件事是怎么走到今天的。"
        aside={<span className="pill">{chains.length} 条链</span>}
      />

        {/* 状态筛选 */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {[
            { v: "", l: "全部", n: totalChains },
            { v: "active", l: "演进中", n: countOf("active") },
            { v: "broken", l: "已断裂", n: countOf("broken") },
            { v: "resolved", l: "已验证", n: countOf("resolved") },
          ].map((f) => {
            const qs = new URLSearchParams({ ...(f.v ? { status: f.v } : {}), ...(id ? { id } : {}) });
            const on = statusFilter === f.v;
            return (
              <a key={f.l} href={`/chains?${qs}`} className={`pill magnetic ${on ? "pill-active" : ""}`}>
                {f.l}
                <span className="mono ml-1 text-[11px] text-zinc-400 tabular-nums">{f.n}</span>
              </a>
            );
          })}
          <span className="ml-auto text-[12px] text-zinc-400">
            每条链的每一环都能点开看原始新闻
          </span>
        </div>

      <div className="page-body">
        {chains.length === 0 ? (
          <div className="empty">
            <p className="text-[15px] font-medium">还没有链条</p>
            <p className="mx-auto mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-zinc-500">
              引擎每天会把当日信息炼成链条环节（至少触发 + 机制两环才成链）。也可以在上方点「生成今日简报」触发一轮。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 链条列表 */}
            <div className={detail ? "lg:col-span-5" : "lg:col-span-12"}>
              <div className={detail ? "space-y-3" : "stagger grid grid-cols-1 md:grid-cols-2 gap-4"}>
                {chains.map((c) => {
                  const st = STATUS_META[c.status] ?? STATUS_META.active;
                  return (
                    <a
                      key={c.id}
                      href={`/chains?id=${c.id}`}
                      className={`panel card-in block p-5 ${detail?.id === c.id ? "ring-2 ring-[#00b8d4]/50" : ""}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`tag ${st.cls}`}>{st.cn}</span>
                        <span className="mono text-[10.5px] text-zinc-400">{c.domain}</span>
                        <span className="mono ml-auto text-[10.5px] text-zinc-400 tabular-nums">{c.stepCount} 环</span>
                      </div>
                      <div className="mt-2.5 text-[14.5px] font-semibold leading-snug text-zinc-900">{c.title}</div>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500 line-clamp-2">
                        {c.current_view || c.thesis}
                      </p>
                      {c.lastStep && (
                        <p className="mt-2.5 truncate text-[11.5px] text-zinc-400 mono">最新：{c.lastStep}</p>
                      )}
                    </a>
                  );
                })}
              </div>
            </div>

            {/* 链条详情：时间轴 */}
            {detail && (
              <div className="lg:col-span-7">
                <div className="panel p-6 sm:p-8">
                  <div className="flex items-center gap-2">
                    <span className={`tag ${(STATUS_META[detail.status] ?? STATUS_META.active).cls}`}>
                      {(STATUS_META[detail.status] ?? STATUS_META.active).cn}
                    </span>
                    <span className="mono text-[11px] text-zinc-400">{detail.domain} · {detail.stepCount} 环</span>
                    <a href="/chains" className="ml-auto text-[12px] text-zinc-400 hover:text-zinc-700">← 全部</a>
                  </div>
                  <h2 className="mt-3 text-[19px] font-semibold tracking-[-0.015em] leading-snug">{detail.title}</h2>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-600">{detail.thesis}</p>

                  {(detail.current_view || detail.next_watch) && (
                    <div className="mt-4 space-y-2.5 rounded-xl bg-[#f7fafb] border border-[#e2edf0] p-4">
                      {detail.current_view && (
                        <div>
                          <span className="text-[10.5px] font-bold tracking-wider text-[#007a8c]">现在</span>
                          <p className="mt-1 text-[13px] leading-relaxed text-zinc-700">{detail.current_view}</p>
                        </div>
                      )}
                      {detail.next_watch && (
                        <div>
                          <span className="text-[10.5px] font-bold tracking-wider text-[#b8720c]">接下来看</span>
                          <p className="mt-1 text-[13px] leading-relaxed text-zinc-700">{detail.next_watch}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-6 space-y-0">
                    {steps.map((s, i) => {
                      const rm = ROLE_META[s.role] ?? ROLE_META.effect;
                      const ids = (() => {
                        try { return JSON.parse(s.item_ids) as number[]; } catch { return []; }
                      })();
                      const items = ids.length
                        ? (db.prepare(`SELECT id, title, link FROM items WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as unknown as { id: number; title: string; link: string }[])
                        : [];
                      return (
                        <div key={s.id} className="relative flex gap-4 pb-7 last:pb-0">
                          {/* 时间轴 */}
                          <div className="flex flex-col items-center">
                            <span className="mt-1 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: rm.dot }} />
                            {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-zinc-200" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="mono text-[10.5px] text-zinc-400 tabular-nums">#{s.seq}</span>
                              <span className={`tag ${rm.cls} !text-[10px] !py-0.5`}>{rm.cn}</span>
                              {s.verify_by && <span className="mono text-[10.5px] text-zinc-400">验证期 {s.verify_by}</span>}
                            </div>
                            <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-800">{s.claim}</p>
                            {items.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {items.map((it) => (
                                  <a
                                    key={it.id}
                                    href={it.link || "#"}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block truncate text-[11.5px] text-zinc-400 hover:text-[#007a8c] hover:underline"
                                    title={it.title}
                                  >
                                    · {it.title}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
