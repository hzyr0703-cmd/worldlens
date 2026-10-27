import { getDb } from "@/lib/db";
import { chat, llmEnabled } from "@/lib/extract/llm";

// ---------------------------------------------------------------------------
// 每日简报 v2 —— 从「摘要器」升级为「分析器」。
// 三层材料：A 当日快讯（T级） · B 同实体近 30 天历史主张（对照演变）
//          · C 用户的认知原子库（个人理解的沉淀）
// 输出四节：今日主线 / 与历史的对话 / 与你的认知库的对话 / 值得追踪。
// 「对话」两节是灵魂：没有对照关系就诚实说没有，绝不编造。
// ---------------------------------------------------------------------------

type TopicRow = {
  entity_id: number;
  name: string;
  type: string;
  cnt: number;
  items: string; // JSON: [{title, tier, polarity, published_at}]
};

const TIER_LABEL = ["T0官方", "T1权威", "T2行业", "T3观点"] as const;

function fmtItems(itemsJson: string): string {
  const arr = JSON.parse(itemsJson) as {
    title: string;
    tier: number;
    polarity: string;
    published_at: string | null;
  }[];
  return arr
    .map((x) => `- [${TIER_LABEL[x.tier] ?? "T?"}]${x.polarity === "bullish" ? "▲" : x.polarity === "bearish" ? "▼" : ""} ${x.title}`)
    .join("\n");
}

/** B 层：今日命中实体在过去 30 天的历史主张（对照演变用） */
function historyClaims(entityIds: number[]): { entity: string; text: string; d: string }[] {
  if (entityIds.length === 0) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.name AS entity, c.text, date(COALESCE(i.published_at, i.fetched_at)) AS d
       FROM claims c
       JOIN entities e ON e.id = c.entity_id
       JOIN items i ON i.id = c.item_id
       WHERE c.entity_id IN (${entityIds.map(() => "?").join(",")})
         AND date(COALESCE(i.published_at, i.fetched_at)) < date('now')
         AND date(COALESCE(i.published_at, i.fetched_at)) >= date('now', '-30 day')
       ORDER BY c.id DESC LIMIT 40`
    )
    .all(...entityIds) as unknown as { entity: string; text: string; d: string }[];
  return rows;
}

/** C 层：认知原子库全量（38 条级别，statement 短，直接全喂） */
function allAtoms(): { id: number; type: string; statement: string }[] {
  const db = getDb();
  return db
    .prepare(`SELECT id, type, statement FROM nuggets WHERE status != 'retired' ORDER BY confidence DESC LIMIT 40`)
    .all() as unknown as { id: number; type: string; statement: string }[];
}

/**
 * 简报成品校验：LLM 有时会返回 JSON 骨架、空泛声明或明显截断的半篇。
 * 这类内容一旦入库就会顶掉当期简报并直接呈现在首页——宁可失败，不可污染。
 */
export function validateDigestBody(md: string): { ok: boolean; reason?: string } {
  const t = md.trim();
  if (t.length < 400) return { ok: false, reason: `内容过短 ${t.length} 字` };
  if (/^```/.test(t)) return { ok: false, reason: "返回的是代码块/JSON 而非 markdown" };
  if (/"今日主线"\s*:/.test(t)) return { ok: false, reason: "返回的是 JSON 对象而非 markdown" };
  // 只要求出现这一节，不强制 `##` 前缀——模型偶尔写成 `**今日主线**`，
  // 内容本身可读，不该因为两个井号判死
  if (!/今日主线/.test(t)) return { ok: false, reason: "缺少「今日主线」章节" };
  // 模型在材料缺失时会写这类元声明，说明它没拿到材料
  if (/未接收到.{0,12}材料|无法(提取|进行|生成)/.test(t.slice(0, 600))) {
    return { ok: false, reason: "模型声称未收到材料（输入为空或指令丢失）" };
  }
  return { ok: true };
}

