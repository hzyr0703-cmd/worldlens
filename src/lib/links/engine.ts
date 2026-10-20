import { getDb } from "@/lib/db";
import { chat, parseJsonArray } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 共享连边引擎 —— 新原子入网。蒸馏与拷问两条沉淀路径都调用此函数，
// 保证任何来源的原子都不会成为图谱孤岛。
// ---------------------------------------------------------------------------


/** 中文候选分词：英文/数字段直接成词；中文段按 4 字滑窗（步长 2）——
 *  中文无空格，整句当一个 token 在 trigram FTS 里必然 0 命中。 */
export function searchTerms(s: string, max = 10): string[] {
  const clean = s.replace(/[，。、：；！？\s"'（）()【】\[\]]/g, " ");
  const out: string[] = [];
  for (const p of clean.split(" ").filter(Boolean)) {
    if (/^[A-Za-z0-9]+$/.test(p) && p.length >= 3) {
      out.push(p);
      if (out.length >= max) break;
      continue;
    }
    const cjk = p.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
    if (cjk.length >= 3) {
      const n = Math.min(4, cjk.length);
      for (let i = 0; i + n <= cjk.length && out.length < max; i += 2) out.push(cjk.slice(i, i + n));
    } else if (p.length >= 2) {
      out.push(p);
    }
    if (out.length >= max) break;
  }
  return out;
}

const RELATIONS = ["supports", "contradicts", "explains", "extends", "analogy"] as const;
const LINK_SYSTEM = `你是认知连接器。新原子与库内相关原子对照，判断它们之间的认知关系：
- supports 佐证 / contradicts 矛盾 / explains 解释 / extends 延伸 / analogy 类比
纪律：只在关系真实成立时输出，宁缺毋滥；rationale 一句话说清。
只输出 JSON 数组：[{"src_idx":0,"dst_id":123,"relation":"supports","rationale":"..."}]`;

/** 为一批新原子建立与库内既有原子的关系连边。
 *  返回 { links, reinforced, contradicted }。onDate 用于世界观日志日期。 */
export async function linkNewAtoms(
  nids: number[],
  onDate: string
): Promise<{ links: number; reinforced: number; contradicted: number }> {
  const db = getDb();
  let links = 0;
  let reinforced = 0;
  let contradicted = 0;

  for (const nid of nids) {
    const nugget = db
      .prepare(`SELECT id, type, statement, elaboration FROM nuggets WHERE id = ?`)
      .get(nid) as unknown as { id: number; type: string; statement: string; elaboration: string } | undefined;
    if (!nugget) continue;

    // FTS 粗筛库内相关旧原子（trigram：≥3 字词），2 字词 LIKE 兜底
    const terms = searchTerms(nugget.statement, 10);
    const longTerms = terms.filter((t) => t.length >= 3);
    const shortTerms = terms.filter((t) => t.length < 3);
    const seen = new Set<number>([nid]);
    const candidates: { id: number; statement: string }[] = [];

    try {
      if (longTerms.length) {
        const rows = db
          .prepare(
            `SELECT n.id, n.statement FROM nuggets n
             JOIN nuggets_fts f ON n.id = f.rowid
             WHERE nuggets_fts MATCH ? AND n.id != ? AND n.status != 'retired'
             ORDER BY rank LIMIT 12`
          )
          .all(longTerms.map((t) => `"${t}"`).join(" OR "), nid) as unknown as { id: number; statement: string }[];
        for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); candidates.push(r); }
      }
      if (shortTerms.length && candidates.length < 6) {
        const like = shortTerms.map(() => `statement LIKE ?`).join(" OR ");
        const rows = db
          .prepare(`SELECT id, statement FROM nuggets WHERE id != ? AND status != 'retired' AND (${like}) LIMIT 6`)
          .all(nid, ...shortTerms.map((t) => `%${t}%`)) as unknown as { id: number; statement: string }[];
        for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); candidates.push(r); }
      }
    } catch {
      continue;
    }
    if (candidates.length === 0) continue;

    const prompt = `新原子:\n[idx:0] ${nugget.statement}\n\n库内原子:\n${candidates
      .map((c) => `[id:${c.id}] ${c.statement}`)
      .join("\n")}`;

    let parsed: { src_idx: number; dst_id: number; relation: string; rationale?: string }[] = [];
    try {
      const raw = await chat(LINK_SYSTEM, prompt, { maxTokens: 2048, temperature: 0.1, purpose: "link" });
      parsed = parseJsonArray(raw);
      if (parsed.length === 0) {
        const raw2 = await chat(LINK_SYSTEM, prompt, { maxTokens: 2048, temperature: 0.3, purpose: "link_retry" });
        parsed = parseJsonArray(raw2);
      }
    } catch {
      continue; // 单原子连边失败不影响其他
    }

    for (const l of parsed) {
      if (l.src_idx !== 0) continue;
      if (!RELATIONS.includes(l.relation as (typeof RELATIONS)[number])) continue;
      if (!candidates.some((c) => c.id === l.dst_id)) continue;

      db.prepare(
        `INSERT INTO nugget_links (src_id, dst_id, relation, rationale) VALUES (?, ?, ?, ?)
         ON CONFLICT(src_id, dst_id, relation) DO NOTHING`
      ).run(nid, l.dst_id, l.relation, (l.rationale ?? "").slice(0, 300));
      links++;

      if (l.relation === "supports") {
        // 加权：低置信新原子只小幅上调旧原子（0.1 × 自身置信度）
        const self = db.prepare(`SELECT confidence FROM nuggets WHERE id = ?`).get(nid) as unknown as { confidence: number };
        const bump = 0.1 * Math.min(1, Math.max(0.2, self?.confidence ?? 0.6));
        db.prepare(
          `UPDATE nuggets SET confidence = MIN(0.95, confidence + ?), status = 'reinforced' WHERE id = ?`
        ).run(bump, l.dst_id);
        db.prepare(
          `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'reinforced', ?, ?)`
        ).run(l.dst_id, `被新原子佐证: ${nugget.statement.slice(0, 120)}`, onDate);
        reinforced++;
      } else if (l.relation === "contradicts") {
        db.prepare(`UPDATE nuggets SET status = 'challenged' WHERE id = ?`).run(l.dst_id);
        db.prepare(
          `INSERT INTO worldview_log (nugget_id, action, detail, batch_date) VALUES (?, 'challenged', ?, ?)`
        ).run(l.dst_id, `被新原子挑战: ${nugget.statement.slice(0, 120)} — ${(l.rationale ?? "").slice(0, 150)}`, onDate);
        contradicted++;
      }
    }
  }

  return { links, reinforced, contradicted };
}
