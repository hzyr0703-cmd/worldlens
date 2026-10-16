"use client";

import { useState, useTransition } from "react";
import { wlFetch } from "@/lib/client/fetch";
import { useRouter } from "next/navigation";

export function ActionsBar() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"ingest" | "distill" | "supply" | null>(null);
  const [msg, setMsg] = useState("");

  async function run(kind: "ingest" | "distill" | "supply") {
    setBusy(kind);
    setMsg(
      kind === "ingest" ? "采集中…" : kind === "distill" ? "蒸馏中（LLM 推理，约 1-5 分钟）…" : "寻找今日精读文章…"
    );
    try {
      const res = await wlFetch(`/api/${kind}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (kind === "ingest") {
        const ok = (data.ingest ?? []).filter((x: { error?: string }) => !x.error).length;
        setMsg(`采集完成：${ok} 源成功`);
      } else if (kind === "supply") {
        setMsg(`供给完成：新增 ${data.added} 篇深度文章`);
      } else {
        setMsg(
          `蒸馏完成：扫描 ${data.scanned} 条 → 新原子 ${data.created} · 连边 ${data.links} · 印证 ${data.reinforced} · 矛盾 ${data.contradicted}`
        );
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg(`失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || pending;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={() => run("ingest")}
        disabled={disabled}
        className="btn-solid !py-2 !px-4 !text-[12.5px]"
      >
        {busy === "ingest" ? "采集中…" : "采集信息"}
      </button>
      <button
        onClick={() => run("supply")}
        disabled={disabled}
        className="ghost !py-2 !px-4 !text-[12.5px]"
      >
        {busy === "supply" ? "寻找中…" : "供给今日精读"}
      </button>
      <button
        onClick={() => run("distill")}
        disabled={disabled}
        className="ghost !py-2 !px-4 !text-[12.5px]"
      >
        {busy === "distill" ? "蒸馏中…" : "蒸馏认知原子"}
      </button>
      {msg && <span className="text-[12px] text-zinc-500">{msg}</span>}
    </div>
  );
}
