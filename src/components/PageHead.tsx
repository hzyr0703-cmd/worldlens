/**
 * PageHead — 内页统一页头（对齐首页的编辑排版体系）
 * 序号 + kicker + 大标题 + 描述 + 可选右侧动作位
 *
 * 动效：淡方格底纹（grid-veil）+ 标题逐字入场（SplitText）+ 描述擦入（wipe）
 *  + 右侧动作位磁性（magnetic）
 */
import CountUp from "@/components/CountUp";
import SplitText from "@/components/SplitText";

export default function PageHead({
  index,
  kicker,
  title,
  desc,
  aside,
  count,
}: {
  index: string;
  kicker: string;
  title: string;
  desc?: string;
  aside?: React.ReactNode;
  /** 传入则页头里的数字用滚动动画呈现 */
  count?: number;
}) {
  return (
    <header className="page-head relative mb-8 sm:mb-12 lg:mb-16">
      {/* 淡方格底纹，藏在页头后方 */}
      <div className="grid-veil pointer-events-none absolute inset-x-0 -top-8 h-[260px]" aria-hidden />

      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="sec-index mono">{index}</span>
          <span className="h-px w-8 bg-zinc-300" />
          <span className="sec-index mono uppercase tracking-[0.16em]">{kicker}</span>
          {aside && <div className="ml-auto magnetic">{aside}</div>}
        </div>

        <h1 className="text-[26px] sm:text-[44px] font-semibold tracking-[-0.038em] leading-[1.08] mt-5 sm:mt-6 max-w-[22ch]">
          <SplitText text={title} />
        </h1>

        {desc && (
          <p
            className="wipe text-[13.5px] sm:text-[14.5px] leading-relaxed text-zinc-500 mt-4 sm:mt-5 max-w-[62ch]"
            style={{ ["--d" as string]: "260ms" }}
          >
            {desc}
            {count !== undefined && (
              <>
                {" "}
                当前 <CountUp value={count} /> 条。
              </>
            )}
          </p>
        )}
      </div>
    </header>
  );
}