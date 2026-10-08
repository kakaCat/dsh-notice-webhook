---
title: 拆分计划 · 完成闸门纳入 continuable 子代理
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
updated: 2026-10-05
---

# 拆分计划

> **目标**：让「会话已完成」只在**本会话真的没有活**时发出——除了既有的「本轮拉起、未结算的后台 job」，
> 还要算上「本会话仍在跑的 subagent 后代」（continuable 子代理**不注册 job**，现状是漏的）。
>
> **做法**：扩写既有闸门 `src/jobs.js`——判定源从一路（`ctx.jobs`）扩为两路（+ `ctx.agents.list()` 血统下钻），
> 结算信号从一路（job settled/removed）扩为两路（+ `ctx.on('subagent/end')` 触发复检）；
> pending / 宽限 / 兜底补发机制原样复用。不新增配置键、不新增落盘数据、不改出站报文、不动 DSH 源码。
>
> **一句话验收**：`node --test "test/*.test.js"` 退出码 0（基线 307 只增不减），
> 且新增用例覆盖「抑制 / 空闲或异血统不抑制 / 复检补发 / 多子代理与混合 / 降级与开关 / 报文零变化」。

## 1. 改动盘点（对照 5 份设计文档）

### 1.1 新增文件

| 文件 | 内容 | 规格来源 |
|---|---|---|
| `docs/requirements/REQ-261005120639-f801/tests/compat-report.md` | 回归与联调报告（降级路径证据、e2e 两条链路） | 本需求目录惯例 |

> 代码层面**无新增源文件**：改动全部落在既有模块里（这是本需求"改动面可控"的关键）。

### 1.2 修改文件

| 文件 | 改动 | 规格来源 |
|---|---|---|
| `src/jobs.js` | 新增 `isAgentRegistryLike()` / `liveSubagentIds()`；`createJobGate` 增 `subagents` / `attachSubagents()` / `detachSubagents()` / `observeSubagentEnd()` / `subagentsAvailable`；`gate()` 同时看两路并返回 `reason`/`subagentIds`；`maybeSettle` 抽出并加"子代理空闲"条件；pending 增 `subagentIds`；两路都空的诊断码 `no-jobs` → `no-work` | design/interfaces.md §1、design/data-model.md §2 |
| `index.js` | `createNotifier` 增 `options.subagents`；`ctx.inject(['agents'], …)` → `gate.attachSubagents`；`ctx.on('subagent/end', …)` → `gate.observeSubagentEnd()`；`handle()` 抑制分支返回 `verdict.reason` 与 `subagentIds`；`dispose()` 摘新接线 | design/interfaces.md §2 |
| `test/jobs-gate.test.js` | 新增假 `agents` 件与 TC-1…TC-11 用例；**仅 2 处**既有断言 `reason:'no-jobs'` → `'no-work'` | design/test-cases.md |
| `docs/guides/operations.md` | `drop` 原因码表新增 `subagent-running` / `work-running` 两行；`jobAwareComplete` 语义改述为「完成闸门」 | design/interfaces.md §5（FR-6） |
| `docs/architecture/project-manual.md`、`docs/architecture/index.md`、`docs/architecture/notification-plugin.md` | 口径从「后台 job 闸门」改述为「完成闸门（job + subagent 后代）」，补一句"continuable 子代理不注册 job" | design/architecture.md §文档口径纠正（FR-6） |
| `docs/requirements/REQ-261005120639-f801/verification.md` | 验收材料（实施完成后写） | — |

### 1.3 明确不改（写进不变量，回归靠既有测试）

`src/classify.js`（终态分类表）、`src/router.js`、`src/goal.js`、`src/payload.js`、`src/bindings.js`、
`src/targets.js`、`src/outcomes.js`、`src/rpc.js`、`src/deliver.js`、`src/channels/**`、`client.js`、
`src/config.js`（**不新增键**，D2）、`package.json`（**不新增依赖**）、
出站 v1 报文契约、`targets.json` / `bindings.json` 格式与版本、DSH 源码（**不动**）。

## 2. 任务表

| key | 标题 | phase | side | 依赖 | requirement_refs | 说明 |
|---|---|---|---|---|---|---|
| t1 | 判定层：闸门看两路活（job + subagent 后代） | implement | backend | — | FR-1, FR-3 | `src/jobs.js` 唯一改动点集中于此卡 |
| t2 | 接线层：`ctx.agents` 注入 + `subagent/end` 复检 | implement | backend | t1 | FR-1, FR-2, FR-4 | `index.js` 唯一改动点集中于此卡 |
| t3 | 测试与降级回归（含 2 处既有断言同步） | test | backend | t2 | FR-1, FR-2, FR-3, FR-4, FR-5 | 单列的兼容卡：证明降级 == 旧行为 |
| t4 | 文档口径：完成闸门 + 两个新原因码 | doc | doc | t2 | FR-6 | 四份文档同批改述 |
| t5 | 端到端联调：真 HTTP 接收端跑「抑制 → 复检 → 补发」 | test | backend | t3 | FR-2, FR-5 | 与 t3 串行，避免并发写同一测试文件 |

