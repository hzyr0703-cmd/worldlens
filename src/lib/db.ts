import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// WorldLens DB — node:sqlite (zero native deps), WAL mode, FTS5 full-text.
// Schema designed to migrate to Postgres+pgvector later (types kept portable).
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "worldlens.db");

declare global {
  var __worldlensDb: DatabaseSync | undefined;
}

function createDb(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  initSchema(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalThis.__worldlensDb) globalThis.__worldlensDb = createDb();
  return globalThis.__worldlensDb;
}

function initSchema(db: DatabaseSync) {
  /* 注意：幂等 ALTER 迁移必须放在所有 CREATE TABLE 之后（见函数末尾的 migrateColumns）。
     放在建表之前会让全新库全部失败——列不存在于基础 DDL，之后任何写入都会报错。 */
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purpose TEXT NOT NULL,
      model TEXT NOT NULL,
      ms INTEGER NOT NULL,
      ok INTEGER NOT NULL DEFAULT 1,
      error TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cron_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 1,
      detail TEXT NOT NULL DEFAULT '',
      ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      thesis TEXT NOT NULL,                      -- 核心判断（一句话）
      domain TEXT DEFAULT 'finance',
      status TEXT NOT NULL DEFAULT 'active',     -- active | resolved | broken
      confidence REAL NOT NULL DEFAULT 0.6,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chain_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id INTEGER NOT NULL REFERENCES chains(id),
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,                        -- trigger | mechanism | effect | verify
      claim TEXT NOT NULL,                       -- 环节表述（压缩后，可溯源）
      item_ids TEXT NOT NULL DEFAULT '[]',       -- 支撑该环节的 items（JSON 数组）
      verify_by TEXT DEFAULT '',                 -- 待验证环节的验证日期
      verified INTEGER NOT NULL DEFAULT 0,       -- 0 待验证 1 已证实 -1 已证伪
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_steps_chain ON chain_steps(chain_id, seq);
    CREATE INDEX IF NOT EXISTS idx_chains_status ON chains(status, updated_at);
    CREATE TABLE IF NOT EXISTS prefs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      tier INTEGER NOT NULL DEFAULT 2,          -- T0=官方 T1=通讯社 T2=行业媒体 T3=自媒体
      category TEXT NOT NULL DEFAULT 'macro',   -- macro | company | overseas | opinion
      enabled INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id),
      guid TEXT NOT NULL UNIQUE,                -- RSS guid 或 link 哈希
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      link TEXT DEFAULT '',
      tier INTEGER NOT NULL,                    -- 冗余信源等级，查询免 join
      published_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      content_hash TEXT,                        -- 标题相似去重用
      processed INTEGER NOT NULL DEFAULT 0      -- 是否已完成实体抽取
    );
    CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);

    /* 全文检索不再用 fts5：线上沙箱的 node:sqlite 没编 fts5 模块（实测
       "no such module: fts5"），INSERT 触发器写虚拟表直接失败 → 采集入库全断
       （cron_log 连续多日「采集 470+/入0」就是这个）。现全部走 LIKE 查基表，
       444 原子 / 6396 条快讯的量级没有性能问题，也不再依赖任何编译扩展。 */

    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'concept',     -- company | macro | person | concept | region
      aliases TEXT DEFAULT '[]',                -- JSON array
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      mention_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id),
      entity_id INTEGER REFERENCES entities(id),
      text TEXT NOT NULL,                       -- 归一化后的原子主张
      polarity TEXT DEFAULT 'factual',          -- bullish | bearish | neutral | factual
      verified INTEGER NOT NULL DEFAULT 0,      -- 双源印证标记（预留：T0/T1 双源证实同一主张时置 1）
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_claims_entity ON claims(entity_id);
    CREATE INDEX IF NOT EXISTS idx_claims_item ON claims(item_id);

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src_id INTEGER NOT NULL REFERENCES entities(id),
      dst_id INTEGER NOT NULL REFERENCES entities(id),
      relation TEXT NOT NULL DEFAULT 'co_mention',
      weight REAL NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(src_id, dst_id, relation)
    );

    CREATE TABLE IF NOT EXISTS digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,                -- YYYY-MM-DD
      content TEXT NOT NULL,                    -- markdown
      stats TEXT DEFAULT '{}',                  -- JSON: items/entities/claims/verified
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== v3: 认知复利引擎 =====
    CREATE TABLE IF NOT EXISTS nuggets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,                       -- mechanism|pattern|fact|counterexample|judgment|question
      statement TEXT NOT NULL,                  -- 一句话表述（认知原子本体）
      elaboration TEXT DEFAULT '',              -- 展开解释
      domain TEXT NOT NULL DEFAULT 'finance',   -- finance|ai（首期双域）
      confidence REAL NOT NULL DEFAULT 0.6,     -- 0-1，佐证上调 / 修正重估
      status TEXT NOT NULL DEFAULT 'active',    -- active|reinforced|revised|challenged|retired
      source_items TEXT DEFAULT '[]',           -- JSON [item_id] 证据链
      distill_date TEXT NOT NULL,               -- 蒸馏批次 YYYY-MM-DD
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_nuggets_date ON nuggets(distill_date DESC);
    CREATE INDEX IF NOT EXISTS idx_nuggets_type ON nuggets(type);

    CREATE TABLE IF NOT EXISTS nugget_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src_id INTEGER NOT NULL REFERENCES nuggets(id),   -- 新原子
      dst_id INTEGER NOT NULL REFERENCES nuggets(id),   -- 旧原子
      relation TEXT NOT NULL,                   -- supports|contradicts|explains|extends|analogy
      rationale TEXT DEFAULT '',                -- LLM 给出的连边理由
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(src_id, dst_id, relation)
    );

    CREATE TABLE IF NOT EXISTS worldview_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nugget_id INTEGER NOT NULL REFERENCES nuggets(id),
      action TEXT NOT NULL,                     -- reinforced|revised|challenged|created
      detail TEXT NOT NULL,                     -- 发生了什么、因为哪条新信息/新原子
      batch_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wvlog_date ON worldview_log(batch_date DESC);

    -- ===== v4: 拷问式精读 + FSRS 复习 =====
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT DEFAULT '',
      body TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'finance',
      origin TEXT NOT NULL DEFAULT 'rss',       -- rss筛选 | paste 手动投喂
      word_count INTEGER DEFAULT 0,
      quizzed INTEGER NOT NULL DEFAULT 0,       -- 已生成拷问
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL REFERENCES articles(id),
      q_order INTEGER NOT NULL,
      question TEXT NOT NULL,
      expects TEXT DEFAULT '',                  -- 出题意图（点评时对照用）
      user_answer TEXT DEFAULT '',
      ai_verdict TEXT DEFAULT '',               -- AI 点评：对在哪/漏什么/修正表述
      nugget_id INTEGER,
      state TEXT NOT NULL DEFAULT 'pending',    -- pending|answered
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_quizzes_article ON quizzes(article_id, q_order);

    CREATE TABLE IF NOT EXISTS review_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nugget_id INTEGER NOT NULL REFERENCES nuggets(id),
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      fsrs_state TEXT NOT NULL DEFAULT '{}',    -- ts-fsrs Card 序列化
      due TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES review_cards(id),
      rating INTEGER NOT NULL,                  -- 1 again 2 hard 3 good 4 easy
      reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== v5: 访问统计（只记 IP/路径/UA，不含任何身份信息；公开页只展示掩码 IP）=====
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '/',
      ua TEXT DEFAULT '',
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(ip);
  `);

  /* 旧库清理：把 fts5 虚拟表和挂在 items/nuggets 上的同步触发器拆掉。
     触发器先删（不依赖模块）；DROP 虚拟表可能同样报 no such module，各自兜住，
     失败也只是留下一个没人再写的旧表，不影响任何功能。 */
  for (const t of ["items_ai", "nuggets_ai"]) {
    try {
      db.exec(`DROP TRIGGER IF EXISTS ${t}`);
    } catch {
      /* ignore */
    }
  }
  for (const t of ["items_fts", "nuggets_fts"]) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${t}`);
    } catch (e) {
      console.warn(`[db] drop legacy ${t} failed (harmless):`, e instanceof Error ? e.message : e);
    }
  }

  /* 幂等列迁移 + 一次性数据修正。必须在所有建表语句之后执行：
     基础 DDL 不含这些后加的列，全新库若先跑 ALTER 会整段失败（历史 bug，2026-10-23 修）。 */
  for (const ddl of [
    `ALTER TABLE nuggets ADD COLUMN origin TEXT NOT NULL DEFAULT 'auto'`,
    `ALTER TABLE chain_steps ADD COLUMN nugget_id INTEGER`,
    `ALTER TABLE chains ADD COLUMN current_view TEXT DEFAULT ''`,
    `ALTER TABLE chains ADD COLUMN next_watch TEXT DEFAULT ''`,
    `ALTER TABLE nuggets ADD COLUMN user_answer TEXT DEFAULT ''`,
    `ALTER TABLE nuggets ADD COLUMN ai_correction TEXT DEFAULT ''`,
    `ALTER TABLE articles ADD COLUMN refined TEXT DEFAULT ''`,
    `ALTER TABLE articles ADD COLUMN original_body TEXT DEFAULT ''`,
    `ALTER TABLE review_cards ADD COLUMN variant TEXT DEFAULT ''`,
    `ALTER TABLE review_cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'recall'`,
    `ALTER TABLE nuggets ADD COLUMN verify_by TEXT DEFAULT ''`,
    `ALTER TABLE nuggets ADD COLUMN verify_date TEXT DEFAULT ''`,
    `ALTER TABLE articles ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'official'`,
    // 蒸馏队列标记：原先散落在 distill/pipeline 的 ensureDistilledColumn()，收归到统一迁移
    `ALTER TABLE items ADD COLUMN distilled INTEGER NOT NULL DEFAULT 0`,
    // 访客去重的第二口径：按浏览器匿名 ID（middleware 下发 wl_vid），比 IP 更接近真实人数
    `ALTER TABLE visits ADD COLUMN vid TEXT NOT NULL DEFAULT ''`,
  ]) {
    try {
      db.exec(ddl);
    } catch {
      /* 列已存在 */
    }
  }
  try {
    // 失效信源归一：连接直接失败(000)的源停用，避免每次采集都计入失败、污染健康页
    db.exec(`UPDATE sources SET enabled = 0 WHERE name IN ('华尔街日报·中文','澎湃新闻')`);
  } catch {
    /* 数据修正失败不影响启动 */
  }
  try {
    // builder 用 INSERT OR IGNORE 追加环节，但缺唯一约束时 IGNORE 形同虚设：
    // buildChains 每小时可能重跑，同一 (chain_id, seq) 会被重复插入
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_steps_unique ON chain_steps(chain_id, seq)`);
  } catch {
    /* 已有重复数据时建索引会失败，不阻塞启动；清理后下次启动自动生效 */
  }
}

/** 简易内容指纹：标题去空白小写 + 截断，用于跨源去重 */
export function contentHash(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase().slice(0, 80);
}
