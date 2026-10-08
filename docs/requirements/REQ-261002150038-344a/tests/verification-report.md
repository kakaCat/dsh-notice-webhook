---
title: 回归与验收证据 · 通知去噪（REQ-261002150038-344a）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 回归与验收证据

> 跑法：`node --test "test/*.test.js"`（等价 `pnpm test`）。本仓库是纯 ESM JavaScript 包（无 `tsconfig.json`），
> **模板里的 `npx vitest run` / `npx tsc --noEmit` 不适用**——本仓的等价门禁就是 `node --test` 全量。

## 1. 数字对照

| 时点 | 用例数 | 通过 | 失败 |
|---|---|---|---|
| 改动前基线 | 288 | 288 | 0 |
| t1 后（新增 `test/source.test.js`） | 293 | 293 | 0 |
| t2/t3 后（goal.auto + payload 增例） | 304 | 304 | 0 |
| t4/t5 后（feishu 断言翻转 + 预览用例） | 305 | 305 | 0 |
| **t6 后（本报告时点，新增 2 条端到端）** | **307** | **307** | **0** |

**结论**：用例只增不减，失败 0。

## 2. 逐条命令与输出摘要

| # | 命令 | 结果 |
|---|---|---|
| 1 | `node --test test/source.test.js` | 5 passed / 0 failed（TC-1…TC-5 真值表） |
| 2 | `node --test test/goal.auto.test.js` | 13 passed / 0 failed（含新增 TC-6…TC-12） |
| 3 | `node --test test/payload.test.js` | 11 passed / 0 failed（含新增 TC-13…TC-16） |
| 4 | `node --test test/channels.feishu.test.js` | 7 passed / 0 failed（两处断言翻转 + 字段顺序断言） |
| 5 | `node --test test/client-render.test.js` | 19 passed / 0 failed（含 TC-21/22 与 template 边界） |
| 6 | `node --test test/client-render.test.js test/client-hooks.test.js test/client-service.test.js` | 42 passed / 0 failed（设置页整体装载） |
| 7 | `node --test test/e2e.local.test.js` | 6 passed / 0 failed（含新增 TC-24…TC-27） |
| 8 | `pnpm test`（全量） | **tests 307 / pass 307 / fail 0** |
| 9 | `node -e` 打印 `isHumanSource(undefined)/{kind:'user'}/{kind:'dive'}` | `true true false` |
| 10 | `grep -n "'goal'" src/goal.js src/payload.js src/source.js` | 只剩注释里的历史说明，**判定代码里不再出现** |

## 3. 行为证据（逐行对照设计）

| 对照对象 | 行数 | 偏离 | 证据 |
|---|---|---|---|
| `design/interfaces.md` §1 `isHumanSource` 真值表 | 14 | 0 | 一次性脚本逐行打印（缺失/非对象/数组/kind 缺失/`user`/`goal`/`dive`/`plugin`/未知 kind/非字符串 kind） |
| `design/interfaces.md` §2 轮次行为差异表 | 9 | 0 | `GoalTracker` + `Classifier` 真实流水线：三种注入轮静默、人插话照推、无消息轮不静默、`error`/`interrupted` 照推 |
| `design/interfaces.md` §3 「任务」口径 | 6 | 0 | `PromptTracker`：注入不记、`user` 与无 source 记、形状异常不记 |
| `design/interfaces.md` §4 飞书卡片字段集 | — | 0 | 真卡片报文：标题 `✅ 对话完成` / 配色 green / 字段 `会话 → 工作区 → 任务 → 时间`、JSON 无「类型」 |

**真实链路端到端**（`test/e2e.local.test.js` + 一次性联调脚本，均起真实本地 HTTP 接收端）：

1. Dive 注入轮 + `turn/end(completed)` → `handle()` 返回 `silent`，接收端 **0 条**（修复前：每轮 1 条）；
2. 同窗口人说一句话 + `completed` → **1 条**，正文含人的话、不含 Dive 注入正文；
3. Dive 注入轮 + `turn/end(error)` → **1 条**「会话异常中断」；
4. 飞书目标端到端 → 收到 `msg_type: 'interactive'` 卡片，卡片 JSON 不含「类型」，`任务` 字段照常渲染。

## 4. 不变量与边界核验

| 不变量 | 核验方式 | 结果 |
|---|---|---|
| 文本渠道报文零变化 | `test/channels.cn.test.js` / `channels.global.test.js` 一字未改且全绿；实跑企微报文仍含 `**类型**：✅ 对话完成` | 成立 |
| 不新增 / 不改配置键 | 未改 `src/config.js`；`test/config.test.js` 全绿 | 成立 |
| 落盘格式不动 | 未改 `src/targets.js` / `src/bindings.js`；相关用例全绿 | 成立 |
| 出站契约版本不动 | `PAYLOAD_VERSION` 仍为 `1`；`test/e2e.local.test.js` 断言 `version === 1` | 成立 |
| 口径单点 | `grep -rn "'user'" src/*.js` 只命中 `src/source.js`（`goal.js` 那一处是注释） | 成立 |
| 静默只挡完成 | 轮次行为差异表最后两行 + 端到端第 3 条 | 成立 |
| 交付方式 | Host 半（`src/*`、`index.js`）需重启 Host；`client.js` 刷新页面即可（无构建步骤） | 说明 |

## 5. 回滚路径

**代码（4 处 + 1 个新文件）**

1. 删除 `src/source.js`；
2. 还原 `src/goal.js`（`isHumanSource(...)` → `event.data?.source?.kind === 'goal'`、`sawInjected` → `sawGoal`）；
3. 还原 `src/payload.js`（同口径回退为只跳过 `kind === 'goal'`）；
4. 还原 `src/channels/feishu.js`（恢复正文「类型」行）与 `client.js`（去掉卡片区过滤与 `data-dnw-region`）。

**测试（必须一起回退，否则新断言会红）**

5. 删除 `test/source.test.js`；
6. 还原 `test/goal.auto.test.js`（去掉 TC-6…TC-12 与 `tracker` 导出）、`test/payload.test.js`（去掉 TC-13…TC-16）、
   `test/channels.feishu.test.js`（断言翻回去）、`test/client-render.test.js`（去掉 TC-21/22 与 `regionText`）、
   `test/e2e.local.test.js`（去掉 TC-24…TC-27）；
7. 文档（README 口径表、本需求目录）不参与运行时回滚。

**数据**：无落盘数据需要清理（本次零迁移）。回退后 `pnpm test` 应回到 **288 / 0** 基线。

## 6. 已知问题（如实登记）

- **`test/e2e.multi.test.js` 的并发偶发**：t1 阶段的首次全量跑出现 1 条超时
  （「五类事件按目标集合投递到渠道报文」等待投递结果 4/5）。该文件注释（第 110-112 行）本就记录过同款
  `4 !== 5`；单独复跑该文件 6/6 绿，其后 **4 次全量复跑均 307/0**。判定为既有的并发偶发，
  **非本次改动引入**（本次新增的 `test/source.test.js` 只是让并发度略升）。未修该文件（超出本需求范围）。
- 本报告时点的「真机观察」限于本地 HTTP 接收端；**真实飞书群/企微群未实测**（需重启 Host 后重配目标），
  与上一需求（REQ-261001203114-19b6）留下的同一限制一致。
