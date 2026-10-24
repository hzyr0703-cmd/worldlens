"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type JobState = { running: boolean; ok?: boolean; detail?: string };

/** AI 出题：LLM 长任务（1-5 分钟），后台执行 + 轮询任务状态 */
export default function GenerateQuizButton({ articleId }: { articleId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function run() {
    setBusy(true);
    setMsg("AI 出题已启动，约 1-5 分钟…");
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", articleId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.started) {
        setMsg("上一次出题还在进行中，请稍候…");
      }
      // 轮询该文章的出题任务状态
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/quiz?articleId=${articleId}`).then((x) => x.json());
          const j: JobState | undefined = r?.gen;
          if (j && !j.running) {
            stopPoll();
            setBusy(false);
            if (j.ok) {
              setMsg(`完成：${j.detail}`);
              router.refresh();
            } else {
              setMsg(`失败：${j.detail}`);
            }
          }
        } catch {
          /* 忽略 */
        }
      }, 5000);
    } catch (e) {
      setMsg(`失败: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  function stopPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  return (
    <div className="space-y-2">
      <button onClick={run} disabled={busy} className="btn-solid">
        {busy ? "AI 出题中（约 1-5 分钟）…" : "生成拷问题（4-6 题）"}
      </button>
      {msg && <p className="text-[12px] text-zinc-500 mt-1">{msg}</p>}
    </div>
  );
}
