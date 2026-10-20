/**
 * 服务端启动钩子：每日 08:00（北京时间）自动执行 采集→供给→蒸馏 全链路。
 * 单进程内一把锁防重入；沙箱重启后重新对齐到下一个 08:00。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WL_DISABLE_CRON === "1") return;

  const g = globalThis as typeof globalThis & { __wlCron?: boolean };
  if (g.__wlCron) return;
  g.__wlCron = true;

  let running = false;

  async function dailyRun() {
    if (running) return;
    running = true;
    const started = Date.now();
    try {
      const { ensureSeed } = await import("@/app/api/seed/route");
      const { ingestAll } = await import("@/lib/ingest/rss");
      const { curateAll } = await import("@/lib/supply/curator");
      const { distillDaily } = await import("@/lib/distill/pipeline");
      const { buildDigest } = await import("@/lib/digest/daily");
      ensureSeed();
      const ing = await ingestAll();
      const sup = await curateAll();
      const r = await distillDaily();
      await buildDigest(); // 每日简报——最初设计的核心产出物
      try {
        const { getDb } = await import("@/lib/db");
        getDb().exec("PRAGMA wal_checkpoint(TRUNCATE)"); // WAL 卫生：防止 WAL 无限膨胀
      } catch {
        /* checkpoint 失败不影响主流程 */
      }
      const ms = Date.now() - started;
      const fetched = ing.reduce((s, x) => s + x.fetched, 0);
      const inserted = ing.reduce((s, x) => s + x.inserted, 0);
      const articles = sup.reduce((s, x) => s + x.added, 0);
      const detail = `采集 ${fetched}/入${inserted} · 文章 +${articles} · 原子 +${r.created} 连边 +${r.links} 印证 ${r.reinforced} 去重 ${r.contradicted} · 简报✓`;
      console.log(`[wl-cron] daily run done in ${Math.round(ms / 1000)}s — ${detail}`);
      try {
        const { getDb } = await import("@/lib/db");
        getDb()
          .prepare(`INSERT INTO cron_log (run_date, ok, detail, ms) VALUES (date('now'), 1, ?, ?)`)
          .run(detail, ms);
      } catch {
        /* 记录失败不影响主流程 */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[wl-cron] daily run failed:", msg);
      try {
        const { getDb } = await import("@/lib/db");
        getDb()
          .prepare(`INSERT INTO cron_log (run_date, ok, detail, ms) VALUES (date('now'), 0, ?, ?)`)
          .run(msg.slice(0, 200), Date.now() - started);
      } catch {
        /* ignore */
      }
    } finally {
      running = false;
    }
  }

  function msUntilNextEightBJT(): number {
    const now = Date.now();
    const bj = new Date(now + 8 * 3600_000); // 北京时间
    const next = Date.UTC(
      bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(),
      0, 0, 0 // 08:00 BJT == 00:00 UTC
    );
    let target = next;
    if (target <= now) target = next + 86400_000;
    return target - now;
  }

  // ── 实时层：每 20 分钟采集快讯（轻量，不跑 LLM），页面靠版本号自动刷新 ──
  let ingesting = false;
  async function quickIngest() {
    if (ingesting) return;
    ingesting = true;
    try {
      const { ingestAll } = await import("@/lib/ingest/rss");
      const { extractPending } = await import("@/lib/extract/entities");
      const ing = await ingestAll();
      const inserted = ing.reduce((s, x) => s + x.inserted, 0);
      if (inserted > 0) {
        await extractPending(); // 新快讯立刻抽实体/主张，冲突雷达与简报才能看见
        console.log(`[wl-live] +${inserted} items ingested & extracted`);
      }
    } catch (e) {
      console.error("[wl-live] quick ingest failed:", e instanceof Error ? e.message : String(e));
    } finally {
      ingesting = false;
    }
  }

  // ── 实时层：简报跟随更新 —— 每小时检查，当日 claims 比简报里多 20 条以上就重建 ──
  let digestBusy = false;
  async function refreshDigestIfStale() {
    if (digestBusy) return;
    digestBusy = true;
    try {
      const { getDb } = await import("@/lib/db");
      const { buildDigest } = await import("@/lib/digest/daily");
      const db = getDb();
      const row = db
        .prepare(`SELECT stats, created_at FROM digests WHERE date = date('now')`)
        .get() as unknown as { stats: string; created_at: string } | undefined;
      const claimsToday = (
        db
          .prepare(
            `SELECT COUNT(*) c FROM claims c JOIN items i ON i.id = c.item_id
             WHERE date(COALESCE(i.published_at, i.fetched_at)) = date('now')`
          )
          .get() as unknown as { c: number }
      ).c;
      const old = row ? JSON.parse(row.stats ?? "{}").claims ?? 0 : -1;
      if (!row || claimsToday - old >= 20) {
        await buildDigest();
        console.log(`[wl-live] digest refreshed (claims ${old} -> ${claimsToday})`);
      }
    } catch (e) {
      console.error("[wl-live] digest refresh failed:", e instanceof Error ? e.message : String(e));
    } finally {
      digestBusy = false;
    }
  }

  const wait = msUntilNextEightBJT();
  console.log(`[wl-cron] daily 08:00 BJT in ${Math.round(wait / 3600000)}h · live ingest every 20min`);

  // 启动 20s 后首次快讯采集（补上重启期间的空白），之后每 20 分钟
  setTimeout(() => {
    void quickIngest();
    setInterval(() => void quickIngest(), 20 * 60_000);
    setInterval(() => void refreshDigestIfStale(), 60 * 60_000);
  }, 20_000);

  // 可靠性补跑：沙箱重启可能跨过 08:00（setTimeout 丢失）。启动后 60s 检查
  // 今天（北京时间）是否已有成功记录，没有就立即补跑，再对齐下一个 08:00。
  setTimeout(() => {
    (async () => {
      try {
        const { getDb } = await import("@/lib/db");
        const done = getDb()
          .prepare(`SELECT COUNT(*) c FROM cron_log WHERE run_date = date('now') AND ok = 1`)
          .get() as unknown as { c: number };
        if (done.c === 0) {
          console.log("[wl-cron] no successful run today — catch-up starting");
          await dailyRun();
        }
      } catch (e) {
        console.error("[wl-cron] catch-up check failed:", e instanceof Error ? e.message : String(e));
      }
      setTimeout(() => {
        void dailyRun();
        setInterval(() => void dailyRun(), 24 * 3600_000);
      }, wait);
    })();
  }, 60_000);
}
