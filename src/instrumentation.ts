/**
 * 服务端启动钩子：每日 08:00（北京时间）自动执行 采集→供给→蒸馏 全链路。
 * 单进程内一把锁防重入；沙箱重启后重新对齐到下一个 08:00。
 *
 * 互斥设计：cron 各段走 background.runJob（等待完成），手动触发的 API 走
 * startJob（fire-and-forget）。同名任务互斥——手动采集进行中时，cron 的采集段
 * 自动跳过（等下一轮），杜绝双写。
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
      const { runJob } = await import("@/lib/background");
      ensureSeed();

      // ── 采集段（与手动 /api/ingest 互斥）──
      const ing = await runJob("ingest", async () => {
        const { ingestAll } = await import("@/lib/ingest/rss");
        const { ingestCninfo } = await import("@/lib/ingest/cninfo");
        const a = await ingestAll();
        await ingestCninfo();
        const fetched = a.reduce((s, x) => s + x.fetched, 0);
        const inserted = a.reduce((s, x) => s + x.inserted, 0);
        return `采集 ${fetched}/入${inserted}`;
      });

      // ── 供给段 ──
      const sup = await runJob("supply", async () => {
        const { curateAll } = await import("@/lib/supply/curator");
        const r = await curateAll();
        return `文章 +${r.reduce((s, x) => s + x.added, 0)}`;
      });

      // ── 蒸馏段 ──
      const dis = await runJob("distill", async () => {
        const { distillDaily } = await import("@/lib/distill/pipeline");
        const r = await distillDaily();
        return `原子 +${r.created} 连边 ${r.links} 印证 ${r.reinforced} 去重 ${r.contradicted}`;
      });

      // ── 简报段 ──
      const dig = await runJob("digest-build", async () => {
        const { buildDigest } = await import("@/lib/digest/daily");
        const r = await buildDigest();
        return `简报✓ ${r.content.length} 字`;
      });

      // ── 链条段 ──
      const chn = await runJob("chains", async () => {
        const { buildChains, ensureVerifyPoints } = await import("@/lib/chain/builder");
        const cr = await buildChains();
        const vp = await ensureVerifyPoints(5);
        return `chains +${cr.created} new / +${cr.extended} steps / ${cr.broken} broken / +${vp} verify pts`;
      });

      // 被手动任务占用的段落如实记录，等下一轮补
      const skipped = [ing, sup, dis, dig, chn].filter((x) => x.skipped);
      const ok = skipped.length < 5;
      const detail =
        [
          ing.skipped ? "采集跳过(占用)" : ing.detail,
          sup.skipped ? "供给跳过(占用)" : sup.detail,
          dis.skipped ? "蒸馏跳过(占用)" : dis.detail,
          dig.skipped ? "简报跳过(占用)" : dig.detail,
          chn.skipped ? "链条跳过(占用)" : chn.detail,
        ].join(" · ") || "无事可做";
      console.log(`[wl-cron] daily run done in ${Math.round((Date.now() - started) / 1000)}s — ${detail}`);
      try {
        const { getDb } = await import("@/lib/db");
        getDb()
          .prepare(`INSERT INTO cron_log (run_date, ok, detail, ms) VALUES (date('now'), ?, ?, ?)`)
          .run(ok ? 1 : 0, detail.slice(0, 200), Date.now() - started);
        getDb().exec("PRAGMA wal_checkpoint(TRUNCATE)"); // WAL 卫生
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

  // ── 实时层：每 20 分钟采集快讯（轻量 + 顺带蒸馏 40 条）──
  // 全部走 startJob("ingest")：与手动 /api/ingest 同名互斥，杜绝双写
  async function quickIngest() {
    try {
      const { startJob } = await import("@/lib/background");
      const { started } = startJob("ingest", async () => {
        const { ingestAll } = await import("@/lib/ingest/rss");
        const { extractPending } = await import("@/lib/extract/entities");
        const { ingestCninfo } = await import("@/lib/ingest/cninfo");
        const ing = await ingestAll();
        const cn = await ingestCninfo();
        const inserted = ing.reduce((s, x) => s + x.inserted, 0);
        const cnAdded = Object.values(cn).reduce((s, n) => s + n, 0);
        let extra = `采集 ${ing.reduce((s, x) => s + x.fetched, 0)}/入${inserted + cnAdded}`;
        if (inserted + cnAdded > 0) {
          await extractPending();
        }
        // 蒸馏跟随：手动蒸馏在跑时自动跳过（同名互斥）
        try {
          const { runJob } = await import("@/lib/background");
          const dr = await runJob("distill", async () => {
            const { distillDaily } = await import("@/lib/distill/pipeline");
            const r = await distillDaily(undefined, 40);
            return `蒸馏 ${r.scanned} → +${r.created} 原子`;
          });
          if (!dr.skipped) extra += ` · ${dr.detail}`;
        } catch {
          /* 蒸馏失败不阻塞采集 */
        }
        return extra;
      });
      if (!started) console.log("[wl-live] ingest 被手动任务占用，本轮跳过");
    } catch (e) {
      console.error("[wl-live] quick ingest failed:", e instanceof Error ? e.message : String(e));
    }
  }

  // ── 实时层：简报跟随更新 —— 每小时检查，当日 claims 比简报里多 20 条以上就重建。
  // 深度版（deep=1）不被免费版覆盖。
  let digestBusy = false;
  async function refreshDigestIfStale() {
    if (digestBusy) return;
    digestBusy = true;
    try {
      const { getDb } = await import("@/lib/db");
      const { runJob } = await import("@/lib/background");
      const db = getDb();
      const row = db
        .prepare(`SELECT stats, created_at FROM digests WHERE date = date('now', '+8 hours') AND deep = 0`)
        .get() as unknown as { stats: string; created_at: string } | undefined;
      const claimsToday = (
        db
          .prepare(
            `SELECT COUNT(*) c FROM claims c JOIN items i ON i.id = c.item_id
             WHERE date(COALESCE(i.published_at, i.fetched_at), '+8 hours') = date('now', '+8 hours')`
          )
          .get() as unknown as { c: number }
      ).c;
      const old = row ? JSON.parse(row.stats ?? "{}").claims ?? 0 : -1;
      if (!row || claimsToday - old >= 20) {
        const r = await runJob("digest-build", async () => {
          const { buildDigest } = await import("@/lib/digest/daily");
          const built = await buildDigest();
          return `简报✓ ${built.content.length} 字`;
        });
        if (r.skipped) {
          console.log("[wl-live] digest 被手动任务占用，本轮跳过");
          return;
        }
        const chn = await runJob("chains", async () => {
          const { buildChains, ensureVerifyPoints } = await import("@/lib/chain/builder");
          const cr = await buildChains();
          const vp = await ensureVerifyPoints(2);
          return `chains +${cr.created}/${cr.extended} +${vp} verify`;
        });
        console.log(`[wl-live] digest refreshed (claims ${old} -> ${claimsToday}) · ${chn.detail}`);
      }
    } catch (e) {
      console.error("[wl-live] digest refresh failed:", e instanceof Error ? e.message : String(e));
    } finally {
      digestBusy = false;
    }
  }

  // ── 每日 08:00 定时：自重算 delay，补跑/耗时导致的漂移自动归位 ──
  function scheduleDaily() {
    const wait = msUntilNextEightBJT();
    console.log(`[wl-cron] next daily run in ${Math.round(wait / 3600000)}h`);
    setTimeout(() => {
      void dailyRun().finally(scheduleDaily);
    }, wait);
  }

  console.log("[wl-cron] live ingest every 20min · digest refresh every 1h");

  // 启动 20s 后首次快讯采集（补上重启期间的空白），之后每 20 分钟
  setTimeout(() => {
    void quickIngest();
    setInterval(() => void quickIngest(), 20 * 60_000);
    setInterval(() => void refreshDigestIfStale(), 60 * 60_000);
  }, 20_000);

  // 可靠性补跑：沙箱重启可能跨过 08:00（setTimeout 丢失）。启动后 60s 检查
  // 今天（北京时间）是否已有成功记录，没有就立即补跑；08:00 定时随后自动对齐。
  setTimeout(() => {
    (async () => {
      try {
        const { getDb } = await import("@/lib/db");
        const done = getDb()
          .prepare(
            `SELECT COUNT(*) c FROM cron_log WHERE run_date = date('now', '+8 hours') AND ok = 1
             AND detail NOT LIKE '%跳过%'`
          )
          .get() as unknown as { c: number };
        if (done.c === 0) {
          console.log("[wl-cron] no successful run today — catch-up starting");
          await dailyRun();
        }
      } catch (e) {
        console.error("[wl-cron] catch-up check failed:", e instanceof Error ? e.message : String(e));
      }
      scheduleDaily();
    })();
  }, 60_000);
}
