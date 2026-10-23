"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

/** 深度版简报：用付费模型重算一次——按需付费，日常仍用免费模型。生成要 2 分钟左右，走后台任务 */
export default function DigestDeepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

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
      // 深度版约 2 分钟，到点自动刷新
      setTimeout(() => router.refresh(), 120000);
    } catch (e) {
      setMsg(`失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
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
