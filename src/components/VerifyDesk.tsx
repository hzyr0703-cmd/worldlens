"use client";

import { useCallback, useEffect, useState } from "react";
import { wlFetch } from "@/lib/client/fetch";

type Evidence = { id: number; title: string; link: string; date: string; source: string };

type Card = {
  id: number;
  question: string;
  answer: string;
  due: string;
  chain: { id: number; title: string; status: string } | null;
  evidence: Evidence[];
};

type Settled = { id: number; statement: string; outcome: "confirmed" | "refuted"; detail: string; date: string };

type Upcoming = { id: number; question: string; due: string };

type Data = { cards: Card[]; nextDue: string | null; settled: Settled[]; upcoming: Upcoming[] };

const OUTCOMES = [
  { v: "confirmed" as const, label: "证实", cls: "bg-[#ecfaf3] text-[#046c4e] border border-[#cdeede] hover:bg-[#ddf6ea]" },
  { v: "refuted" as const, label: "证伪", cls: "bg-[#fceef0] text-[#b4232f] border border-[#f6d5d9] hover:bg-[#f8dfe3]" },
  { v: "unverifiable" as const, label: "证据不足", cls: "bg-zinc-50 text-zinc-600 border border-zinc-200 hover:bg-zinc-100" },
];

const CHAIN_STATUS: Record<string, { cn: string; cls: string }> = {
  active: { cn: "演进中", cls: "tier-2" },
  broken: { cn: "已断裂", cls: "tier-0" },
  resolved: { cn: "已验证", cls: "tier-1" },
};

const OUTCOME_CN: Record<string, string> = { confirmed: "证实", refuted: "证伪", unverifiable: "证据不足" };

function fmtDate(s: string): string {
  if (!s) return "";
  return s.slice(0, 10);
}

/** 逾期天数：老验证点被拖了几个月时，如实标出来，而不是假装还有效 */
function overdueDays(due: string): number {
  const d = new Date(due.slice(0, 10)).getTime();
  if (Number.isNaN(d)) return 0;
  return Math.floor((Date.now() - d) / 86400000);
}

async function fetchDesk(): Promise<Data> {
  const res = await fetch("/api/review");
  const d = await res.json();
  return { cards: d.cards ?? [], nextDue: d.nextDue ?? null, settled: d.settled ?? [], upcoming: d.upcoming ?? [] };
}

/**
 * 对账台 —— 替代原来的「复习」闪卡。
 *
 * 分工：引擎负责找证据（同实体近期信息），人负责下判断。
 * 结算直接回写链条状态：证实 → resolved，证伪 → broken。
 */
