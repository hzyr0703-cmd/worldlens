"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { wlFetch } from "@/lib/client/fetch";
import { useRouter } from "next/navigation";

type JobState = { running: boolean; ok?: boolean; detail?: string };

export function ActionsBar() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"ingest" | "distill" | "supply" | "digest" | null>(null);
  const [msg, setMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 组件卸载时停掉轮询，避免对已卸载组件 setState
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function stopPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  /** 后台任务轮询：4 秒一次查 job 状态，完成显示结果并刷新 */
  function pollJob(kind: "ingest" | "distill" | "supply") {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/${kind}`).then((x) => x.json());
        const job: JobState | undefined = r?.job;
        if (!job?.running) {
          stopPoll();
          setBusy(null);
          if (job) setMsg(job.ok ? `完成：${job.detail}` : `失败：${job.detail}`);
          startTransition(() => router.refresh());
        }
      } catch {
        /* 网络抖动忽略，下一轮再查 */
      }
    }, 4000);
  }

  /** 简报轮询：/api/digest 的 GET 带 job.build 字段 */
  function pollDigest() {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch("/api/digest").then((x) => x.json());
        const j: JobState | undefined = r?.job?.build;
        if (j && !j.running) {
          stopPoll();
          setBusy(null);
          setMsg(j.ok ? `完成：${j.detail}` : `失败：${j.detail}`);
          startTransition(() => router.refresh());
        }
      } catch {
        /* 忽略 */
      }
    }, 4000);
  }

  async function run(kind: "ingest" | "distill" | "supply" | "digest") {
    stopPoll();
    setBusy(kind);
    setMsg(
      kind === "ingest" ? "采集中…" : kind === "distill" ? "蒸馏中（LLM 推理，约 1-5 分钟）…" : kind === "digest" ? "生成今日简报…" : "寻找今日精读文章…"
    );
    try {
      const res = await wlFetch(`/api/${kind}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (kind === "digest") {
        if (data.cached) {
          setMsg("今日简报已存在，直接取用（要重写请用「深度简报」）");
          setBusy(null);
          startTransition(() => router.refresh());
          return;
        }
        // 无缓存时也后台生成（POST 返回已启动），轮询直到完成
        pollDigest();
        return;
      }
      // 采集/供给/蒸馏：后台任务，轮询 job 状态
      setMsg(data.message ?? "已启动");
      if (data.started) pollJob(kind);
      else stopPoll();
    } catch (e) {
      setMsg(`失败: ${e instanceof Error ? e.message : String(e)}`);
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
