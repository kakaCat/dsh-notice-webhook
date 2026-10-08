---
title: 拆分计划 · 通知去噪（注入轮静默 + 卡片去重）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 拆分计划

> **目标**：看板 Dive 自动续跑（以及任何插件注入轮）**不再**推「对话完成」——只有 direct human
> （`source` 缺失或 `kind === 'user'`）发起、或人在本轮插过话的轮次才响；注入正文不再冒充「任务」；
> 中断（`error` / `interrupted` / 未知终态）**照旧照推**；飞书卡片与设置页卡片预览删掉与标题重复的「类型」行。
>
> **做法**：新增**唯一口径**纯函数 `isHumanSource(source)`（`src/source.js`），
> 让 `GoalTracker`（轮次静默）与 `PromptTracker`（「任务」字段）都改用它；
> 飞书 `buildCard()` 删一行 + `client.js` 卡片预览同步过滤一行；**不动配置键、不动落盘、不升出站契约版本**。
>
> **一句话验收**：`node --test "test/*.test.js"` 退出码 0，`fail 0` 且 `tests ≥ 288`（本次基线），
> 且新增用例覆盖：注入轮 0 报文 / 人插话轮照响且「任务」=人的话 / 注入轮报错仍叫 / 卡片无「类型」行 / 预览两区一致。

## 1. 改动盘点（对照 5 份设计文档）

### 1.1 新增文件

| 文件 | 内容 | 规格来源 |
|---|---|---|
| `src/source.js` | `isHumanSource(source)` 纯函数（约 15 行，无依赖、无 I/O） | design/interfaces.md §1 |
| `test/source.test.js` | 判定真值表用例（TC-1…TC-5） | design/test-cases.md §1 |
| `docs/requirements/REQ-261002150038-344a/tests/verification-report.md` | 回归数字与回滚路径核验（t6 产出） | 既有需求目录惯例 |

### 1.2 修改文件

| 文件 | 改动 | 规格来源 |
|---|---|---|
| `src/goal.js` | `observe()` 的 `user/message` 分支改调 `isHumanSource`；轮次标记 `sawGoal` → `sawInjected`；`isAutoRound()` = `mark && mark.sawInjected && !mark.sawHuman`；类头注释补 dive / plugin | design/interfaces.md §2 |
| `src/payload.js` | `createPromptTracker().observe()` 的第二道门改为 `!isHumanSource(source)` 则跳过（不再单点判断 `'goal'`） | design/interfaces.md §3 |
| `src/channels/feishu.js` | `buildCard()` 删 `cardField('类型', context.title)` 一行及其注释 | design/interfaces.md §4 |
| `client.js` | `PayloadPreview` 的「飞书卡片」区过滤默认渲染的 `**类型**：…` 行；卡片区容器加 `data-dnw-region="feishu-card"`（便于取段）；纯文本区保留 | design/interfaces.md §5 |
| `test/goal.auto.test.js` | 增 TC-6…TC-12（dive / plugin / 无消息轮 / 插话轮 / 注入轮 error、interrupted） | design/test-cases.md §2 |
| `test/payload.test.js` | 增 TC-13…TC-16（注入不记、人记、混合取人的） | design/test-cases.md §3 |
| `test/channels.feishu.test.js` | 断言**翻转**：正文**不应**有「类型」行；加强 header / 顺序 / 短 id / 按钮断言 | design/test-cases.md §4 |
| `test/client-render.test.js` | 增 TC-21…TC-23（卡片区无、纯文本区有、`payloadPreviewLines` 不变） | design/test-cases.md §5 |
| `test/e2e.local.test.js` | 增 TC-24…TC-26（真接收端：dive 轮 0 条 / 人轮 1 条 / dive+error 1 条中断） | design/test-cases.md §6 |
| `README.md` | 「为什么需要它」把「系统自己唤醒的轮次不该吵人」补全为 goal / dive / plugin 注入轮一律静默；卡片字段说明同步 | design/test-cases.md §8 |

### 1.3 明确不改（写进不变量，回归靠既有测试）

- `index.js`（`handle()` 的 `complete && autoRound → silent` 分支本就存在，本次只让 `autoRound` 认得更准）；
- `src/config.js`（**不新增配置键**、默认值不动）、`src/router.js`、`src/targets.js`、`src/bindings.js`、
  `src/rpc.js`、`src/service.js`、`src/deliver.js`、`src/outcomes.js`、`src/channels/{custom,wecom,dingtalk,slack,discord,index,meta}.js`；
- `package.json`（不新增依赖）、`docs/**` 之外的文件格式、出站 `PAYLOAD_VERSION`（保持 1）。

## 2. 任务表

