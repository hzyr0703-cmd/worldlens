# WorldLens · 世界理解引擎

认知提升收集器 — 采集全球真实可靠信息，按信源分级验证，抽取实体与主张，串联关系，生成每日简报。

## 架构（五层）

```
采集层   RSSHub镜像 / 财联社 / 华尔街见闻 / 36氪（可扩展 arXiv、SEC、央行）
可信层   T0-T3 信源分级（T0官方 T1通讯社 T2行业 T3自媒体）
理解层   实体/主张抽取 — 规则词典优先，LLM(token-hub)可选增强
关联层   实体共现图谱（co_mention 边）+ FTS5 全文检索
认知层   每日简报（LLM 叙事 / 规则模板兜底）→ Phase 2: 冲突雷达 / 间隔重复 / 世界观日志
```

## 技术栈

- Next.js 16.4 + React 19 + TypeScript + Tailwind v4
- **node:sqlite**（Node 22.22 内置，零原生依赖）+ FTS5
- LLM 走 token-hub OpenAI 兼容网关（无 key 自动降级规则模式）

## 运行

```bash
npm install
cp .env.example .env   # 可选：填 LLM_BASE_URL / LLM_API_KEY 启用 LLM 增强
npm run dev            # http://localhost:3000
```

首页点「立即采集」拉取信息流 → 自动抽取 → 点「重新生成简报」产出当日简报。

## API

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/ingest` | POST | 采集全部启用信源 + 抽取实体/主张 |
| `/api/digest` | GET/POST | 读取(无则生成) / 强制重建当日简报 |
| `/api/graph` | GET | 实体图谱数据（近30天） |
| `/api/seed` | POST | 幂等写入信源/实体种子 |

## 数据

SQLite 库文件：`data/worldlens.db`（WAL 模式）。核心表：`sources` / `items` / `entities` / `claims` / `edges` / `digests`，`cards` 表为 Phase 2 间隔重复预留。

## Phase 2 路线

1. **冲突雷达** — 新主张 vs claims 历史库，矛盾自动高亮
2. **间隔重复** — 重要主张生成卡片，SM-2 调度
3. **世界观日志** — 主题认知演变时间线（判断被验证/推翻计数）
4. 信源扩展：巨潮公告(T0) / 央行·统计局(T0) / SEC EDGAR(T0) / arXiv q-fin
