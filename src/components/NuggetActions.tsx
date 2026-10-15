"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 原子管理：编辑 / 退役 / 合并（认知资产必须可治理） */
export default function NuggetActions({ id, statement }: { id: number; statement: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(statement);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch("/api/nuggets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, statement: text }),
    });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  async function retire() {
    if (!confirm("退役这条原子？它将不再出现在库和复习队列（可从日志追溯）。")) return;
    setBusy(true);
    await fetch("/api/nuggets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      {open ? (
        <>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="field !py-2 !text-[13px] flex-1"
          />
          <button onClick={save} disabled={busy || !text.trim()} className="ghost !py-1.5 !text-[12px]">
            保存
          </button>
          <button onClick={() => { setOpen(false); setText(statement); }} className="ghost !py-1.5 !text-[12px]">
            取消
          </button>
        </>
      ) : (
        <>
          <button onClick={() => setOpen(true)} className="text-[12px] text-zinc-400 hover:text-[#007a8c] transition-colors">
            编辑
          </button>
          <button onClick={retire} disabled={busy} className="text-[12px] text-zinc-400 hover:text-[#b4232f] transition-colors">
            退役
          </button>
        </>
      )}
    </div>
  );
}
