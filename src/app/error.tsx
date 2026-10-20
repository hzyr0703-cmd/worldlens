"use client";

import { useEffect } from "react";

/** 全局路由错误边界：任何页面的运行时异常都可见（含具体 message），不再是白屏 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] grid place-items-center px-6">
      <div className="panel p-10 max-w-[520px] text-center">
        <p className="text-[19px] font-semibold tracking-[-0.018em]">这个页面出了点问题</p>
        <p className="mono mt-4 text-left text-[12px] leading-relaxed text-red-600 break-all bg-[#fceef0] border border-[#f6d5d9] rounded-xl p-4">
          {error.message}
          {error.digest ? `\n(digest: ${error.digest})` : ""}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={reset} className="btn-solid">
            重试
          </button>
          <a href="/" className="ghost">
            回首页
          </a>
        </div>
        <p className="text-[12px] text-zinc-400 mt-6">
          把上面的错误信息发给果果，能直接定位。
        </p>
      </div>
    </div>
  );
}
