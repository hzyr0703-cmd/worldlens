"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

/** 主题订阅：设置关键词后，文章供给只收命中关键词的内容 */
export default function TopicSub({ initial }: { initial: string[] }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [kw, setKw] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /** 乐观更新失败要回滚：否则服务端没存下，刷新后关键词"复活"或消失，用户以为见鬼 */
  async function persist(next: string[], prev: string[]) {
    setBusy(true);
    setErr("");
    try {
      const res = await wlFetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "topic_keywords", value: next }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `保存失败（HTTP ${res.status}）`);
      router.refresh();
    } catch (e) {
      setKw(prev);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-7">
      <div className="sec-index mono mb-1.5">主题订阅</div>
      <p className="text-[13px] text-zinc-500 leading-relaxed">
        设置关键词后，「供给今日精读」只收命中关键词的文章。留空则全量收入。
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        {kw.map((k) => (
          <button
            key={k}
            disabled={busy}
            onClick={() => {
              const next = kw.filter((x) => x !== k);
              setKw(next);
              void persist(next, kw);
            }}
            className="pill pill-active !text-[12.5px] cursor-pointer"
            title="点击移除"
          >
            {k} ×
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = input.trim();
            if (!v || kw.includes(v)) return;
            const next = [...kw, v];
            const prev = kw;
            setKw(next);
            setInput("");
            void persist(next, prev);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="添加关键词，如 CPO / HBM / 光模块"
            className="field !w-auto !py-2 !text-[13px] min-w-[240px]"
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn-solid !py-2 !px-4 !text-[12.5px]">
            添加
          </button>
        </form>
      </div>
      {err && <p className="mt-3 text-[11.5px] text-[#b4232f] leading-relaxed">{err}</p>}
    </div>
  );
}
