---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend]
---

# 架构设计：完成闸门把 continuable 子代理算作活（REQ-261005120639-f801）

> **TL;DR**：把既有的「后台 job 闸门」**推广**为「完成闸门」——判定源从一路（`ctx.jobs`）变成两路
> （`ctx.jobs` + `ctx.agents.list()` 的 subagent 后代），结算信号从一路（job settled/removed）变成两路
> （+ `ctx.on('subagent/end')`）；**pending / 宽限 / 兜底补发机制原样复用**。
> 出站契约、落盘数据、开关键、`classify.js` 一字不动；新增只读、同步、可降级。

## 目标与总体方案 <!-- serves: FR-1, FR-2 -->

一句话：`turn/end(completed)` 只是「这一轮结束了」，**不是**「会话完成了」；
本设计让闸门在这个问题上多看一路事实——「本会话还有没有在跑的子代理后代」。

不改的东西（累积约束）：`classify → goal → 闸门 → dispatch` 的判定顺序、只否决「完成」一类意图、
`onlyTopLevel` 对子会话事件的过滤、`jobAwareComplete` 这个开关键、v1 出站报文。

## 模块改动地图 <!-- serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6 -->

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/jobs.js` | **扩写**：新增 `isAgentRegistryLike()` / `liveSubagentIds()` 两个纯函数；`createJobGate` 增 `options.subagents`、`attachSubagents()`、`observeSubagentEnd()`；`gate()` 同时看两路；pending 增 `subagentIds`；`armGrace` 增一条子代理空闲条件 | 判定逻辑留在同一模块（一处内存状态、一处宽限计时器）；纯函数可离线单测 |
| `index.js` | **接线**：`ctx.inject(['agents'], …)` → `gate.attachSubagents`；`ctx.on('subagent/end', …)` → `gate.observeSubagentEnd()`；`handle()` 的抑制分支带上 `verdict.reason` 与 `subagentIds`；`dispose` 摘线 | 入口只做接线（沿用既有分层纪律） |
| `src/config.js` | **不改**（仅注释口径：`jobAwareComplete` = 完成闸门总开关） | D2：不新增配置键；开关语义扩写不改变 schema |
| `src/classify.js` | **不改** | 终态分类表与子代理判定无关 |
| `src/router.js` / `src/deliver.js` / `src/channels/**` / `client.js` | **不改** | 稳定契约（FR-5） |
| `docs/guides/operations.md` | `drop` 原因码表补 `subagent-running` / `work-running` 两行 | 排障要能解释「这条通知为什么没来」（FR-6） |
| `docs/architecture/project-manual.md`、`index.md`、`notification-plugin.md` | 口径从「后台 job 闸门」改述为「完成闸门（后台 job + subagent 后代）」，写明 continuable 子代理**不注册 job** | 口径与实现漂移是本需求暴露出来的问题（FR-6） |

## 判定链与插入点 <!-- serves: FR-1, FR-5 -->

```
session/event → prompts.observe → goals.observe → classify
                                                   │ 完成意图 且 jobAwareComplete
                                                   ▼
                                     ┌───────────────────────────────┐
                                     │ 完成闸门 gate()               │
                                     │  ① ctx.jobs.list(sessionId)    │← 既有（本轮拉起的未结算 job）
                                     │  ② agents.list() 血缘下钻       │← 新增（本会话 running 子代理后代）
                                     └──┬──────────────────────┬─────┘
                                     有 │                      │ 都空
                                        ▼                      ▼
                                  pending（不投递）        dispatch（不变）
                                        │
                    两路都空 + 宽限窗口内无新轮次（job settled / subagent/end 触发复检）
                                        ▼
                                  dispatch（补发一次）
```

**为什么闸门仍放在 `dispatch` 之前**：与既有一致——被否决时不消耗冷却（`commitCooldown` 在 `dispatch` 内部），
补发复用同一条 `dispatch`，渠道打包 / 加签 / 逐目标过滤 / 冷却全部自动一致（FR-5）。

## 血缘与活体口径 <!-- serves: FR-3 -->

`liveSubagentIds(agents, sessionId)` 的判定（三条同时成立才算「本会话的活」）：

1. **血统**：从 `sessionId` 出发，沿条目 `session.header.parentSession` 逐层下钻可达（任意深度，`visited` 防环）；
2. **来源**：`session.header.origin === 'subagent'`（普通 fork / 派生窗口只共享血统字段、不带 origin，**不得**压住源会话）；
3. **活体**：`status === 'running'`（`idle` = 没有驱动在跑；continuable 子代理空闲常驻时是 `idle`）。

与 DSH 自身的 `runningDescendants`（`packages/subagent/subagent/src/archive-admission.ts`）**逐条同口径**，
避免出现「DSH 说还有活、插件说没活」。

**为什么不做轮次过滤**（D1）：job 可以是永久进程（dev server），所以既有闸门必须按 `turn/start` 限轮次；
子代理的活**有界且必然结算**，不存在永久静音；按轮次过滤还会漏掉「本轮 `send_message` 唤醒既有子代理」这一类。

## 结算与兜底补发时序 <!-- serves: FR-2 -->

```
turn/start(S)            → gate.noteTurnStart(S)                 // 既有：记轮次起点、作废上一条 pending
subagent_fork(...)       → 子代理建立，status=running（无 job）
turn/end(completed)      → gate()：jobIds=[]、subagentIds=[child] → 不投递，pending(S)
subagent/end(child)      → gate.observeSubagentEnd() → 复检 S：watched 空 ∧ 无 running 后代
                            ├─ 有 → 继续挂起（多子代理 / 多 epoch）
                            └─ 无 → 起宽限计时器（默认 1500ms）
turn/start(S)（被唤醒）   → cancelPending(S)                     // 新轮次自己会正常通知
计时器到点且 pending 仍在 → dispatch(补发一次)
```

关键取舍：**复检是"拉"、结算信号是"推"**——存活状态每次现查 `agents.list()`（不需要跟踪 epoch），
`subagent/end` 只负责"该复检了"这个时机；这样即使漏掉某个 epoch 事件，也不会有错误的存活判断。

## 降级、开关与回滚 <!-- serves: FR-4 -->

| 情形 | 行为 |
|---|---|
| `jobAwareComplete: false`（volatile，热改） | 闸门整条不生效：job 与子代理都不抑制、不补发 → 逐条回到旧行为 |
| 无 `agents` 服务 / 形状不符（缺 `list`） | 子代理这一路**不判定**（照发）+ 一条 warn（只报一次）；job 那一路照旧 |
| `agents.list()` 抛错 / 非数组 | 本次不抑制（照发）+ 一条 warn；pending 若已存在则按"无子代理"推进（宁可补发，不可静默丢） |
| 插件卸载 | `dispose` 清 pending + 计时器；`ctx.on('subagent/end')` 与 `ctx.inject(['agents'])` 的 effect 各自回收 |

**回滚路径**：改配置一键回旧行为；代码回滚只需回退 `src/jobs.js` + `index.js` 两处，无落盘数据需要回填。

## 被否决的备选 <!-- serves: FR-1, FR-3 -->

| 备选 | 否决理由 |
|---|---|
| 让 DSH 把 continuable 子代理也注册成 job | 要改 DSH 源码（本需求边界 3）；且 job 语义是"收集结果的任务"，continuable 子代理是"常驻子会话"，语义不符 |
| 用 `workspace/session-activity` waterfall 一次问「还有活吗」 | 它的 `turn` 家族在 `turn/end` 时序内可能仍报活动（事件正在 append），会把完成通知**永久压住**；异步 waterfall 也违反"判定不阻塞" |
| 用 `subagent/start` / `subagent/end` 计数（不查 `agents.list()`） | 需要把 runId 归因到父会话（事件只带子会话 id），要额外维护 child→parent 映射；漏事件会永久卡住 pending |
| 按 `turn/start` 过滤子代理（只算本轮拉起的） | 见 D1；且实现复杂、会漏 `send_message` 唤醒既有子代理的场景 |
| 新增 `subagentAwareComplete` 独立开关 | 回滚要关两个开关；产品语义只有一个（D2） |

## 不变量 <!-- serves: FR-5 -->

- 只读：只用 `agents.list()` 与 `ctx.on('subagent/end')`，**从不** `cancel` / `kill` / `followup` 任何子代理或 job；
- 同步：闸门判定不引入 `await`，不阻塞会话（`agents.list()` 是同步 API）；
- 无出站变化：`version` 仍 `1`，`event` 仍 `turn/end`，字段集合与含义不变；
- 无落盘变化：无新文件、无 schema 变更、无存储版本变更；
- 失败一律向"照发"降级：任何异常都不许让完成通知永久消失。

## 文档口径纠正 <!-- serves: FR-6 -->

三处把「后台 job 闸门」改述为「完成闸门（后台 job + subagent 后代）」，并各补一句事实：
**continuable 子代理不注册 job**，所以闸门除了 `ctx.jobs` 还要看 `ctx.agents`。
`docs/guides/operations.md` 的 `drop` 原因码表新增 `subagent-running`（仅子代理）与 `work-running`（两者都有）。
