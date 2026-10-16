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

  async function persist(next: string[]) {
    setBusy(true);
    await wlFetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "topic_keywords", value: next }),
    });
    setBusy(false);
    router.refresh();
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
              persist(next);
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
            setKw(next);
            setInput("");
            persist(next);
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
    </div>
  );
}