**依赖图**：

```
t1 ──▶ t2 ─┬─▶ t3 ──▶ t5
           └─▶ t4
```

**为什么这样切**：接口（t1）先行，接线（t2）依赖它；测试（t3）与文档（t4）在接线两侧互不依赖；
联调（t5）必须等测试卡把假件与断言固化了再串真接收端（两卡都写 `test/jobs-gate.test.js`，串行防冲突）。

### t1 判定层：闸门看两路活（job + subagent 后代）

- **implementation**：`src/jobs.js` —— 新增 `isAgentRegistryLike(agents)`（`typeof list === 'function'`）与
  `liveSubagentIds(agents, sessionId)`（血统 BFS + `origin==='subagent'` + `status==='running'`，`visited` 防环，
  形状不符/抛错返回 `null`）；`createJobGate` 增 `options.subagents`、`attachSubagents()`（形状不符 → 空 detach +
  一次 warn）、`detachSubagents()`、`observeSubagentEnd()`、`subagentsAvailable`；`gate()` 计算 `jobIds` 与
  `subagentIds`，两者都空返回 `{suppressed:false, reason:'no-work'}`，两路都不可用返回 `'unavailable'`（既有），
  有活返回 `{suppressed:true, reason:'job-running'|'subagent-running'|'work-running', jobIds, subagentIds}`；
  抽出 `maybeSettle(sessionId)`（`watched.size===0 ∧ liveSubagentIds 为空` → 起宽限），`observe()` 改为调用它；
  pending 增 `subagentIds`；`pendingOf` 快照带上它。
- **acceptance**：
  ```sh
  node --test test/jobs-gate.test.js   # 退出码 0
  ```
  断言覆盖：running 子代理 → `suppressed:true` + `reason:'subagent-running'` + `subagentIds`；
  仅 job → `reason:'job-running'`（逐字保留）；两者都有 → `'work-running'`；`idle` / 异血统 / 非 subagent origin / 脏条目 → `reason:'no-work'`；
  孙代计入、自指环不死循环；`attachSubagents({})` 与 `list()` 抛错不抛异常。
- **skipIntegration**：true（纯内存模块，无对外接口）。

### t2 接线层：`ctx.agents` 注入 + `subagent/end` 复检

- **implementation**：`index.js` —— `createNotifier` 增 `options.subagents`（生产由接线层传）；
  `handle()` 抑制分支返回 `{action:'dropped', reason: verdict.reason, intent, jobIds, subagentIds}`；
  `apply()` 增 `ctx.inject(['agents'], agentsCtx => agentsCtx.effect(() => runtime.gate.attachSubagents(agentsCtx.agents)))`
  与 `ctx.on('subagent/end', () => runtime.gate.observeSubagentEnd())`（try/catch 兜住）；
  `dispose()` 先摘 `offSubagentEnd` 再 `runtime.dispose()`。
- **acceptance**：
  ```sh
  node --test test/jobs-gate.test.js   # 退出码 0
  grep -n "subagent/end" index.js      # 命中接线与 dispose 两处
  ```
  接线层断言：注入假 `agents` 后 `handle(turn/end)` → `action:'dropped'`/`reason:'subagent-running'` 且接收端 0 条；
  子代理转 `idle` + `observeSubagentEnd()` + 推进宽限 → 接收端 **1** 条（与基线报文逐字段相等，忽略 `at`）；
  宽限内 `turn/start` → 0 条补发；`jobAwareComplete:false` 与不注入 `agents` → `action:'sent'`。
- **depends_on**：t1。

### t3 测试与降级回归（含 2 处既有断言同步）

- **implementation**：`test/jobs-gate.test.js` 增 `makeAgents(entries)` 假件与 TC-1…TC-11；
  把既有两处 `deepEqual(..., {suppressed:false, reason:'no-jobs'})` 改为 `'no-work'`（**这是本需求唯一触碰的既有断言**）；
  跑全量核对两条降级路径（不注入 `agents` / `jobAwareComplete:false`）与旧行为一致；
  结果写入 `docs/requirements/REQ-261005120639-f801/tests/compat-report.md`。
- **acceptance**：
  ```sh
  node --test "test/*.test.js"   # 退出码 0；fail 0；tests ≥ 基线 307（只增不减）
  grep -rn "no-jobs" test/ src/  # 期望 0 命中（诊断码已全部改名）
  ```
  报告逐条列出：唯一既有断言改动（2 处诊断码）、降级路径与旧行为等价的证据（用例名 + 断言）。
- **depends_on**：t2。
- **skipIntegration**：true（回归卡，不新增对外接口）。

