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
  // v4: nuggets 加"你的参与"字段（幂等迁移，列已存在时忽略报错）
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
  ]) {
    try {
      db.exec(ddl);
    } catch {
      /* 列已存在 */
    }
  }
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

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, content, content='items', content_rowid='id', tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;

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

    CREATE VIRTUAL TABLE IF NOT EXISTS nuggets_fts USING fts5(
      statement, elaboration, content='nuggets', content_rowid='id', tokenize='trigram'
    );
  `);

  /* 旧库迁移：unicode61 对中文无效（整句一个 token，搜索永远 0 命中）。
     检测到旧分词器就重建为 trigram 并回填，一次性开销。 */
  {
    const ftsSql = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'nuggets_fts'`)
      .get() as { sql: string } | undefined;
    if (ftsSql?.sql && !ftsSql.sql.includes("trigram")) {
      db.exec(`DROP TABLE IF EXISTS nuggets_fts`);
      db.exec(`CREATE VIRTUAL TABLE nuggets_fts USING fts5(
        statement, elaboration, content='nuggets', content_rowid='id', tokenize='trigram'
      )`);
      db.exec(`INSERT INTO nuggets_fts(rowid, statement, elaboration)
               SELECT id, statement, elaboration FROM nuggets`);
    }
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS nuggets_ai AFTER INSERT ON nuggets BEGIN
      INSERT INTO nuggets_fts(rowid, statement, elaboration)
      VALUES (new.id, new.statement, new.elaboration);
    END;

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
  `);
}

/** 简易内容指纹：标题去空白小写 + 截断，用于跨源去重 */
export function contentHash(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase().slice(0, 80);
}
