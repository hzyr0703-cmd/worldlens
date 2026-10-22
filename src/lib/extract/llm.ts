// ---------------------------------------------------------------------------
// LLM 客户端：支持多供应商（智谱直连 / 商汤聚合网关等 OpenAI 兼容端点）。
// 配置优先级: .env > llm.json。无配置时全链路降级为规则模式，不阻塞采集。
//
// 路由规则：
//   1) opts.provider 指定则用该供应商
//   2) opts.model 形如 "sensenova/glm-5.2" 则按前缀选供应商并剥离前缀
//   3) 否则用 defaultProvider
//
// 注意：网关上的强模型多为「推理模型」——思考过程也计入 max_tokens，
//       上限必须给足（建议 ≥8000），否则 content 为空且 finish_reason=length。
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";

type Provider = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** 部分模型强制 temperature（如 kimi-k3 只接受 1） */
  temperature?: number;
};

type LlmConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  providers?: Record<string, Provider>;
  defaultProvider?: string;
};

function loadJsonConfig(): LlmConfig {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "llm.json"), "utf8")) as LlmConfig;
  } catch {
    return {};
  }
}

const cfg = loadJsonConfig();

// 兼容旧配置：顶层 baseUrl/apiKey 视为名为 "default" 的供应商
const PROVIDERS: Record<string, Provider> = {
  ...(cfg.baseUrl && cfg.apiKey
    ? { default: { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model } }
    : {}),
  ...(cfg.providers ?? {}),
};

const DEFAULT_PROVIDER = process.env.LLM_PROVIDER || cfg.defaultProvider || "default";
const ENV_BASE = process.env.LLM_BASE_URL;
const ENV_KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || cfg.model || "glm-4-flash";

export const llmEnabled = Boolean(
  (ENV_BASE && ENV_KEY) || (PROVIDERS[DEFAULT_PROVIDER]?.baseUrl && PROVIDERS[DEFAULT_PROVIDER]?.apiKey)
);

export const llmProviderNames = Object.keys(PROVIDERS);
export const llmDefaultProvider = DEFAULT_PROVIDER;

function resolve(opts?: { provider?: string; model?: string }): {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
} {
  let providerName = opts?.provider ?? DEFAULT_PROVIDER;
  let model = opts?.model ?? "";

  // 支持 "provider/model" 前缀写法
  if (model.includes("/")) {
    const [p, ...rest] = model.split("/");
    if (PROVIDERS[p]) {
      providerName = p;
      model = rest.join("/");
    }
  }
  // 前缀写法也可能来自 env 覆盖
  if (!opts?.provider && !model && MODEL.includes("/")) {
    const [p, ...rest] = MODEL.split("/");
    if (PROVIDERS[p]) {
      providerName = p;
      model = rest.join("/");
    }
  }

  const p = PROVIDERS[providerName];
  if (!p) throw new Error(`LLM provider not configured: ${providerName}`);

  return {
    provider: providerName,
    baseUrl: (providerName === DEFAULT_PROVIDER && ENV_BASE) || p.baseUrl,
    apiKey: (providerName === DEFAULT_PROVIDER && ENV_KEY) || p.apiKey,
    model: model || p.model || MODEL,
    temperature: p.temperature,
  };
}

export async function chat(
  system: string,
  user: string,
  opts?: {
    maxTokens?: number;
    temperature?: number;
    purpose?: string;
    model?: string;
    provider?: string;
  }
): Promise<string> {
  if (!llmEnabled) throw new Error("LLM not configured");
  const r = resolve({ provider: opts?.provider, model: opts?.model });
  const t0 = Date.now();
  const purpose = opts?.purpose ?? "unknown";
  // 推理模型把思考计入 max_tokens：给不足会返回空 content
  const maxTokens = opts?.maxTokens ?? 8000;
  const temperature = r.temperature ?? opts?.temperature ?? 0.2;

  try {
    // 网关有 RPM/TPM 配额（429 / code 8 / 1305）：指数退避重试，否则批量任务会大面积失败
    const RETRYABLE = /429|1305|rpm|tpm|rate.?limit|quota|访问量过大|busy/i;
    const DELAYS = [4000, 12000, 25000];
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
      try {
        const out = await callOnce(system, user, { ...r, maxTokens, temperature });
        logCall(purpose, `${r.provider}/${r.model}`, Date.now() - t0, 1, "");
        return out;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        const retryable = RETRYABLE.test(lastErr.message);
        if (!retryable || attempt === DELAYS.length) break;
        await new Promise((res) => setTimeout(res, DELAYS[attempt]));
      }
    }
    throw lastErr ?? new Error("LLM call failed");
  } catch (e) {
    logCall(
      purpose,
      `${r.provider}/${r.model}`,
      Date.now() - t0,
      0,
      e instanceof Error ? e.message.slice(0, 200) : String(e)
    );
    throw e;
  }
}

/** 单次调用（不含重试与日志） */
async function callOnce(
  system: string,
  user: string,
  r: { provider: string; baseUrl: string; apiKey: string; model: string; maxTokens: number; temperature: number }
): Promise<string> {
  try {
    const res = await fetch(`${r.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${r.apiKey}`,
      },
      body: JSON.stringify({
        model: r.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: r.maxTokens,
        temperature: r.temperature,
      }),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning?: string; reasoning_content?: string }; finish_reason?: string }[];
      usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";

    // 推理模型 thinking 吃光 token → content 为空；明确报错，便于降级逻辑识别
    if (!content.trim() && choice?.finish_reason === "length") {
      const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? r.maxTokens;
      throw new Error(`LLM reasoning exhausted max_tokens (${reasoning} reasoning tokens, model=${r.model})`);
    }

    return content;
  } catch (e) {
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

/** 近 30 天按用途分组的调用统计（LLM 成本感知：调用分布 + 平均耗时） */
export function llmStatsMonthly(): { purpose: string; calls: number; fails: number; avgMs: number }[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT purpose, COUNT(*) calls, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) fails, AVG(ms) avgMs
         FROM llm_log WHERE created_at >= datetime('now', '-30 days')
         GROUP BY purpose ORDER BY calls DESC`
      )
      .all() as unknown as { purpose: string; calls: number; fails: number; avgMs: number | null }[];
    return rows.map((r) => ({ purpose: r.purpose, calls: r.calls, fails: r.fails ?? 0, avgMs: Math.round(r.avgMs ?? 0) }));
  } catch {
    return [];
  }
}

/** JSON 数组容错解析：LLM 偶发在 JSON 前后加杂质（markdown 围栏/解释文字），
 *  贪婪正则会被文字里的 "]" 截断。策略：直接 parse → 围栏提取 → 渐进收缩 [ 起点/ ] 终点。 */
export function parseJsonArray<T>(text: string): T[] {
  const tryParse = (s: string): T[] | null => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? (v as T[]) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const r = tryParse(fence[1].trim());
    if (r) return r;
  }

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  for (let e = end; e > start && end - e < 4000; e--) {
    const r = tryParse(text.slice(start, e + 1));
    if (r) return r;
  }
  return [];
}

/** JSON 对象容错解析（同上，针对 {} 包裹的输出） */
export function parseJsonObject<T>(text: string): T | null {
  const direct = (() => {
    try {
      const v = JSON.parse(text.trim());
      return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
    } catch {
      return null;
    }
  })();
  if (direct) return direct;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const v = JSON.parse(fence[1].trim());
      if (v && typeof v === "object" && !Array.isArray(v)) return v as T;
    } catch {
      /* ignore */
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  for (let e = end; e > start && end - e < 6000; e--) {
    try {
      const v = JSON.parse(text.slice(start, e + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as T;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}
