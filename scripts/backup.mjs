#!/usr/bin/env node
/**
 * 数据备份/恢复管线 —— 解决「发布覆盖线上 DB」的双写冲突。
 *
 * 用法（发布前先跑）：
 *   node scripts/backup.mjs export  https://worldlens-collector.app.workbuddy.host  backups/online-<ts>.json
 *   node scripts/backup.mjs import  backups/online-<ts>.json
 *
 * 标准发布流程：
 *   1. node scripts/backup.mjs export <线上URL> backups/online-latest.json
 *   2. node scripts/backup.mjs import backups/online-latest.json   （把线上数据并回本地）
 *   3. next build → 发布（此时上传的 DB 已包含线上全部积累）
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const TABLES = [
  "sources", "items", "entities", "claims", "edges", "digests", "cards",
  "nuggets", "nugget_links", "worldview_log", "articles", "quizzes",
  "review_cards", "review_log", "llm_log", "prefs",
];

const [, , mode, arg, outArg] = process.argv;
const DB_PATH = path.join(process.cwd(), "data", "worldlens.db");

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  return new DatabaseSync(DB_PATH);
}

if (mode === "export") {
  const url = arg;
  const out = outArg ?? `backups/online-${Date.now()}.json`;
  const fsmod = await import("node:fs");
  const token = fsmod.readFileSync(path.join(process.cwd(), "data", "auth.token"), "utf8").trim();
  const res = await fetch(`${url.replace(/\/$/, "")}/api/backup`, {
    headers: { "x-wl-token": token },
  });
  if (!res.ok) {
    console.error("export failed:", res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  console.log("exported to", out, "—", Object.entries(data.tables).map(([k, v]) => `${k}:${v.length}`).join(" "));
} else if (mode === "import") {
  const file = arg;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const db = open();
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN;");
  for (const table of TABLES) {
    const rows = data.tables[table];
    if (!rows || rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    db.prepare(`DELETE FROM ${table}`).run();
    const ins = db.prepare(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
    );
    for (const r of rows) ins.run(...cols.map((c) => r[c] ?? null));
    console.log("restored", table, rows.length);
  }
  db.exec("COMMIT;");
  db.exec("PRAGMA foreign_keys = ON;");
  console.log("import done.");
} else {
  console.error("usage: node scripts/backup.mjs export <url> <out> | import <file>");
  process.exit(1);
}
