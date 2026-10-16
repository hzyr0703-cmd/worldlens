"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

export default function PasteArticle() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [domain, setDomain] = useState("finance");
  const [sourceKind, setSourceKind] = useState("official");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const res = await wlFetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, url, domain, origin: "paste", sourceKind }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setMsg(`已入库 #${data.id}（${body.length} 字）`);
      setTitle("");
      setBody("");
      setUrl("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-7">
      <div className="sec-index mono mb-5">投喂深度文章</div>
      <div className="space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题（可留空自动截取）"
        className="field"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="原文链接（可选）"
        className="field !text-[13px]"
      />
      <div className="flex gap-2 items-center">
        {[
          { v: "finance", l: "财经" },
          { v: "ai", l: "AI" },
          { v: "tech", l: "科技" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setDomain(o.v)}
            className={`pill !text-[12.5px] !py-1.5 !px-4 ${domain === o.v ? "pill-active" : ""}`}
          >
            {o.l}
          </button>
        ))}
        <span className="w-px h-5 bg-zinc-200 mx-1" />
        {[
          { v: "official", l: "实锤/官方" },
          { v: "anecdote", l: "一线口述" },
          { v: "rumor", l: "传闻" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setSourceKind(o.v)}
            title="口述/传闻类来源沉淀的原子置信度打折"
            className={`pill !text-[12.5px] !py-1.5 !px-4 ${sourceKind === o.v ? "pill-active" : ""}`}
          >
            {o.l}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        placeholder="粘贴文章全文——研报、深度报道、论文、公众号长文、播客文字稿均可。≥300字。"
        className="field resize-y !text-[14px]"
      />
      <div className="flex items-center gap-4">
          <button onClick={submit} disabled={busy || body.length < 300} className="btn-solid">
            {busy ? "入库中…" : "入库 →"}
          </button>
          <span className="mono text-[11px] text-zinc-400 tabular-nums">{body.length} 字</span>
          {msg && <span className="text-[12.5px] text-zinc-500">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