export async function buildDigest(date?: string, opts?: { deep?: boolean }): Promise<{ date: string; content: string; model: string }> {
  const db = getDb();
  // 简报日期按北京时间——"今天的简报"应该覆盖北京时间今天的快讯
  const d = date ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

  const topics = db
    .prepare(
      `SELECT c.entity_id, e.name, e.type, COUNT(*) as cnt,
              JSON_GROUP_ARRAY(JSON_OBJECT('title', i.title, 'tier', i.tier,
                 'polarity', c.polarity, 'published_at', i.published_at)) as items
       FROM claims c
       JOIN entities e ON e.id = c.entity_id
       JOIN items i ON i.id = c.item_id
       WHERE date(COALESCE(i.published_at, i.fetched_at)) = ?
       GROUP BY c.entity_id ORDER BY cnt DESC LIMIT 20`
    )
    .all(d) as unknown as TopicRow[];

  const statsRow = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM items WHERE date(COALESCE(published_at, fetched_at)) = ?) as items,
              (SELECT COUNT(*) FROM claims c JOIN items i ON i.id=c.item_id
                WHERE date(COALESCE(i.published_at, i.fetched_at)) = ?) as claims`
    )
    .get(d, d) as unknown as { items: number; claims: number };

  // D 层：当日巨潮公告（T0 最硬证据）
  const announcements = db
    .prepare(
      `SELECT i.title, i.content FROM items i JOIN sources s ON s.id = i.source_id
       WHERE s.name = '巨潮·公告' AND date(COALESCE(i.published_at, i.fetched_at)) = ?
       ORDER BY i.id DESC LIMIT 12`
    )
    .all(d) as unknown as { title: string; content: string }[];

  // E 层：已注册的链条验证点（未过期的）
  const verifyPoints = db
    .prepare(
      `SELECT c.title, s.claim, s.verify_by FROM chain_steps s
       JOIN chains c ON c.id = s.chain_id
       WHERE s.role = 'verify' AND s.verify_by >= date('now') AND c.status = 'active'
       ORDER BY c.updated_at DESC LIMIT 6`
    )
    .all() as unknown as { title: string; claim: string; verify_by: string }[];



  let content: string;

  if (topics.length === 0) {
    content = `# WorldLens 每日简报 · ${d}\n\n今日暂无匹配关注实体的信息。触发采集后重试。`;
  } else if (llmEnabled) {
    const corpus = topics
      .map((t) => `## ${t.name}（${t.type}，${t.cnt}条）\n${fmtItems(t.items)}`)
      .join("\n\n");

    const entityIds = topics.map((t) => t.entity_id);
    const hist = historyClaims(entityIds);
    const histBlock = hist.length
      ? hist.map((h) => `- [${h.d}]（${h.entity}）${h.text}`).join("\n")
      : "（近 30 天无同实体历史主张）";
    const atoms = allAtoms();
    const atomBlock = atoms.length
      ? atoms.map((a) => `- #${a.id}（${a.type}）${a.statement}`).join("\n")
      : "（认知库为空）";

    const promptText = `你是世界理解引擎的主编。你手上有三层材料：
A. 今日快讯（带信源分级 T0官方/T1权威/T2行业/T3观点，▲看多 ▼看空）
B. 同一实体的历史主张（过去 30 天说过什么）
C. 用户的认知原子库（用户长期保存、亲手沉淀的理解）

输出 markdown 简报，五节结构（总长 1400-2000 字，五节必须全部输出，最后一节不许省略）：
## 今日主线
3-5 条。每条格式：**一句话结论**（带信源标签），后接 2-3 句展开（机制、数字、影响路径）。只陈述，不抒情。
**若 D 中有 T0 公告，至少让 1 条今日主线来自公告**——交易所公告是最硬的证据，优先级高于媒体转述。
## 与历史的对话
今日信息和 B 层历史主张的对照：印证了什么？推翻/修正了什么？同一件事的说法在如何演变？每条对照写清"历史说了 X → 今天出现 Y → 说明 Z"。若 B 层为空或确无对照，就诚实写"今日信息为新增视角，暂无历史对照"——绝不编造对照关系。
## 与你的认知库的对话
今日信息与 C 层原子对照。每条联动格式：**今日信息（一句概括）** ↔ 原子 #n"原句"→ 印证/挑战/补充 + 一句为什么。纪律：只在信息真实触及原子内容时才写——共享主题词不算联动，必须有实质的逻辑关联（同一因果链、同一变量的两面、同一判断的验证）。没有真实联动就诚实写"今日信息与认知库暂无实质关联"。
## 水面之下
从今日信息中挑 1-2 条最值得追问的，剖析表面叙事之外的激励结构。每条固定四行：
- **表面叙事**：媒体是怎么说的（一句话）
- **激励结构**：谁受益、谁承担成本、什么机制在推动这件事（2-3 句。必须基于公开事实，或明确标注为推断）
- **证据等级**：实锤（有公开文件/判例/数据支撑）｜ 结构推断（基于利益关系与制度逻辑推理）｜ 猜测（仅为可能性，无直接证据）
- **如何验证**：一个具体可查证的方向（公告、监管文件、招投标记录、后续事件、财报科目）

高质量示例（照这个锐度写）：
> **表面叙事**：某公司宣布 5 亿元回购并称"彰显信心"。
> **激励结构**：同期大股东披露减持计划 3 亿元——回购托住股价、为大股东减持提供流动性，成本由上市公司（全体股东）承担，收益流向减持方。这是 A 股"回购+减持"的常见组合动作，不是偶发。
> **证据等级**：结构推断（两条公开公告的时间重叠是实锤，动机关联是推断）。
> **如何验证**：追踪回购实际执行进度与减持完成公告，若回购在减持期间加速、减持结束后放缓，关联性坐实。

反例（禁止这样写）：「企业受益于回升，但部分行业承压」——这是空话，没有主体、没有资金流向、没有制度漏洞，等于没分析。

纪律（极重要）：不做无依据的指控；不点名推测个人动机；不涉及政治敏感与未公开信息；证据等级必须诚实标注，推断就是推断；如果今日信息里没有值得深挖的结构，就写"今日无明显值得下潜的信息"——宁可空着，不编造阴谋。

## 值得追踪
**优先采用 E 中已注册的验证点**（若 E 非空，直接列出 2-3 条并标注对应链条名，不要另造新信号）；E 为空时再自行给出 2-3 个可证伪信号。

纪律：只输出 markdown，不要客套；「对话」两节是简报的灵魂，「水面之下」是简报的锋利处——宁可少而真，不可多而凑；但真实的对照要写透（机制+影响），不要一句话带过。`;

    // 材料只拼一次：主调用与降级调用必须用同一份材料，
    // 否则降级时模型手里没有 A/B/C/D/E 任何一层，只能编造（2026-10-21 事故根因）
    const material = `【A. 今日快讯】\n${corpus.slice(0, 9000)}\n\n【B. 同实体历史主张（近30天）】\n${histBlock.slice(0, 3500)}\n\n【C. 用户认知原子库】\n${atomBlock.slice(0, 2500)}\n\n【D. 今日 T0 公告（交易所公告库，最硬证据）】\n${announcements.length ? announcements.map((a) => `- ${a.content.slice(0, 18)} ${a.title}`).join("\n") : "（今日无公告）"}\n\n【E. 已注册的验证点（来自知识链条，务必沿用）】\n${verifyPoints.length ? verifyPoints.map((v) => `- [${v.verify_by} 到期] ${v.title}：${v.claim.slice(0, 80)}`).join("\n") : "（暂无）"}`;

    content = await chat(
      promptText,
      material,
      {
        maxTokens: opts?.deep ? 20000 : 16000,
        temperature: 0.35,
        purpose: "digest_v3",
        // 分级路由：日常用免费 glm-4-flash；深度版优先 glm-4.7-flash（免费推理版）
        model: opts?.deep
          ? process.env.DIGEST_DEEP_MODEL || "sensenova/glm-5.2"
          : process.env.DIGEST_MODEL || "sensenova/glm-5.2",
      }
    ).catch(async (e: unknown) => {
      // 4.7-flash 免费额度限流（1305）时自动降级到 glm-4.6（付费但稳定）
      if (opts?.deep && e instanceof Error && /1305|429|访问量过大/.test(e.message)) {
        console.warn("[digest] deep model rate-limited, falling back to glm-4.6");
        return chat(promptText, material, {
          maxTokens: 16000,
          temperature: 0.35,
          purpose: "digest_deep_fallback",
          model: process.env.DIGEST_DEEP_FALLBACK || "sensenova/deepseek-v4-flash",
        });
      }
      throw e;
    });
    const check = validateDigestBody(content);
    if (!check.ok) {
      throw new Error(
        `简报生成失败：模型返回内容未通过校验（${check.reason}）。已放弃本次写入，保留库中既有内容。`
      );
    }
    content = `# WorldLens 每日简报 · ${d}\n\n${content}`;
  } else {
    // 规则模板兜底
    content = `# WorldLens 每日简报 · ${d}\n\n> 今日采集 ${statsRow.items} 条 / 命中主张 ${statsRow.claims} 条\n\n`;
    content += topics
      .map(
        (t) =>
          `## ${t.name}（${t.type} · ${t.cnt}条）\n\n${fmtItems(t.items)}\n`
      )
      .join("\n");
  }

  const isDeep = Boolean(opts?.deep);
  // 校验下沉到 buildDigest 内部：cron 直调不走 API 层的 validateDigestBody，
  // 没这行的话 LLM 返回空内容时会写进 53 字的垃圾简报并占住当日键位
  if (content.trim().length < 400) {
    throw new Error(`简报内容过短（${content.length} 字），疑似生成失败——已保留原有版本`);
  }
  db.prepare(
    `INSERT INTO digests (date, content, stats, deep) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET content = excluded.content, stats = excluded.stats,
       deep = excluded.deep, created_at = datetime('now')`
  ).run(d, content, JSON.stringify(statsRow), isDeep ? 1 : 0);

  return { date: d, content, model: isDeep ? "deep" : "free" };
}

/** 首页用：命中实体的热度榜（近7天） */
export function topEntities(days = 7): { name: string; type: string; cnt: number }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT e.name, e.type, COUNT(*) as cnt
       FROM claims c JOIN entities e ON e.id = c.entity_id
       JOIN items i ON i.id = c.item_id
       WHERE date(COALESCE(i.published_at, i.fetched_at)) >= date('now', ?)
       GROUP BY e.id ORDER BY cnt DESC LIMIT 15`
    )
    .all(`-${days} day`) as unknown as { name: string; type: string; cnt: number }[];
}
