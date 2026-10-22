/** 日志页骨架：服务器唤醒/查询期间先给出结构，避免白屏 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-24 rounded bg-zinc-200" />
      <div className="mt-6 h-9 w-[60%] rounded bg-zinc-200" />
      <div className="mt-3 h-4 w-[45%] rounded bg-zinc-100" />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-100 p-5">
            <div className="h-3 w-20 rounded bg-zinc-100" />
            <div className="mt-3 h-4 w-[70%] rounded bg-zinc-200" />
            <div className="mt-2 h-3 w-[40%] rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
