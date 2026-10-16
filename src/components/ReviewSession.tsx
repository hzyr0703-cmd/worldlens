"use client";

import { useCallback, useEffect, useState } from "react";
import { wlFetch } from "@/lib/client/fetch";

type FeedItem = { id: number; title: string; link: string; source: string };

type Card = {
  id: number;
  question: string;
  answer: string;
  variant?: string;
  nuggetStatus?: string;
  reps?: number;
  kind?: string;
};

const RATING = [
  { v: 1, label: "想不起来", cls: "bg-[#fceef0] text-[#b4232f] border border-[#f6d5d9] hover:bg-[#f8dfe3]" },
  { v: 2, label: "费劲", cls: "bg-[#fdf6e8] text-[#8a5a08] border border-[#f6e8c9] hover:bg-[#fbefd9]" },
  { v: 3, label: "想起来", cls: "bg-[#eef9fb] text-[#006b7d] border border-[#cfedf3] hover:bg-[#e0f4f8]" },
  { v: 4, label: "轻松", cls: "bg-[#ecfaf3] text-[#046c4e] border border-[#cdeede] hover:bg-[#ddf6ea]" },
] as const;

type Stats = { today: number; total: number; streak: number };

type ReviewData = { cards: Card[]; stats: Stats | null };

/**
 * 只取数据、不碰 state 的取数函数。
 * 拆出来的原因：让挂载 effect 里能直接把 setState 放进 .then 回调，
 * 避免在 effect 体内同步调用会改 state 的函数（react-hooks/set-state-in-effect）。
 * 同时天然支持组件卸载后丢弃过期响应。
 */
async function fetchReview(): Promise<ReviewData> {
  const res = await fetch("/api/review");
  const data = await res.json();
  return { cards: data.cards ?? [], stats: data.stats ?? null };
}

