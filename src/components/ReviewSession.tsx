"use client";

import { useCallback, useEffect, useState } from "react";

type Card = {
  id: number;
  question: string;
  answer: string;
  variant?: string;
  nuggetStatus?: string;
  reps?: number;
};

const RATING = [
  { v: 1, label: "想不起来", cls: "bg-[#fceef0] text-[#b4232f] border border-[#f6d5d9] hover:bg-[#f8dfe3]" },
  { v: 2, label: "费劲", cls: "bg-[#fdf6e8] text-[#8a5a08] border border-[#f6e8c9] hover:bg-[#fbefd9]" },
  { v: 3, label: "想起来", cls: "bg-[#eef9fb] text-[#006b7d] border border-[#cfedf3] hover:bg-[#e0f4f8]" },
  { v: 4, label: "轻松", cls: "bg-[#ecfaf3] text-[#046c4e] border border-[#cdeede] hover:bg-[#ddf6ea]" },
] as const;

type Stats = { today: number; total: number; streak: number };

export default function ReviewSession() {
  const [cards, setCards] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/review");
    const data = await res.json();
    setCards(data.cards ?? []);
    setStats(data.stats ?? null);
    setLoading(false);
    if ((data.cards ?? []).length === 0) setDone(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function grade(rating: 1 | 2 | 3 | 4) {
    const card = cards[idx];
    if (!card) return;
    await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, rating }),
    });
    setShowAnswer(false);
    if (idx + 1 >= cards.length) {
      await load();
      setDone(true);
    } else {
      setIdx((i) => i + 1);
    }
  }

  if (loading) return <p className="text-[13.5px] text-zinc-400 py-10 text-center">加载中…</p>;

  if (done || idx >= cards.length)
    return (
      <div className="panel p-12 text-center">
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
          <a href="/inbox" className="btn-solid">读一篇新文章 →</a>
        </div>
      </div>
    );

  const card = cards[idx];
  // 变式提问：第二次及以后复习换角度问，防止背题不背知识
  const asked = card.reps && card.reps > 0 && card.variant?.trim() ? card.variant : card.question;
  return (
    <div className="max-w-[680px] mx-auto">
      <div className="flex items-center gap-1.5 mb-5">
        {cards.map((c, i) => (
          <span
            key={c.id}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < idx ? "bg-[#00b8d4]" : i === idx ? "bg-[#00b8d4]/40" : "bg-zinc-200"
            }`}
          />
        ))}
      </div>

      <div className="panel p-7 sm:p-10 text-center">
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
            <button onClick={() => setShowAnswer(true)} className="btn-solid">
              显示答案
            </button>
          </div>
        ) : (
          <div className="mt-8">
            <div className="bg-[#fbfbfc] border border-zinc-200 rounded-2xl p-6 text-left">
              <p className="text-[15px] text-zinc-800 leading-[1.8] whitespace-pre-wrap">{card.answer}</p>
            </div>
            <p className="text-[13px] text-zinc-400 mt-7 mb-4">对照后诚实评分——评分决定下次出现时机</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {RATING.map((r) => (
                <button
                  key={r.v}
                  onClick={() => grade(r.v)}
                  className={`text-[13px] font-medium py-3 rounded-xl transition-colors duration-150 cursor-pointer ${r.cls}`}
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
