"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

/** 原子管理：编辑 / 退役 / 合并（认知资产必须可治理） */
export default function NuggetActions({ id, statement }: { id: number; statement: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(statement);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /** 统一收口：非 2xx 或 ok:false 都要让用户看见，而不是 refresh 后一脸茫然 */
  async function call(method: "PATCH" | "DELETE" | "POST", body: unknown) {
    const res = await wlFetch("/api/nuggets", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !d?.ok) throw new Error(d?.error ?? `操作失败（HTTP ${res.status}）`);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await call("PATCH", { id, statement: text });
      setOpen(false);
    });

  const retire = () => {
    if (!confirm("退役这条原子？它将不再出现在库和复习队列（可从日志追溯）。")) return;
    void run(() => call("DELETE", { id }));
  };

  const merge = () => {
    const target = prompt(`把本条合并进哪条原子？输入目标原子 ID：`);
    if (!target?.trim()) return;
    void run(() => call("POST", { keepId: Number(target.trim()), mergeId: id }));
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
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
            <button
              onClick={merge}
              disabled={busy}
              className="text-[12px] text-zinc-400 hover:text-[#8a5a08] transition-colors"
              title="本条退役、连边迁移到目标原子"
            >
              合并到…
            </button>
          </>
        )}
      </div>
      {err && <p className="mt-2 text-[11.5px] text-[#b4232f] leading-relaxed">{err}</p>}
    </div>
  );
}
