"use client";

/**
 * BackfillButton — 一键补蒸馏积压：把 distilled=0 的未蒸馏信息全部过一遍 LLM 蒸馏。
 * 调 /api/distill { date: 今天 }（engine 的查询语义是 date<=今天 AND distilled=0，
 * 所以传今天即等于"补全部积压"）。LLM 批量处理可能要 1-3 分钟。
 */
import { useState } from "react";

export default function BackfillButton({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  async function run() {
    setBusy(true);
    setResult("");
    try {
      const res = await fetch("/api/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; scanned?: number; created?: number; batches?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(`✓ 扫描 ${data.scanned ?? 0} 篇 · 蒸馏出 ${data.created ?? 0} 个原子（${data.batches ?? 0} 批）`);
      setTimeout(() => window.location.reload(), 1800);
    } catch (e) {
      setResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  if (count === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2 mt-5">
      <button
        onClick={run}
        disabled={busy}
        className="ghost magnetic !text-[12.5px] !py-2 !px-4"
        title="对尚未蒸馏的信息跑一轮 LLM 蒸馏（可能需要 1-3 分钟）"
      >
        {busy ? "蒸馏中…（不要关闭页面）" : `补蒸馏信息积压（${count} 篇待处理）`}
      </button>
      {result && <p className="text-[12px] text-zinc-500">{result}</p>}
    </div>
  );
}