export default function ReviewSession() {
  const [cards, setCards] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [recentItems, setRecentItems] = useState<FeedItem[]>([]);
  const [evidenceId, setEvidenceId] = useState<number | 0>(0);

  /** 把取回来的数据写进 state。挂载和作答后共用，避免逻辑分叉。 */
  const applyReview = useCallback((d: ReviewData) => {
    setCards(d.cards);
    setStats(d.stats);
    setLoading(false);
    if (d.cards.length === 0) setDone(true);
  }, []);

  // 刷新用（评分/结算后重新拉取到期卡片）
  const load = useCallback(async () => {
    applyReview(await fetchReview());
  }, [applyReview]);

  useEffect(() => {
    let alive = true;
    fetchReview().then((d) => {
      if (alive) applyReview(d);
    });
    fetch("/api/items")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setRecentItems(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [applyReview]);

  async function grade(rating: 1 | 2 | 3 | 4) {
    const card = cards[idx];
    if (!card) return;
    setError("");
    try {
      const res = await wlFetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: card.id, rating }),
      });
      // 401（无 cookie 且 prompt 被取消）或其它失败：停在当前卡，不丢用户的评分
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `评分失败（HTTP ${res.status}）`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setShowAnswer(false);
    if (idx + 1 >= cards.length) {
      await load();
      setDone(true);
    } else {
      setIdx((i) => i + 1);
    }
  }

  async function settle(outcome: "confirmed" | "refuted" | "unverifiable") {
    const card = cards[idx];
    if (!card) return;
    setError("");
    try {
      const res = await wlFetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", cardId: card.id, outcome, note, evidenceItemId: evidenceId || undefined }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setNote("");
      if (idx + 1 >= cards.length) {
        await load();
        setDone(true);
      } else {
        setIdx((i) => i + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading)
    return (
      <div className="shimmer relative overflow-hidden rounded-2xl">
        <p className="text-[13.5px] text-zinc-400 py-10 text-center">加载中…</p>
      </div>
    );

  if (done || idx >= cards.length)
    return (
      <div className="panel p-12 text-center panel-in">
        <p className="text-[19px] font-semibold tracking-[-0.018em]">今日复习完成</p>
        {stats && stats.today > 0 && (
          <p className="text-[14px] text-[#007a8c] mt-3 font-medium">
            今天已复习 {stats.today} 张 · 累计 {stats.total} 次 · 连续 {stats.streak} 天
          </p>
        )}
        <p className="text-[14px] text-zinc-500 mt-3 max-w-[40ch] mx-auto leading-relaxed">
          回忆是磨损的过程，也是拥有的过程。下一次到期卡片由 FSRS 调度。
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <a href="/inbox" className="btn-solid magnetic">读一篇新文章 →</a>
        </div>
      </div>
    );

  const card = cards[idx];
  // 变式提问：第二次及以后复习换角度问，防止背题不背知识
  const asked = card.reps && card.reps > 0 && card.variant?.trim() ? card.variant : card.question;
  const isVerify = card.kind === "verify";

  if (isVerify) {
    return (
      <div className="max-w-[680px] mx-auto">
        <ProgressRail cards={cards} idx={idx} />

        <div className="panel p-7 sm:p-10 card-swap" key={`v-${card.id}`}>
          <div className="sec-index mono">预测对账 · 到期结算</div>
          <h2 className="ask mt-4">{card.question}</h2>

          <div className="reveal-answer bg-[#fdf8ef] border border-[#f0e0c0] rounded-2xl p-5 mt-6 text-left">
            <div className="text-[11px] tracking-[0.14em] uppercase text-[#8a5a08] font-medium mb-2">验证条件</div>
            <p className="text-[14px] text-zinc-700 leading-relaxed whitespace-pre-wrap">{card.answer}</p>
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="现实中发生了什么？（可留空，凭你的观察结算）"
            className="field mt-5 resize-y !text-[13.5px]"
          />

          {recentItems.length > 0 && (
            <div className="mt-3 text-left">
              <label className="text-[12px] text-zinc-400">引用一条快讯作证据（可选，会写进世界观日志）：</label>
              <select
                value={evidenceId}
                onChange={(e) => setEvidenceId(Number(e.target.value))}
                className="field mt-1.5 !py-2 !text-[12.5px]"
              >
                <option value={0}>不引用</option>
                {recentItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    [{it.source}] {it.title.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="text-[13px] text-zinc-400 mt-5 mb-4">对照验证条件，诚实结算——结算直接改写这条判断的置信度</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 stagger-buttons">
            <button onClick={() => settle("confirmed")} className="text-[13.5px] font-medium py-3 rounded-xl bg-[#ecfaf3] text-[#046c4e] border border-[#cdeede] hover:bg-[#ddf6ea] transition-colors cursor-pointer magnetic">
              验证通过 ↑
            </button>
            <button onClick={() => settle("refuted")} className="text-[13.5px] font-medium py-3 rounded-xl bg-[#fceef0] text-[#b4232f] border border-[#f6d5d9] hover:bg-[#f8dfe3] transition-colors cursor-pointer magnetic">
              被现实证伪 ↓
            </button>
            <button onClick={() => settle("unverifiable")} className="text-[13.5px] font-medium py-3 rounded-xl bg-[#f2f2f4] text-zinc-600 border border-zinc-200 hover:bg-zinc-100 transition-colors cursor-pointer magnetic">
              还没法验证（顺延）
            </button>
          </div>
          {error && <p className="text-[12px] text-red-600 mt-3">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[680px] mx-auto">
      <ProgressRail cards={cards} idx={idx} />

      {/* key={card.id}：换卡时整块重新入场，这是作答流程最重要的转场 */}
      <div className="panel p-7 sm:p-10 text-center card-swap" key={`q-${card.id}`}>
        <div className="sec-index mono">
          {idx + 1} / {cards.length} · FSRS 调度
        </div>
        {card.nuggetStatus === "challenged" && (
          <div className="mt-4 inline-block bg-[#fceef0] border border-[#f6d5d9] text-[#b4232f] text-[12.5px] rounded-full px-4 py-1.5">
            此判断已被新证据挑战 — 回忆时想想两面
          </div>
        )}
        <h2 className="ask mt-5">{asked}</h2>

        {!showAnswer ? (
          <div className="mt-9">
            <p className="text-[13.5px] text-zinc-400 mb-6">
              先在脑中组织答案——尽力回忆，然后翻面对照。
            </p>
            <button onClick={() => setShowAnswer(true)} className="btn-solid magnetic">
              显示答案
            </button>
          </div>
        ) : (
          <div className="mt-8 reveal-answer">
            <div className="bg-[#fbfbfc] border border-zinc-200 rounded-2xl p-6 text-left">
              <p className="text-[15px] text-zinc-800 leading-[1.8] whitespace-pre-wrap">{card.answer}</p>
            </div>
            <p className="text-[13px] text-zinc-400 mt-7 mb-4">对照后诚实评分——评分决定下次出现时机</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 stagger-buttons">
              {RATING.map((r) => (
                <button
                  key={r.v}
                  onClick={() => grade(r.v)}
                  className={`text-[13px] font-medium py-3 rounded-xl transition-colors duration-150 cursor-pointer magnetic ${r.cls}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 顶部进度条：已完成实心 / 当前半透 / 未到灰 */
function ProgressRail({ cards, idx }: { cards: Card[]; idx: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-5">
      {cards.map((c, i) => (
        <span
          key={c.id}
          className={`h-1 flex-1 rounded-full transition-all duration-500 ${
            i < idx
              ? "bg-[#00b8d4]"
              : i === idx
                ? "bg-[#00b8d4]/45 scale-y-[1.6]"
                : "bg-zinc-200"
          }`}
        />
      ))}
    </div>
  );
}
