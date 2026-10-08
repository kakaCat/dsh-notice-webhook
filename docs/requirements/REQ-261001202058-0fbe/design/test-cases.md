---
title: 测试用例 · 后台 job 运行中不再推「会话已完成」
requirement_refs: [REQ-261001202058-0fbe]
updated: 2026-10-01
---

# 测试用例

> **TL;DR**：21 条用例，新增一个净室文件 `test/jobs-gate.test.js`（假 registry + 假时钟 + 假计时器，**零真实等待**）；
> 既有 30 个测试文件**天然不注入 `jobs`**，正好覆盖「降级 = 旧行为」这条最重要的回归路径。

## 1. 注入缝与假件（serves: FR-1, FR-2, FR-3, FR-4, FR-6）

| 用例 | 断言（可执行） |
|---|---|
| TC-1 | `test/jobs-gate.test.js`：`createNotifier({}, { jobs: fakeRegistry(), clock, timers, jobGraceMs:10 })` → `runtime.gate.available === true`；`fakeRegistry()` 提供 `list(caller)`（按 `owner===caller \|\| owner===undefined` 过滤，返回**副本**）与 `events.subscribe`，并有测试侧 `settle(id)` / `remove(id)` 助手 |
| TC-2 | 形状不符（`{}` / `{ list(){} }` / `{ events:{} }`）→ `available === false`，`logger.warn` **恰好 1 条**（重复 `attach` 不重复告警）；`gate()` 返回 `{suppressed:false, reason:'unavailable'}` |

## 2. 抑制：未结算不推（serves: FR-1）

| 用例 | 断言（可执行） |
|---|---|
| TC-3 | `handle(turn/start)` → `handle(turn/end, completed)`，registry 里有 `{owner:'s1', status:'running', startedAt:1100}` → 返回 `{action:'dropped', reason:'job-running', jobIds:['bash-1']}`，接收端 **0** 条 |
| TC-4 | 同场景但 job 的 `owner` 是**别的会话**（或 `owner` 缺省的无主 job）→ `action:'sent'`，接收端 1 条 |
| TC-5 | 同场景但 job `status:'completed'`（已结算未摘记录）→ `action:'sent'` |
| TC-6 | `stopping`（正在杀）也参与抑制 → `action:'dropped'` |

## 3. 只算本轮拉起（serves: FR-2）

| 用例 | 断言（可执行） |
|---|---|
| TC-7 | `turn/start@1000`，job `startedAt:900`（常驻 job，早于本轮）→ `action:'sent'`（**常驻 job 不静音该会话**） |
| TC-8 | 只有 `turn/end`、没有 `turn/start`（插件晚加载）→ `action:'sent'`；`gate()` 的 `reason` 为 `'no-turn-start'`（保守取向） |
| TC-9 | `startedAt === since`（同毫秒边界）→ `action:'dropped'`（判定含等号） |

## 4. 结算后兜底补发（serves: FR-3）

| 用例 | 断言（可执行） |
|---|---|
| TC-10 | TC-3 之后 `fake.settle('bash-1')` → 计时器被登记；推进 `jobGraceMs` → 接收端**恰好 1** 条，且与「无 job 同场景」的基线报文**逐字段相等**（忽略 `at`） |
| TC-11 | 抑制后 `settle`，宽限窗口内 `handle(turn/start)` → 推进计时器 → **0** 条补发；随后该新轮次的 `turn/end` → **1** 条（`action:'sent'`） |
| TC-12 | 一轮拉起 2 个 job：先 `settle` 其一 → 0 条且无计时器；再 `settle` 第二个 + 推进 → **恰好 1** 条 |
| TC-13 | 以 `killed` 结算、或事件为 `removed` → 与 TC-10 结果一致（终态等价） |
| TC-14 | `settle` 后**不**推进计时器 → 0 条；`runtime.dispose()` 后再推进 → 仍 0 条且无未捕获异常（无悬挂计时器） |

## 5. 开关与降级（serves: FR-4）

| 用例 | 断言（可执行） |
|---|---|
| TC-15 | `jobAwareComplete:false` + 有本轮 running job → `action:'sent'`（逐条等于改动前行为） |
| TC-16 | **不注入 `jobs`** + 有 running job → `action:'sent'` + 1 条降级 warn；`node --test "test/*.test.js"` 全绿（既有 241 条全部走此路径） |
| TC-17 | `normalizeConfig({ jobAwareComplete:'yes' })` → 回落 `true` 且 warn；`Config({})` 默认 `true`、列入 volatile 集合（`test/config.test.js` 既有集合断言继续通过，**仅测试标题文案 9→10**） |

## 6. 契约不回归（serves: FR-5）

| 用例 | 断言（可执行） |
|---|---|
| TC-18 | 补发报文与直接投递报文逐字段相等：`version/event/message/title/toolName/goal/sessionId/workspace/source`（忽略 `at`） |
| TC-19 | 补发时「你说了什么」= **被抑制那一轮**捕获的 prompt（此时 `prompts.clear(session)` 已执行，取到值即证明走的是捕获路径） |
| TC-20 | `node --test test/compat.test.js test/compat.v2.test.js test/compat.v3.test.js test/e2e.local.test.js test/e2e.multi.test.js` 全绿（出站/路由/绑定零回归） |

## 7. 可观测（serves: FR-6）

| 用例 | 断言（可执行） |
|---|---|
| TC-21 | 抑制时 `logger.debug` 文案含 `job-running` 与 job id；补发时 `logger.info` 有一条补发记录（用假 logger 收集） |
| TC-22 | `grep -n 'job-running' docs/guides/operations.md` 命中（`drop` 原因码表已补行） |

## 8. 用例与 FR 的对应（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| FR | 用例 |
|---|---|
| FR-1 | TC-3, TC-4, TC-5, TC-6 |
| FR-2 | TC-7, TC-8, TC-9 |
| FR-3 | TC-10, TC-11, TC-12, TC-13, TC-14 |
| FR-4 | TC-1, TC-2, TC-15, TC-16, TC-17 |
| FR-5 | TC-18, TC-19, TC-20 |
| FR-6 | TC-21, TC-22 |

## 9. 验收命令与期望输出（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

```sh
node --test test/jobs-gate.test.js     # 新增用例：全绿（约 22 条断言组）
node --test "test/*.test.js"           # 全量：fail 0；总数 ≥ 基线 241（只增不减）
```

**改动前基线（本次已实测）**：`tests 241 / pass 241 / fail 0 / duration ≈ 3.9s`。

**既有测试的唯一改动**：`test/config.test.js:35` 的**测试标题文案**「恰好这 9 个」→「恰好这 10 个」（`assert.deepEqual` 的两侧同时新增该键即通过，**零断言改动、零行为迁就**）。