| key | 标题 | phase | side | 依赖 | 说明 |
|---|---|---|---|---|---|
| t1 | 口径契约：`isHumanSource` 纯函数与真值表 | implement | backend | — | 新增 `src/source.js` + `test/source.test.js`，一行都不改既有文件 |
| t2 | 自动轮静默：`GoalTracker` 认入 dive / plugin 注入轮 | implement | backend | t1 | `src/goal.js` 标记改名 + 判定换口径；`index.js` 不动 |
| t3 | 「任务」字段：注入正文不再冒充人的要求 | implement | backend | t1 | `src/payload.js` 的 `PromptTracker` 同口径 |
| t4 | 飞书卡片：删掉与标题重复的「类型」行 | ui | backend | — | `src/channels/feishu.js` 删一行 + 断言翻转；报文其余部分零变化 |
| t5 | 设置页预览：卡片区不再显示「类型」行 | ui | frontend | t4 | `client.js` 卡片区过滤 + `data-dnw-region` 取段；纯文本区保留 |
| t6 | 端到端 / 兼容与回归收尾（**无数据迁移**，验证回滚路径） | test | fullstack | t2, t3, t4, t5 | `test/e2e.local.test.js` 三条 + README 同步 + 验收报告（含回滚核验） |

**依赖图**：

```
t1 ─┬─▶ t2 ─┐
    └─▶ t3 ─┤
t4 ─────┬───┼─▶ t6
        └─▶ t5 ─┘
```

## 3. 各卡验收口径（可跑命令 + 期望）

| key | 验收（跑什么 → 看到什么算过） |
|---|---|
| t1 | `node --test test/source.test.js` → 全绿（≥5 用例）；`node -e "import('./src/source.js').then(m=>console.log(m.isHumanSource(undefined), m.isHumanSource({kind:'user'}), m.isHumanSource({kind:'dive'})))"` → 输出 `true true false` |
| t2 | `node --test test/goal.auto.test.js` → 全绿（含 TC-6…TC-12）；`grep -n "'goal'" src/goal.js` → 用户消息来源判定处**不再出现** `'goal'` 字面量（仅 goal 终态通路保留） |
| t3 | `node --test test/payload.test.js` → 全绿（含 TC-13…TC-16） |
| t4 | `node --test test/channels.feishu.test.js` → 全绿；`node -e` 打印 `buildCard(...).elements[0].fields` 的标签拼接 → stdout **不含** `类型`，且含 `会话` / `工作区` / `任务` / `时间` |
| t5 | `node --test test/client-render.test.js` → 全绿（含 TC-21…TC-23） |
| t6 | `node --test "test/*.test.js"` → `fail 0` 且 `tests ≥ 288`；`node --test test/e2e.local.test.js` → 全绿；报告含「基线 288 / 现状 N」两组数字与回滚路径（删 `src/source.js` + 还原 4 处） |

## 4. 迁移与兼容（单列说明，t6 验证）

| 维度 | 结论 | 验证方式 |
|---|---|---|
| 旧数据 | **无迁移**：不新增 / 不修改配置键，目标与绑定文件格式不动 | `test/targets.test.js` / `bindings*.test.js` 既有用例全绿 |
| 旧调用方 | RPC / Host Service 调用签名与返回不变 | `test/rpc.read.test.js` / `rpc.write.test.js` / `service*.test.js` 全绿 |
| 旧接收端 | 飞书卡片少一行「类型」；文本渠道报文**逐字节不变** | t4 断言 + `test/channels.cn.test.js` / `channels.global.test.js` 不动且全绿（TC-28） |
| 行为变化 | 注入轮不再推「对话完成」（本次目的）；中断照推 | t2 / t6 用例 |
| 回滚 | 删 `src/source.js` 并还原 `src/goal.js` / `src/payload.js` / `src/channels/feishu.js` / `client.js` 五处 → 回当前行为；无落盘需清理 | t6 报告记录 |

## 5. 覆盖对照（需求条款 ↔ 计划 key）

| 需求条款 | 覆盖说明 | 接收任务 |
|---|---|---|
| FR-1 | 判定口径纯函数 `isHumanSource` 与真值表 | t1 |
| FR-1 | 轮次接入：`GoalTracker` 把 dive / plugin 认成注入轮 | t2 |
| FR-2 | 完成意图静默、中断照推（链路口径） | t2 |
| FR-2 | 端到端锁死：注入轮 0 报文、注入轮报错仍叫 | t6 |
| FR-3 | `PromptTracker` 只认 direct human，注入正文不冒充「任务」 | t3 |
| FR-4 | 飞书卡片删掉与标题重复的「类型」行 | t4 |
| FR-4 | 设置页卡片预览与真卡片一致（纯文本区保留） | t5 |
| FR-5 | 回归（≥288 / fail 0）+ README 同步 + 验收报告 | t6 |

> 本轮**无「不做」条款**：FR-1…FR-5 全部有接收任务，不存在显式不做的功能点。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| DSH 未来用新 kind 表示真人输入 → 误静默 | 口径单点（`src/source.js`）；`logger.debug` 留痕；单测锁死；宁可漏推不刷屏 |
| 注入轮里人插话被误判 | `sawHuman` 兜住 + TC-9 锁死 |
| 客户端预览与 Host 卡片再次分叉 | 同一条判断 + TC-21/22 锁死 |
| 断言翻转被视为「改测试凑绿」 | 翻转点与理由写进 §1.2 与本表；新增断言（顺序、header、无按钮）只增不减 |
