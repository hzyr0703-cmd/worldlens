import { getDb } from "@/lib/db";
import { getLiveTiles } from "@/lib/tiles";
import { llmStatsToday } from "@/lib/extract/llm";
import { pendingCount, pendingVerifyCount } from "@/lib/review/fsrs";
import { ActionsBar } from "@/components/ActionsBar";
import CountUp from "@/components/CountUp";
import Hero from "@/components/Hero";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  mechanism: "机制",
  pattern: "模式",
  fact: "硬事实",
  counterexample: "反例",
  judgment: "判断",
  question: "开放问题",
};

function SectionHead({ index, kicker, title, href, linkText }: {
  index: string; kicker: string; title: string; href?: string; linkText?: string;
}) {
  return (
    <div className="mb-7 sm:mb-10 lg:mb-14">
      <div className="flex items-center gap-3">
        <span className="sec-index mono">{index}</span>
        <span className="h-px w-8 bg-zinc-300" />
        <span className="sec-index mono uppercase tracking-[0.16em]">{kicker}</span>
        {href && (
          <a href={href} className="pill ml-auto shrink-0 magnetic">
            {linkText ?? "查看全部"}
          </a>
        )}
      </div>
      <h2 className="text-[26px] sm:text-[44px] font-semibold tracking-[-0.038em] leading-[1.08] mt-5 sm:mt-6 max-w-[22ch]">
        {title}
      </h2>
    </div>
  );
}

