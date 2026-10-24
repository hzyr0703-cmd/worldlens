"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

type JobState = { running: boolean; ok?: boolean; detail?: string };

/** 深度版简报：用付费模型重算一次——按需付费，日常仍用免费模型。生成 2 分钟左右，走后台任务并轮询 */
export default function DigestDeepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const res = await wlFetch("/api/digest", {
        method: "POST",
        body: JSON.stringify({ deep: true }),
      });
      const d = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
      setMsg(d?.message ?? "已启动");
      // 轮询 /api/digest 的 job.deep 字段直到完成（约 2 分钟）
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch("/api/digest").then((x) => x.json());
          const j: JobState | undefined = r?.job?.deep;
          if (j && !j.running) {
            stopPoll();
            setBusy(false);
            setMsg(j.ok ? `完成：${j.detail}` : `失败：${j.detail}`);
            router.refresh();
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
    <span className="inline-flex items-center gap-2">
      <button onClick={run} disabled={busy} className="pill magnetic !text-[12px]" title="用 glm-4.6 重算，成本约几分钱">
        {busy ? "深度分析中…" : "深度版"}
      </button>
      {msg && <span className="text-[11.5px] text-zinc-500">{msg}</span>}
    </span>
  );
}
