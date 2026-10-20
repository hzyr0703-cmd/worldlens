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
      const { distillDaily } = await import("@/lib/distill/engine");
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

  const wait = msUntilNextEightBJT();
  console.log(`[wl-cron] scheduled daily 08:00 BJT, first run in ${Math.round(wait / 3600000)}h`);

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
