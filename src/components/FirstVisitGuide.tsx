"use client";

import { useEffect, useState } from "react";

/**
 * 首访说明条：给第一次打开的人一个 30 秒的入口。
 * 不占首屏主体、可关闭、只在第一次出现（localStorage 记忆）。
 * 存在的理由：评委/新访客看到的是一个信息密集的页面，没有一句话告诉他这是什么。
 */
export default function FirstVisitGuide() {
  // 默认渲染（服务端也输出）：首访者一定看得到；已读的用户在 hydration 后隐藏
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("wl-guide-v1") === "1") setHidden(true);
    } catch {
      /* 隐私模式下保持显示 */
    }
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem("wl-guide-v1", "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#d8ebef] bg-[#f6fdfe] px-5 py-4 sm:px-6 sm:py-5">
      <button
        onClick={dismiss}
        aria-label="关闭说明"
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white hover:text-zinc-600"
      >
        ✕
      </button>

      <div className="grid gap-4 sm:grid-cols-[1.35fr_1fr] sm:gap-8">
        <div>
          <div className="mono text-[10.5px] uppercase tracking-[0.18em] text-[#007a8c]">第一次来？一句话</div>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-700">
            新闻给你的是<strong className="font-semibold text-zinc-900">碎片</strong>，这里给的是
            <strong className="font-semibold text-zinc-900">因果链</strong>：每条判断都挂原始出处，
            链条到期自动对账——被证伪就直接标断。
          </p>
        </div>

        <div className="sm:border-l sm:border-[#d8ebef] sm:pl-8">
          <div className="mono text-[10.5px] uppercase tracking-[0.18em] text-zinc-400">30 秒体验</div>
          <ol className="mt-2 space-y-1 text-[13px] leading-relaxed text-zinc-600">
            <li>
              <span className="mono mr-1.5 text-[11px] text-[#007a8c]">①</span>读今日简报的三条主线
            </li>
            <li>
              <span className="mono mr-1.5 text-[11px] text-[#007a8c]">②</span>点一条知识链，看它怎么一环环长出来
            </li>
            <li>
              <span className="mono mr-1.5 text-[11px] text-[#007a8c]">③</span>翻一张对账卡：当初的判断，现在对不对
            </li>
          </ol>
          <div className="mt-3 flex items-center gap-2">
            <a href="#brief" onClick={dismiss} className="pill pill-active !text-[12px]">
              从简报开始 →
            </a>
            <a href="/chains" onClick={dismiss} className="pill !text-[12px]">
              直接看链条
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
