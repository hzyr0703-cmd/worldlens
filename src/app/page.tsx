import { getDb } from "@/lib/db";
import { getLiveTiles } from "@/lib/tiles";
import { llmStatsToday } from "@/lib/extract/llm";
import { pendingCount, pendingVerifyCount } from "@/lib/review/fsrs";
import { renderMarkdown } from "@/lib/md";
import DigestFold from "@/components/DigestFold";
import DigestPending from "@/components/DigestPending";
import FirstVisitGuide from "@/components/FirstVisitGuide";
import DigestDeepButton from "@/components/DigestDeepButton";
import { listChains } from "@/lib/chain/builder";
import { ActionsBar } from "@/components/ActionsBar";
import CountUp from "@/components/CountUp";
import Hero from "@/components/Hero";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

/** 从简报 markdown 提取「今日主线」前 3 条作为首屏摘要 */
function digestSummary(md: string): string {
  const m = md.match(/## 今日主线([\s\S]*?)(?=\n## |$)/);
  if (!m) return md.slice(0, 400);
  const bullets = m[1]
    .trim()
    .split("\n")
    .filter((l) => l.trim().startsWith("-"))
    .slice(0, 3);
  return bullets.length ? bullets.join("\n") : md.slice(0, 400);
}

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
  const pendingArticles = (
    db.prepare(`SELECT COUNT(*) c FROM articles WHERE quizzed = 0`).get() as unknown as { c: number }
  ).c;
  const today = new Date().toISOString().slice(0, 10);
  const digestToday = db
    .prepare(`SELECT date, content, stats FROM digests WHERE date = ?`)
    .get(today) as unknown as { date: string; content: string; stats: string } | undefined;
  // 今日简报缺失时回退到最近一期：评审/新访客永远不该看到空白页
  const digestRow =
    digestToday ??
    (db
      .prepare(`SELECT date, content, stats FROM digests ORDER BY date DESC LIMIT 1`)
      .get() as unknown as { date: string; content: string; stats: string } | undefined);
  const digestFresh = Boolean(digestToday);
  const chainAgg = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM chains WHERE status != 'archived') AS chains,
              (SELECT COUNT(*) FROM chain_steps) AS steps,
              (SELECT COUNT(*) FROM chain_steps WHERE role = 'verify' AND verify_by >= date('now')) AS verify_due`
    )
    .get() as unknown as { chains: number; steps: number; verify_due: number };

  // 今日链条动态：今日有新增环节的链条 + 断裂链
  const chainStats = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM chains) AS total,
              (SELECT COUNT(*) FROM chains WHERE status = 'broken') AS broken,
              (SELECT COUNT(DISTINCT chain_id) FROM chain_steps WHERE date(created_at) = date('now')) AS touched`
    )
    .get() as unknown as { total: number; broken: number; touched: number };
  const todayChains = db
    .prepare(
      `SELECT c.id, c.title, c.thesis, c.status,
              (SELECT COUNT(*) FROM chain_steps s WHERE s.chain_id = c.id) AS stepCount,
              (SELECT s.claim FROM chain_steps s WHERE s.chain_id = c.id ORDER BY s.seq DESC LIMIT 1) AS lastStep,
              (SELECT s.role FROM chain_steps s WHERE s.chain_id = c.id ORDER BY s.seq DESC LIMIT 1) AS lastRole
       FROM chains c
       WHERE c.id IN (SELECT DISTINCT chain_id FROM chain_steps WHERE date(created_at) = date('now'))
       ORDER BY c.updated_at DESC LIMIT 4`
    )
    .all() as unknown as {
    id: number; title: string; thesis: string; status: string; stepCount: number; lastStep: string; lastRole: string;
  }[];
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


  return (
    <div className="space-y-12 sm:space-y-16 lg:space-y-20">
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
      <FirstVisitGuide />

      <Hero
        items={stats.items}
        articles={stats.articles}
        nuggets={stats.nuggets}
        due={due}
        llmCalls={llm.calls}
        sources={sources}
        latestItems={latestItems}
        chains={chainAgg.chains}
        steps={chainAgg.steps}
        verifyDue={chainAgg.verify_due}
      />

      <div className="mt-12 flex flex-wrap items-center gap-3 justify-center">
        <ActionsBar />
      </div>

      {/* ═══ 01 · 今日简报 —— 世界理解引擎的核心产出物 ═══ */}
      <section id="brief" className="mt-12 sm:mt-16 scroll-mt-24">
        <SectionHead
          index="00"
          kicker="Daily Brief"
          title="今天，引擎理解到的世界"
          href="/briefs"
          linkText="往期简报"
        />
        {digestRow ? (
          <div className="stagger">
            <div className="panel card-in p-6 sm:p-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#00b8d4] opacity-60 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00b8d4]" />
                </span>
                <span className="sec-index mono">
                  {digestFresh
                    ? `${today} · 实时引擎叙事 · 每小时随新信息重算`
                    : `${digestRow.date} · 最近一期（今日简报生成中，先看这期）`}
                </span>
                <span className="ml-auto"><DigestDeepButton /></span>
              </div>
              <DigestFold
                summaryHtml={renderMarkdown(digestSummary(digestRow.content))}
                fullHtml={renderMarkdown(digestRow.content)}
              />
            </div>
          </div>
        ) : (
          <DigestPending />
        )}
      </section>

      {/* ═══ 01 · 今日链条动态 —— 信息点如何长成因果链 ═══ */}
      <section className="mt-20 sm:mt-28">
        <SectionHead
          index="01"
          kicker="Knowledge chains"
          title="今天，哪些链条长出了新环节"
          href="/chains"
          linkText="全部链条"
        />
        {todayChains.length === 0 ? (
          <div className="panel card-in p-8 text-center">
            <p className="text-[14.5px] font-medium">今天还没有链条推进</p>
            <p className="text-[13px] text-zinc-500 mt-2">
              引擎在每日 08:00 与简报刷新后自动建链——信息至少能串出触发与机制两环，才会成链。
            </p>
          </div>
        ) : (
          <div className="stagger grid grid-cols-1 md:grid-cols-2 gap-4">
            {todayChains.map((c) => (
              <a key={c.id} href={`/chains?id=${c.id}`} className="panel card-in block p-5">
                <div className="flex items-center gap-2">
                  <span className={`tag ${c.status === "broken" ? "tier-0" : "tier-2"}`}>
                    {c.status === "broken" ? "已断裂" : "演进中"}
                  </span>
                  <span className="mono text-[10.5px] text-zinc-400 tabular-nums">{c.stepCount} 环</span>
                  <span className="mono ml-auto text-[10px] text-zinc-400">
                    {c.lastRole === "mechanism" ? "机制" : c.lastRole === "effect" ? "现象" : c.lastRole === "trigger" ? "触发" : "验证"}
                  </span>
                </div>
                <div className="mt-2.5 text-[14.5px] font-semibold leading-snug text-zinc-900">{c.title}</div>
                {c.lastStep && (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500 line-clamp-2">最新一环：{c.lastStep}</p>
                )}
              </a>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center gap-4 text-[12px] text-zinc-400">
          <span>累计 {chainStats.total} 条链</span>
          <span>今日推进 {chainStats.touched} 条</span>
          {chainStats.broken > 0 && <span className="text-[#b4232f]">{chainStats.broken} 条已断裂</span>}
        </div>
      </section>

      {/* ═══ 02 · 今日待办 —— 只有真有事才出现 ═══ */}
      {(due > 0 || pendingArticles > 0) && (
        <section className="mt-20 sm:mt-28">
          <SectionHead index="02" kicker="Today" title="今天要做的" />
          <div className="stagger grid grid-cols-1 sm:grid-cols-2 gap-4">
            {due > 0 && (
              <a href="/review" className="neon-card card-in block rounded-2xl px-6 py-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[16px] font-semibold tracking-[-0.01em]">{due} 张对账卡到期</div>
                    <div className="text-[12.5px] text-zinc-500 mt-1">当初的判断，现在被现实验证了吗</div>
                  </div>
                  <span className="pill pill-active shrink-0">复习 →</span>
                </div>
              </a>
            )}
            {pendingArticles > 0 && (
              <a href="/inbox" className="panel card-in block rounded-2xl px-6 py-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[16px] font-semibold tracking-[-0.01em]">{pendingArticles} 篇长文待精读</div>
                    <div className="text-[12.5px] text-zinc-500 mt-1">想深挖时再来，不读也不影响看链条</div>
                  </div>
                  <span className="pill shrink-0">文章池 →</span>
                </div>
              </a>
            )}
          </div>
        </section>
      )}

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

      
    </div>
  );
}
