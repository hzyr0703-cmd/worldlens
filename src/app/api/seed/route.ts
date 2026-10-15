import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SEED_SOURCES, SEED_ENTITIES, DISABLED_SOURCE_URLS } from "@/lib/ingest/sources";

/** 信源与实体种子幂等写入（首次运行 / 新增种子时自动补齐） */
export function ensureSeed(): void {
  const db = getDb();
  const disabled = new Set(DISABLED_SOURCE_URLS);
  const insSrc = db.prepare(
    `INSERT INTO sources (name, url, tier, category, enabled) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO NOTHING`
  );
  for (const s of SEED_SOURCES) {
    insSrc.run(s.name, s.url, s.tier, s.category, disabled.has(s.url) ? 0 : 1);
  }

  const insEnt = db.prepare(
    `INSERT INTO entities (name, type, aliases) VALUES (?, ?, ?)
     ON CONFLICT(name) DO NOTHING`
  );
  for (const e of SEED_ENTITIES) insEnt.run(e.name, e.type, JSON.stringify(e.aliases));
}

export async function POST() {
  ensureSeed();
  return NextResponse.json({ ok: true });
}
