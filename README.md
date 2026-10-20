# WorldLens · 世界理解引擎

> 阅读不产生认知，回忆才产生认知；信息不产生理解，对账才产生理解。

每天打开一次，看到引擎把当天世界的真实信息**理解成了什么样**：

- **今日简报** — 三层材料（当日快讯 / 同实体历史主张 / 你的认知原子库）交给主编模型，
  输出四节：今日主线 · 与历史的对话 · 与你的认知库的对话 · 值得追踪
- **冲突雷达** — 同一实体 7 天内的多空对撞，并被 FTS 用来触碰相关原子（自动标 challenged）
- 想深读时进**文章池**：挑一篇长文精读 → AI 出题 → 你凭记忆作答 → 阅卷沉淀认知原子

## 架构（四层 + 一条闭环）

```
L1 采集   19 源分级（17 启用）· RSSHub 三镜像轮换 · 每日 08:00 自动全链路
         文章供给全中文 → 语义压缩 ≤3000 字（原文留档 original_body）
L2 认知   智谱蒸馏七类原子（机制/模式/硬事实/反例/判断/问题/潜规则）
         拷问式精读：AI 出题 → 凭记忆作答 → 阅卷 META（type/domain/pass）→ pass=1 才沉淀
         统一连边引擎（中文 n-gram 候选）→ 原子关系网（支持/矛盾/解释/延伸/类比）
L3 复习   FSRS 调度 · 变式问法 · 受挑战横幅
         预测对账：judgment 原子自动生成验证条件与日期，到期结算（印证 +0.15 / 证伪 −0.3）
L4 治理   llm_log 调用观测 · cron_log 自动运行记录 · worldview_log 演化审计
         原子编辑/退役/合并 · FTS5 trigram 搜索（2 字词 LIKE 兜底）· DB 备份/恢复
```

## 目录

```
src/
  app/
    page.tsx            首页：今日简报 + 冲突雷达 + 队列 + 原子
    feed/               快讯背景流（原始 items）
    inbox/              文章池（供给 + 手动投喂 + 订阅关键词）
    read/[id]/          精读全文（可对照未删减原文）
    quiz/[id]/          拷问 + 阅卷
    library/            认知库（搜索/筛选/编辑/退役/合并）
    review/             复习（回忆卡 + 对账卡）
    graph/              图谱（原子关系网 / 实体共现）
    log/                世界观日志 + 引擎自动运行记录
    api/                16 个路由（写操作需 x-wl-token / cookie）
  lib/
    ingest/             19 源 RSS 采集（镜像轮换）
    supply/             深度文章供给 + 语义压缩
    distill/            蒸馏管线（pipeline.ts）
    quiz/               拷问引擎（interrogator.ts）
    links/              连边引擎（linker.ts，中文 n-gram 候选）
    digest/             每日简报（三层材料）
    radar/              冲突雷达（同实体多空对撞 × 原子关联）
    review/             FSRS + 对账结算
    verify/             对账条件生成
    extract/            LLM 客户端 + 实体抽取
    db.ts               单库 SQLite（WAL）+ 幂等迁移
    auth.ts             写操作 token 门
```

## 技术栈

- Next.js 16.4 + React 19 + TypeScript + Tailwind v4
- **node:sqlite**（Node 22 内置，零原生依赖）+ FTS5 trigram
- LLM 走 token-hub OpenAI 兼容网关（无 key 自动降级规则模式）
- 零 UI 依赖：动效总线（MotionLayer）、逐字入场（SplitText）、数字滚动（CountUp）全自研

## 运行

```bash
npm install
cp .env.example .env   # 可选：LLM_BASE_URL / LLM_API_KEY
npm run dev            # http://localhost:3000
```

## 发布与数据

- `npm run sync` — 发布前把线上 DB 拉回本地（消除双写冲突）
- 备份：`node scripts/backup.mjs export <url> <out>` / `import <file>`
- 每日自动运行：08:00 BJT（cron）+ 启动补跑（当日无成功记录时）

## 设计纪律

1. **每一关都有拒绝权** — 压缩失败跳过、阅卷 pass=0 不沉淀、坏卡保留 due
2. **所有失败模式都是少产出，不是坏产出** — 认知库每一条都值得信任
3. **AI 不替你理解** — 出题、阅卷、蒸馏可以自动化；作答与判断必须出自本人
4. **新功能三问** — 解决"理解世界"的问题吗？长在自己的数据上吗？主路径加摩擦吗？
