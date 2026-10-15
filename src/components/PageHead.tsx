/**
 * PageHead — 内页统一页头（对齐首页的编辑排版体系）
 * 序号 + kicker + 大标题 + 描述 + 可选右侧动作位
 */
export default function PageHead({
  index,
  kicker,
  title,
  desc,
  aside,
}: {
  index: string;
  kicker: string;
  title: string;
  desc?: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="page-head mb-8 sm:mb-12 lg:mb-16">
      <div className="flex items-center gap-3">
        <span className="sec-index mono">{index}</span>
        <span className="h-px w-8 bg-zinc-300" />
        <span className="sec-index mono uppercase tracking-[0.16em]">{kicker}</span>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <h1 className="text-[26px] sm:text-[44px] font-semibold tracking-[-0.038em] leading-[1.08] mt-5 sm:mt-6 max-w-[22ch]">
        {title}
      </h1>
      {desc && <p className="text-[13.5px] sm:text-[14.5px] leading-relaxed text-zinc-500 mt-4 sm:mt-5 max-w-[62ch]">{desc}</p>}
    </header>
  );
}