export default function Home() {
  const db = getDb();
  const due = pendingCount();
  const verifyDue = pendingVerifyCount();
  const llm = llmStatsToday();
  const sources = (
    db.prepare(`SELECT name FROM sources WHERE enabled = 1 ORDER BY tier, id`).all() as unknown as { name: string }[]
  ).map((r) => r.name);

  const stats = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM nuggets) AS nuggets,
              (SELECT COUNT(*) FROM nuggets WHERE origin = 'quiz') AS quiz_nuggets,
              (SELECT COUNT(*) FROM articles WHERE quizzed = 0) AS pending_articles,
              (SELECT COUNT(*) FROM articles) AS articles,
              (SELECT COUNT(*) FROM items) AS items,
              (SELECT COUNT(*) FROM review_cards) AS cards`
    )
    .get() as unknown as {
    nuggets: number; quiz_nuggets: number; pending_articles: number;
    articles: number; items: number; cards: number;
  };

  const todayNuggets = db
    .prepare(
      `SELECT id, type, statement, domain, confidence FROM nuggets
       ORDER BY id DESC LIMIT 6`
    )
    .all() as unknown as { id: number; type: string; statement: string; domain: string; confidence: number }[];

  const recent = db
    .prepare(
      `SELECT id, title, domain, word_count, quizzed, added_at FROM articles
       ORDER BY id DESC LIMIT 6`
    )
    .all() as unknown as {
    id: number; title: string; domain: string; word_count: number; quizzed: number; added_at: string;
  }[];

  // Hero 方块矩阵用：最新快讯（中文为主，英文 ≤4 条），与 /api/live-tiles 同源
  const latestItems = getLiveTiles();

  const queues = [
    {
      href: "/review",
      label: "复习",
      en: "Reviews",
      desc: due > 0 ? `${due} 张卡片到期，用 FSRS 在遗忘前重现` : "暂时没有到期卡片，去读新文章",
      metric: String(due),
      accent: due > 0,
    },
    {
      href: "/inbox",
      label: "文章池",
      en: "Reading",
      desc: `${stats.pending_articles} 篇待精读 · 全文可读，AI 出题考你`,
      metric: String(stats.articles),
      accent: false,
    },
    {
      href: "/library",
      label: "认知库",
      en: "Library",
      desc: `${stats.nuggets} 枚原子，其中 ${stats.quiz_nuggets} 枚由你亲手答出`,
      metric: String(stats.nuggets),
      accent: false,
    },
    {
      href: "/log",
      label: "世界观日志",
      en: "Log",
      desc: "你的判断被哪条新信息印证、修正或推翻",
      metric: String(stats.items),
      accent: false,
    },
  ];

  return (
    <div className="space-y-16 sm:space-y-24 lg:space-y-32">
      {/* ── Hero：Mobbin 式居中巨型标题 + 真实快讯方块矩阵 ── */}
      {verifyDue > 0 && (
        <a
          href="/review"
          className="mb-8 flex items-center gap-3 rounded-2xl border border-[#f0e0c0] bg-[#fdf8ef] px-5 py-3.5 text-[13.5px] text-[#8a5a08] transition-transform duration-200 hover:-translate-y-0.5"
        >
          <span className="font-semibold">{verifyDue} 张预测对账卡已到期</span>
          <span className="text-[#b08a4a]">—— 当初的判断，现在被现实验证了吗？</span>
          <span className="ml-auto font-medium shrink-0">去结算 →</span>
        </a>
      )}
      <Hero
        items={stats.items}
        articles={stats.articles}
        nuggets={stats.nuggets}
        due={due}
        llmCalls={llm.calls}
        sources={sources}
        latestItems={latestItems}
      />

      <div className="mt-12 flex flex-wrap items-center gap-3 justify-center">
        <ActionsBar />
      </div>


      {/* ── 到期复习：唯一高亮卡 ── */}
      {due > 0 && (
        <a href="/review" className="neon-card card-in block rounded-2xl px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[17px] font-semibold tracking-[-0.01em]">
                {due} 张卡片到期 — 先复习，再 intake
              </div>
              <div className="text-[13px] text-zinc-500 mt-1.5">
                回忆是磨损的过程，也是拥有的过程。
              </div>
            </div>
            <span className="pill pill-active shrink-0">开始 →</span>
          </div>
        </a>
      )}

      {/* ── 四个队列 ── */}
      <section>
        <Reveal>
          <SectionHead
            index="01"
            kicker="Queues"
            title="四个队列，构成一次完整训练"
          />
          <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {queues.map((q) => (
              <a key={q.href} href={q.href} className="panel card-in p-5 sm:p-7 flex flex-col min-h-[132px] lg:min-h-[212px] group">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold">{q.label}</span>
                  <span className={`tag ${q.accent ? "tag-accent" : "tier-3"}`}>{q.en}</span>
                </div>
                <p className="text-[13px] leading-[1.7] text-zinc-500 mt-3 sm:mt-4 flex-1">{q.desc}</p>
                <div className="flex items-end justify-between mt-4">
                  <span className="mono text-[26px] sm:text-[32px] font-semibold tracking-[-0.025em] leading-none tabular-nums">
                    <CountUp value={Number(q.metric)} />
                  </span>
                  <span className="text-zinc-300 group-hover:text-[#007a8c] group-hover:translate-x-0.5 transition-all duration-200">
                    →
                  </span>
                </div>
              </a>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── 深度文章 ── */}
      <section>
        <Reveal>
          <SectionHead
            index="02"
            kicker="Reading"
            title="最新入库的深度文章"
            href="/inbox"
            linkText="全部文章"
          />
          {recent.length === 0 ? (
            <div className="panel p-10 text-center">
              <p className="text-[13.5px] text-zinc-500">文章池是空的。点上方「供给今日精读」自动抓取，或去文章池手动投喂。</p>
            </div>
          ) : (
            <div className="stagger grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {recent.map((a) => (
                <a
                  key={a.id}
                  href={`/read/${a.id}`}
                  className="panel card-in p-5 sm:p-8 flex flex-col min-h-[150px] lg:min-h-[228px] group"
                >
                  <div className="flex items-center gap-2">
                    <span className={`tag ${a.domain === "finance" ? "tier-0" : "tier-2"}`}>
                      {a.domain === "finance" ? "财经" : a.domain === "ai" ? "AI" : "科技"}
                    </span>
                    <span className="mono text-[11px] text-zinc-400 tabular-nums">{a.word_count} 字</span>
                  </div>
                  <h3 className="text-[15.5px] sm:text-[17px] font-semibold leading-[1.38] mt-4 sm:mt-5 flex-1 tracking-[-0.018em] group-hover:text-[#007a8c] transition-colors duration-200">
                    {a.title}
                  </h3>
                  <div className="flex items-center justify-between mt-4 sm:mt-6 pt-3.5 sm:pt-5 border-t border-zinc-200">
                    <span className="mono text-[11px] text-zinc-400 tabular-nums">
                      {a.added_at.slice(5, 10)}
                    </span>
                    <span className="text-[12px] text-zinc-400 group-hover:text-[#007a8c] font-medium transition-colors duration-200">
                      {a.quizzed ? "已拷问 →" : "开始精读 →"}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </Reveal>
      </section>

      {/* ── 认知原子 ── */}
      <section>
        <Reveal>
          <SectionHead
            index="03"
            kicker="Nuggets"
            title="最近沉淀的认知原子"
            href="/library"
            linkText="全部原子"
          />
          <div className="stagger grid grid-cols-1 md:grid-cols-2 gap-3">
            {todayNuggets.length === 0 ? (
              <div className="panel md:col-span-2 p-10 text-center">
                <p className="text-[13.5px] text-zinc-500">
                  还没有原子。去文章池投一篇长文，让 AI 考你，你答完后原子才会生成。
                </p>
              </div>
            ) : (
              todayNuggets.map((n) => (
                <div key={n.id} className="panel card-in p-5 sm:p-8">
                  <div className="flex items-center gap-2">
                    <span className="tag tier-2">{TYPE_LABEL[n.type] ?? n.type}</span>
                    <span className="tag tier-3">{n.domain}</span>
                    <span className="mono text-[11px] text-zinc-400 ml-auto tabular-nums">
                      置信 {Math.round(n.confidence * 100)}%
                    </span>
                  </div>
                  <p className="text-[14.5px] sm:text-[15.5px] leading-[1.75] mt-4 sm:mt-5 tracking-[-0.008em]">{n.statement}</p>
                </div>
              ))
            )}
          </div>
        </Reveal>
      </section>

      {/* ── 方法论 ── */}
      <Reveal>
        <section className="rounded-3xl bg-zinc-900 text-white px-6 sm:px-12 py-10 sm:py-16 relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            style={{
              background:
                "radial-gradient(680px 300px at 8% 0%, #00b8d4, transparent 62%), radial-gradient(560px 280px at 100% 100%, #e8447f, transparent 60%)",
            }}
          />
          {/* 细网格底纹，压在渐变之上增加质感 */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.5]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage: "radial-gradient(700px 340px at 50% 0%, #000, transparent 76%)",
              WebkitMaskImage: "radial-gradient(700px 340px at 50% 0%, #000, transparent 76%)",
            }}
            aria-hidden
          />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="sec-index mono text-white/40">04</span>
              <span className="h-px w-8 bg-white/20" />
              <span className="mono text-[11px] uppercase tracking-[0.16em] text-[#00b8d4]">
                How it works
              </span>
            </div>
            <h2 className="text-[28px] sm:text-[46px] font-semibold tracking-[-0.038em] leading-[1.08] mt-5 max-w-[18ch]">
              阅读不产生认知，<br />
              <span className="text-white/45">回忆才产生认知</span>。
            </h2>
            <div className="mt-8 sm:mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-7 sm:gap-y-10 stagger">
              {[
                { n: "01", t: "收集", d: "从 T0–T3 分级信源抓取真实信息与深度长文，去重留证。" },
                { n: "02", t: "精读", d: "全文可读，不做碎片摘要。原文长度决定理解深度。" },
                { n: "03", t: "拷问", d: "AI 按认知原子类型出 4–6 道简答题，你必须先答。" },
                { n: "04", t: "留存", d: "AI 指出对在哪、漏什么，你的表述成为原子并进入 FSRS 复习。" },
              ].map((s) => (
                <div key={s.n} className="border-t border-white/12 pt-5 card-in">
                  <div className="mono text-[12px] text-[#00b8d4] tabular-nums">{s.n}</div>
                  <div className="text-[17px] font-semibold mt-2.5 tracking-[-0.01em]">{s.t}</div>
                  <p className="text-[13px] leading-relaxed text-zinc-400 mt-2.5">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </Reveal>
    </div>
  );
}
