"use client";

import { useState, useTransition } from "react";
import { wlFetch } from "@/lib/client/fetch";
import { useRouter } from "next/navigation";

export function ActionsBar() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"ingest" | "distill" | "supply" | "digest" | null>(null);
  const [msg, setMsg] = useState("");

  async function run(kind: "ingest" | "distill" | "supply" | "digest") {
    setBusy(kind);
    setMsg(
      kind === "ingest" ? "采集中…" : kind === "distill" ? "蒸馏中（LLM 推理，约 1-5 分钟）…" : kind === "digest" ? "生成今日简报（LLM 叙事，约 30 秒）…" : "寻找今日精读文章…"
    );
    try {
      const res = await wlFetch(`/api/${kind}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (kind === "digest") {
        // 简报仍是同步生成（快，且有缓存直接返回）
        setMsg(data.cached ? "今日简报已存在，直接取用（要重写请用「深度简报」）" : "今日简报已生成");
      } else {
        // 采集/供给/蒸馏都是后台任务：POST 立即返回，约 1 分钟后自动刷新看结果
        setMsg(data.message ?? "已启动");
        setTimeout(() => startTransition(() => router.refresh()), 60000);
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
        onClick={() => run("digest")}
        disabled={disabled}
        className="btn-solid !py-2 !px-4 !text-[12.5px]"
      >
        {busy === "digest" ? "生成中…" : "生成今日简报"}
      </button>
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