export default function VerifyDesk() {
  const [data, setData] = useState<Data>({ cards: [], nextDue: null, settled: [], upcoming: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    const d = await fetchDesk();
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchDesk().then((d) => {
      if (alive) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  async function settle(card: Card, outcome: "confirmed" | "refuted" | "unverifiable") {
    setBusy(card.id);
    setError("");
    try {
      const res = await wlFetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", cardId: card.id, outcome }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `结算失败（HTTP ${res.status}）`);
      setFlash(`已结算：${OUTCOME_CN[outcome]}${card.chain ? ` · 链条「${card.chain.title}」已更新` : ""}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="panel animate-pulse p-6">
            <div className="h-3 w-24 rounded bg-zinc-100" />
            <div className="mt-3 h-4 w-[70%] rounded bg-zinc-200" />
            <div className="mt-2 h-3 w-[45%] rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* 统计条 */}
      <div className="mb-6 flex flex-wrap items-center gap-3 text-[12.5px] text-zinc-500">
        <span className="pill pill-active !text-[12px]">到期 {data.cards.length} 张</span>
        {data.nextDue && <span>下一条验证点 {fmtDate(data.nextDue)}</span>}
        <span className="ml-auto text-[12px] text-zinc-400">
          引擎负责找证据 · 你只负责下判断
        </span>
      </div>

      {flash && (
        <div className="mb-4 rounded-xl border border-[#cdeede] bg-[#ecfaf3] px-4 py-2.5 text-[12.5px] text-[#046c4e]">
          {flash}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-[#f6d5d9] bg-[#fceef0] px-4 py-2.5 text-[12.5px] text-[#b4232f]">
          {error}
        </div>
      )}

      {data.cards.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-[15px] font-medium">当前没有到期的验证点</p>
          <p className="mt-2 text-[13px] text-zinc-500">
            {data.nextDue
              ? `下一条验证点将在 ${fmtDate(data.nextDue)} 到期——到那天再回来看它成立没有。`
              : "链条会随着新信息继续长出验证点。"}
          </p>
          <a href="/chains" className="pill mt-5 inline-block">
            去看链条现在演到哪了 →
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {data.cards.map((card) => {
            const st = card.chain ? (CHAIN_STATUS[card.chain.status] ?? CHAIN_STATUS.active) : null;
            return (
              <div key={card.id} className="panel p-6 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-[10.5px] uppercase tracking-[0.16em] text-zinc-400">
                    到期 {fmtDate(card.due)}
                  </span>
                  {overdueDays(card.due) > 7 && (
                    <span className="tag tier-0 !text-[10px] !py-0.5">已逾期 {overdueDays(card.due)} 天</span>
                  )}
                  {card.chain && (
                    <>
                      <a
                        href={`/chains?id=${card.chain.id}`}
                        className="text-[11.5px] text-[#007a8c] hover:underline"
                      >
                        #{card.chain.id} {card.chain.title}
                      </a>
                      {st && <span className={`tag ${st.cls} !text-[10px] !py-0.5`}>{st.cn}</span>}
                    </>
                  )}
                </div>

                <p className="mt-3 text-[16px] font-semibold leading-relaxed tracking-[-0.01em] text-zinc-900">
                  {card.question}
                </p>

                {card.answer && (
                  <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{card.answer}</p>
                )}

                {/* 证据：引擎预先找好的同实体近期信息 */}
                <div className="mt-4 rounded-xl border border-[#e2edf0] bg-[#f7fafb] p-4">
                  <div className="mono text-[10.5px] uppercase tracking-[0.16em] text-[#007a8c]">
                    现在能看到 · {card.evidence.length} 条
                  </div>
                  {card.evidence.length === 0 ? (
                    <p className="mt-1.5 text-[12.5px] text-zinc-500">
                      没找到直接相关的新信息——这种情况下「证据不足」也是诚实的答案。
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {card.evidence.map((e) => (
                        <li key={e.id} className="flex items-baseline gap-2 text-[12.5px]">
                          <span className="mono shrink-0 text-[10.5px] text-zinc-400">{fmtDate(e.date)}</span>
                          <a
                            href={e.link || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-zinc-700 hover:text-[#007a8c] hover:underline"
                            title={e.title}
                          >
                            {e.title}
                          </a>
                          <span className="shrink-0 text-[10.5px] text-zinc-400">{e.source}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.v}
                      onClick={() => settle(card, o.v)}
                      disabled={busy === card.id}
                      className={`rounded-full px-4 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${o.cls}`}
                    >
                      {busy === card.id ? "结算中…" : o.label}
                    </button>
                  ))}
                  {card.chain && (
                    <a href={`/chains?id=${card.chain.id}`} className="ml-auto text-[12px] text-zinc-400 hover:text-zinc-700">
                      看这条链的完整推演 →
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 即将到期：让台面空了也知道接下来要验证什么 */}
      {data.upcoming.length > 0 && (
        <div className="mt-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="sec-index mono">01</span>
            <span className="h-px w-8 bg-zinc-300" />
            <span className="sec-index mono uppercase tracking-[0.16em]">Upcoming · 即将到期</span>
            <span className="text-[12px] text-zinc-400 ml-2">到那天再回来看它成立没有</span>
          </div>
          <div className="panel divide-y divide-zinc-100">
            {data.upcoming.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3 text-[12.5px]">
                <span className="mono shrink-0 text-[10.5px] text-zinc-400">{fmtDate(u.due)}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-700" title={u.question}>
                  {u.question}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 台账：已经下过的判断 */}
      {data.settled.length > 0 && (
        <div className="mt-12">
          <div className="mb-3 flex items-center gap-3">
            <span className="sec-index mono">02</span>
            <span className="h-px w-8 bg-zinc-300" />
            <span className="sec-index mono uppercase tracking-[0.16em]">Settled · 已结算</span>
          </div>
          <div className="panel divide-y divide-zinc-100">
            {data.settled.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3 text-[12.5px]">
                <span
                  className={`tag shrink-0 !text-[10px] !py-0.5 ${s.outcome === "refuted" ? "tier-0" : "tier-2"}`}
                >
                  {OUTCOME_CN[s.outcome] ?? s.outcome}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-700" title={s.statement}>
                  {s.statement}
                </span>
                <span className="mono shrink-0 text-[10.5px] text-zinc-400">{fmtDate(s.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