### t4 文档口径：完成闸门 + 两个新原因码

- **implementation**：`docs/guides/operations.md` —— `drop` 原因码表补
  `subagent-running`（本会话仍有在跑的子代理）/ `work-running`（job 与子代理都有）；
  `jobAwareComplete` 一行改述为「完成闸门（后台 job + subagent 后代）总开关」；
  `docs/architecture/project-manual.md` 第三节、`docs/architecture/index.md`、`docs/architecture/notification-plugin.md`
  三处把"仅读 ctx.jobs"的旧口径改述为两路判定，并补一句 continuable 子代理不注册 job 的事实。
- **acceptance**：
  ```sh
  grep -rn "subagent-running\|work-running" docs/guides/operations.md   # 两行都在
  grep -rn "只读 ctx.jobs" docs/                                        # 期望 0 命中
  ```
- **depends_on**：t2。
- **skipIntegration**：true（文档卡）。

### t5 端到端联调：真 HTTP 接收端

- **implementation**：仿 `test/e2e.local.test.js` 起真实 HTTP 接收端，在 `test/jobs-gate.test.js` 串两条完整链路：
  ① `turn/start → 派子代理（running）→ turn/end`（0 条）→ 子代理 `idle` + `subagent/end` + 推进宽限（1 条，字段与基线一致）；
  ② 抑制后宽限内 `turn/start`（0 条补发）→ 新轮次 `turn/end`（1 条）。
  报告写入 `tests/e2e-report.md`。
- **acceptance**：
  ```sh
  node --test test/jobs-gate.test.js   # 退出码 0
  ```
  两条链路的接收端条数与字段断言逐条通过（含 `version:1` / `event:'turn/end'` / 完成文案）。
- **depends_on**：t3。

## 3. FR 覆盖对照

| 需求条款 | 条款内容 | 承接任务 | 验证落点 |
|---|---|---|---|
| FR-1 | 完成闸门把本会话在跑的 subagent 后代算作活 | t1, t2 | TC-1、TC-4、TC-5、e2e 链路 ① |
| FR-2 | 子代理结算后复检并兜底补发 | t2, t5 | TC-7、TC-8、UC-2/UC-3 + e2e 链路 ①② |
| FR-3 | 血缘与活体判定口径 | t1 | TC-2、TC-3、TC-6 |
| FR-4 | 开关与降级 | t2, t3 | TC-5、TC-8、TC-11 + 兼容报告 |
| FR-5 | 出站契约与既有报文不变 | t3, t5 | TC-9 + e2e 字段断言 |
| FR-6 | 可观测与文档口径纠正 | t1, t4 | TC-4、TC-10 + `docs/guides/operations.md` |

> 6 条条款全部有落点，无「本轮不做」项。

## 4. 容量自检（缺省 16 DU）

`detailUnits = files×1 + anchors×0.5 + chars/2000`：

| 卡 | files | anchors | chars | detailUnits | 判定 |
|---|---|---|---|---|---|
| t1 | 1 | 8 | 3000 | 6.5 | ✓ |
| t2 | 1 | 6 | 2000 | 5.0 | ✓ |
| t3 | 1 | 10 | 3000 | 7.5 | ✓ |
| t4 | 4 | 4 | 1500 | 6.75 | ✓ |
| t5 | 1 | 5 | 1500 | 4.25 | ✓ |

**无超容量卡**，不需要分批建议标签。

## 5. 风险与处置

| 风险 | 处置 |
|---|---|
| `agents.list()` 形状与预期漂移（DSH 升级） | 只读 `session.header.{parentSession,origin}` 与 `status`；形状不符即整路降级照发（FR-4），不会误抑制 |
| 子代理卡在审批上导致完成通知被长期压住 | 接受（这正是"还有活"的语义）；用户仍会收到该轮次的授权类通知吗——子代理的授权被 `onlyTopLevel` 过滤，属既有语义，本期不改（边界 1） |
| 宽限窗口内唤醒迟到 → 多一条通知 | 接受；沿用既有 1500ms 与 `turn/start` 取消机制 |
| `subagent/end` 事件缺失（组合里没有 subagent 运行时） | 该组合下压根没有子代理，闸门自然不抑制；复检只由事件触发，不引入轮询 |
| 诊断码改名影响排障习惯 | 仅内部诊断码（不进报文），`docs` 与测试同步更新；`job-running` 逐字保留 |

## 6. 整体验收命令

```sh
node --test test/jobs-gate.test.js      # 新增用例：全绿
grep -rn "no-jobs" test/ src/           # 0 命中（诊断码改名完成）
grep -rn "subagent-running" src/ docs/  # 代码 + 文档原因码两处命中
node --test "test/*.test.js"            # 全量：fail 0；tests ≥ 307（只增不减）
python3 docs/requirements/REQ-261005120639-f801/repro-continuable-window.py   # 现场口径复核（27 窗口）
```
