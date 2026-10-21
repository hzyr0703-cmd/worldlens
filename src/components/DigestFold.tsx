"use client";

import { useState } from "react";

/** 简报折叠：默认只显示今日主线摘要，点开看完整五节 */
export default function DigestFold({
  summaryHtml,
  fullHtml,
}: {
  summaryHtml: string;
  fullHtml: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        className="digest-md text-[14px] text-zinc-700"
        dangerouslySetInnerHTML={{ __html: open ? fullHtml : summaryHtml }}
      />
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-4 text-[12.5px] text-[#007a8c] hover:underline"
      >
        {open ? "收起全文 ↑" : "展开全文（历史对话 · 认知库对话 · 水面之下 · 值得追踪）↓"}
      </button>
    </div>
  );
}
