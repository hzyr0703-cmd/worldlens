// ---------------------------------------------------------------------------
// token-hub / 智谱 OpenAI 兼容客户端。配置优先级: .env > llm.json。
// 无配置时全链路降级为规则模式，不阻塞采集。
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";

function loadJsonConfig(): { baseUrl?: string; apiKey?: string; model?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "llm.json"), "utf8"));
  } catch {
    return {};
  }
}

const cfg = loadJsonConfig();
const BASE_URL = process.env.LLM_BASE_URL || cfg.baseUrl || "";
const API_KEY = process.env.LLM_API_KEY || cfg.apiKey || "";
const MODEL = process.env.LLM_MODEL || cfg.model || "glm-4-flash";

export const llmEnabled = Boolean(BASE_URL && API_KEY);

export async function chat(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number; purpose?: string }
): Promise<string> {
  if (!llmEnabled) throw new Error("LLM not configured");
  const t0 = Date.now();
  const purpose = opts?.purpose ?? "unknown";
  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    logCall(purpose, MODEL, Date.now() - t0, 1, "");
    return data.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    logCall(purpose, MODEL, Date.now() - t0, 0, e instanceof Error ? e.message.slice(0, 200) : String(e));
    throw e;
  }
}

function logCall(purpose: string, model: string, ms: number, ok: number, error: string): void {
  try {
    getDb()
      .prepare(`INSERT INTO llm_log (purpose, model, ms, ok, error) VALUES (?, ?, ?, ?, ?)`)
      .run(purpose, model, ms, ok, error);
  } catch {
    /* 日志失败不阻塞主流程 */
  }
}

export function llmStatsToday(): { calls: number; fails: number; avgMs: number } {
  try {
    const r = getDb()
      .prepare(
        `SELECT COUNT(*) calls, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) fails, AVG(ms) avgMs
         FROM llm_log WHERE date(created_at) = date('now')`
      )
      .get() as unknown as { calls: number; fails: number; avgMs: number | null };
    return { calls: r.calls, fails: r.fails ?? 0, avgMs: Math.round(r.avgMs ?? 0) };
  } catch {
    return { calls: 0, fails: 0, avgMs: 0 };
  }
}
