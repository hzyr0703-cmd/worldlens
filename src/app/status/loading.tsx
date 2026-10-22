/** 运转页骨架：6 个信号灯占位 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-24 rounded bg-zinc-200" />
      <div className="mt-6 h-9 w-[40%] rounded bg-zinc-200" />
      <div className="mt-3 h-4 w-[55%] rounded bg-zinc-100" />
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-100 p-5">
            <div className="h-2.5 w-12 rounded bg-zinc-200" />
            <div className="mt-3 h-5 w-16 rounded bg-zinc-200" />
            <div className="mt-2 h-2.5 w-20 rounded bg-zinc-100" />
          </div>
        ))}
      </div>
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-100 p-6">
            <div className="h-3 w-24 rounded bg-zinc-200" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="h-3 w-full rounded bg-zinc-100" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
