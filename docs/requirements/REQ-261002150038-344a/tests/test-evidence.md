---
title: 测试覆盖对照 · 通知去噪（REQ-261002150038-344a）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 测试覆盖对照（逐卡 covers）

> 跑法：`node --test "test/*.test.js"`（全量 307 / 0）。每张卡下面写明它的**覆盖物**与**跑什么能过**。
> 全量数字与逐条命令摘要见 [verification-report.md](./verification-report.md)；自评审与遗留见 [../reviews/self-review.md](../reviews/self-review.md)。

## 父卡

| 卡 | 覆盖内容 | 覆盖物 / 命令 |
|---|---|---|
| t-f48ac7 | 口径契约：isHumanSource 纯函数与真值表 — `covers: t-f48ac7` | `test/source.test.js`（TC-1…TC-5）→ 5 passed |
| t-1d9465 | 自动轮静默：GoalTracker 认入 dive / plugin 注入轮 — `covers: t-1d9465` | `test/goal.auto.test.js`（TC-6…TC-12）→ 13 passed |
| t-0f608f | 「任务」字段：注入正文不再冒充人的要求 — `covers: t-0f608f` | `test/payload.test.js`（TC-13…TC-16）→ 11 passed |
| t-955eca | 飞书卡片：删掉与标题重复的「类型」行 — `covers: t-955eca` | `test/channels.feishu.test.js` → 7 passed |
| t-dc6479 | 设置页预览：卡片区不再显示「类型」行 — `covers: t-dc6479` | `test/client-render.test.js`（TC-21/22）→ 19 passed |
| t-cc2a0c | 端到端、兼容与回归收尾 — `covers: t-cc2a0c` | `test/e2e.local.test.js`（TC-24…TC-27）→ 6 passed；全量 307/0 |

## 子卡

| 卡 | 阶段 | 覆盖物 |
|---|---|---|
| t-220981 | 研发 | `test/source.test.js` TC-1…TC-5 — `covers: t-220981` |
| t-d75046 | 联调 | `node -e` 导入核验（导出两符号、零依赖）＋ `test/source.test.js` — `covers: t-d75046` |
| t-6b15ab | 复核 | 真值表 14 行逐行打印（偏离 0）— `covers: t-6b15ab` |
| t-06742a | 测试 | 全量 `pnpm test` → 293/0（当时点）— `covers: t-06742a` |
| t-2fa8d1 | 研发 | `src/goal.js` + `test/goal.auto.test.js` TC-6…TC-12 — `covers: t-2fa8d1` |
| t-448271 | 联调 | 真接收端联调：注入轮 silent/0 条、注入轮 error/1 条 — `covers: t-448271` |
| t-002a22 | 复核 | 轮次行为差异表 9 行（偏离 0）— `covers: t-002a22` |
| t-113155 | 测试 | 全量 `pnpm test` → 304/0（当时点）— `covers: t-113155` |
| t-f1e3ee | 研发 | `src/payload.js` + `test/payload.test.js` TC-13…TC-16 — `covers: t-f1e3ee` |
| t-d126c0 | 联调 | 报文实测：「任务」=人的话、不含注入正文 — `covers: t-d126c0` |
| t-c10757 | 复核 | 「任务」口径 6 行（偏离 0）— `covers: t-c10757` |
| t-b02ef3 | 测试 | 全量 `pnpm test` → 304/0（当时点）— `covers: t-b02ef3` |
| t-1e5fa9 | 研发 | `test/channels.feishu.test.js`（断言翻转 + 字段顺序）→ 7 passed — `covers: t-1e5fa9` |
| t-1fb3eb | 联调 | 卡片报文实测：标题/配色/字段集、JSON 无「类型」、文本渠道仍含「类型」— `covers: t-1fb3eb` |
| t-7486b9 | 复核 | 字段集与不变项核对（偏离 0）— `covers: t-7486b9` |
| t-01300e | 测试 | 全量 `pnpm test` → 305/0（当时点）— `covers: t-01300e` |
| t-8ff324 | 研发 | `test/client-render.test.js` TC-21/22 → 19 passed — `covers: t-8ff324` |
| t-98eaa8 | 联调 | `test/client-render.test.js test/client-hooks.test.js test/client-service.test.js` → 42 passed — `covers: t-98eaa8` |
| t-aeb234 | 复核 | 卡片区/纯文本区/template 边界三条断言（偏离 0）— `covers: t-aeb234` |
| t-723dce | 测试 | 全量 `pnpm test` → 305/0（当时点）— `covers: t-723dce` |
| t-b715ff | 研发 | `test/e2e.local.test.js` TC-24…TC-27 → 6 passed — `covers: t-b715ff` |
| t-e4a547 | 复核 | 验收报告数字与回滚清单审计（补正 1 处）— `covers: t-e4a547` |
| t-d3b450 | 测试 | 最终全量 `pnpm test` → 307/0；`test/e2e.local.test.js` → 6/0 — `covers: t-d3b450` |

## 覆盖统计

- 父卡 6 / 6 有覆盖，子卡 23 / 23 有覆盖，**合计 29 / 29 = 100%**。
- 全量用例：307（基线 288，只增不减），失败 0。
