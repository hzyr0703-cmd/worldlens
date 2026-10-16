"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

type Quiz = {
  id: number;
  q_order: number;
  question: string;
  user_answer: string;
  ai_verdict: string;
  state: string;
};

const RATING = [
  { v: 1, label: "想不起来", cls: "bg-[#ff4d5e]" },
  { v: 2, label: "费劲", cls: "bg-[#ffb340] text-black" },
  { v: 3, label: "想起来", cls: "bg-[#00f0ff] text-black" },
  { v: 4, label: "轻松", cls: "bg-[#12b981] text-white" },
] as const;

export function QuizRunner({ articleId, quizzes }: { articleId: number; quizzes: Quiz[] }) {
  const router = useRouter();
  const [idx, setIdx] = useState(() => {
    const firstPending = quizzes.findIndex((q) => q.state === "pending");
    return firstPending === -1 ? quizzes.length : firstPending;
  });
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [digested, setDigested] = useState<{ nuggets: number; cards: number; skipped: number } | null>(null);
  const [error, setError] = useState("");

  const done = idx >= quizzes.length;
  const current = quizzes[idx];

  async function submit() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const res = await wlFetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", quizId: current.id, answer }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setVerdict(data.verdict);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setVerdict(null);
    setAnswer("");
    setIdx((i) => i + 1);
  }

  async function digest() {
    setBusy(true);
    setError("");
    try {
      const res = await wlFetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "digest", articleId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setDigested(data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (digested) {
    return (
      <div className="panel p-10 text-center panel-in">
        <p className="text-[17px] font-semibold tracking-[-0.015em]">本次精读沉淀完成</p>
        <p className="text-[14px] text-zinc-500 mt-3 leading-relaxed">
          {digested.nuggets} 个认知原子已入库（带着你的原话与修正差异）· {digested.cards} 张复习卡片已进入 FSRS 队列{digested.skipped > 0 ? ` · ${digested.skipped} 条判定为日常信息未沉淀` : ""}
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-7">
          <a href="/review" className="btn-solid magnetic">
            开始第一次复习 →
          </a>
          <a href="/inbox" className="ghost magnetic">下一篇</a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel p-10 text-center panel-in">
        <p className="text-[17px] font-semibold tracking-[-0.015em]">全部题目已作答</p>
        <p className="text-[13.5px] text-zinc-500 mt-2.5">现在把你的表述沉淀成认知原子，进入复习队列。</p>
        <div className="mt-7">
          <button onClick={digest} disabled={busy} className="btn-solid magnetic">
            {busy ? "沉淀中…" : "沉淀为本章认知原子"}
          </button>
        </div>
        {error && <p className="text-[12px] text-red-600 mt-3">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        {quizzes.map((q, i) => (
          <span
            key={q.id}
            className={`h-1 flex-1 rounded-full transition-all duration-500 ${
              q.state === "answered"
                ? "bg-[#007a8c]"
                : i === idx
                  ? "bg-[#00b8d4] scale-y-[1.6]"
                  : "bg-zinc-200"
            }`}
          />
        ))}
      </div>
      {/* key={current.id}：换题时整卡推入，和复习页同一套转场 */}
      <div className="panel p-7 sm:p-8 card-swap" key={current.id}>
        <div className="sec-index mono">
          Question {idx + 1} / {quizzes.length} · 凭记忆作答，不要回看
        </div>
        <h2 className="ask mt-4">{current.question}</h2>

        {!verdict ? (
          <div className="mt-4 space-y-3">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={6}
              placeholder="用你自己的话写下来——提取困难恰恰是记忆发生的时刻"
              className="field resize-y"
            />
            <button onClick={submit} disabled={busy} className="btn-solid magnetic">
              {busy ? "阅卷中…" : "提交答卷 →"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4 reveal-answer">
            <div className="bg-[#fbfbfc] border border-zinc-200 rounded-2xl p-5">
              <div className="sec-index mono mb-2">你的回答</div>
              <p className="text-[14px] text-zinc-700 whitespace-pre-wrap leading-relaxed">{answer || "（空白）"}</p>
            </div>
            <div className="bg-[#f2fbfc] border border-[#cdeef4] rounded-2xl p-5">
              <div className="text-[11px] tracking-[0.14em] uppercase text-[#007a8c] font-medium mb-2">阅卷 · 对照原文</div>
              <p className="text-[14px] text-zinc-800 whitespace-pre-wrap leading-relaxed">{verdict}</p>
            </div>
            <button onClick={next} className="btn-solid magnetic">
              下一题 →
            </button>
          </div>
        )}
        {error && <p className="text-[12px] text-red-600 mt-3">{error}</p>}
      </div>
    </div>
  );
}

export { RATING };
