"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateQuizButton({ articleId }: { articleId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", articleId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={run} disabled={busy} className="btn-solid">
        {busy ? "AI 出题中（约 1 分钟）…" : "生成拷问题（4-6 题）"}
      </button>
      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}
