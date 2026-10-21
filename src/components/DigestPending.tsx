"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

/** 当日简报缺失时的占位：自动触发生成，完成后刷新页面 */
export default function DigestPending() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "failed">("idle");

  useEffect(() => {
    let alive = true;
    setState("running");
    wlFetch("/api/digest", { method: "POST", body: JSON.stringify({}) })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.content) router.refresh();
        else setState("failed");
      })
      .catch(() => alive && setState("failed"));
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="panel card-in p-10 text-center">
      {state === "failed" ? (
        <>
          <p className="text-[15px] font-medium">今日简报生成失败</p>
          <p className="text-[13px] text-zinc-500 mt-2">点上方「生成今日简报」重试，或稍等下一次自动生成。</p>
        </>
      ) : (
        <>
          <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-[#00b8d4]" />
          <p className="text-[15px] font-medium">正在生成今日简报…</p>
          <p className="text-[13px] text-zinc-500 mt-2">
            引擎正在读今天的快讯、历史主张和你的链条——约 30 秒，完成后自动刷新。
          </p>
        </>
      )}
    </div>
  );
}
