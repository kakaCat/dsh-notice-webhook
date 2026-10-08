---
title: 架构设计 · 后台 job 运行中不再推「会话已完成」
requirement_refs: [REQ-261001202058-0fbe]
updated: 2026-10-01
---

# 架构设计

> **TL;DR**：在既有的「事件 → 意图 → 路由 → 投递」链路上**插入一个只读判定闸门**（`src/jobs.js`）：
> `turn/end` 判出完成意图后，先问 `ctx.jobs` 「本会话还有没有本轮拉起、尚未结算的 job」——
> 有则**不投递**并挂一条 pending；该批 job 全部结算且会话在宽限窗口内没开新轮次时**补发**一次。
> 出站契约、落盘数据、既有行为（无 job 服务时）一字不动。

## 1. 判定点迁移（serves: FR-1, FR-2）

```
   现状                                     本需求
   ────                                     ──────
   session/event                            session/event
      │                                        │
      ▼                                        ▼
   turn/end ──▶ classify ──▶ dispatch        turn/end ──▶ classify ──▶ ┌──────────────┐
   （"本轮结束" == "会话完成"）                                  │ job 闸门     │
                                                                │ 还有本轮 job？│
                                                                └──┬───────┬───┘
                                                             是 │       │ 否
                                                                ▼       ▼
                                                          pending    dispatch（不变）
                                                          （不投递）
                                                                │
                                              本批 job 全部结算 + 无新轮次（宽限窗口）
                                                                ▼
                                                          dispatch（补发一次）
```

**为什么把闸门放在 `classify` 之后、`dispatch` 之前**：

- 它只否决「完成」这一类意图，**不动**授权 / 提问 / goal 终态三条既有通路（接线位置见 interfaces §4）；
- 被否决时**不消耗冷却**（`router.commitCooldown` 在 `dispatch` 内部），与既有各种 `drop` 的语义一致；
- 补发复用**同一条** `dispatch`，因此渠道打包、加签、逐目标过滤、去重、冷却全部自动一致（FR-5）。

## 2. 模块改动地图（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/jobs.js` | **新增**：判定闸门（纯内存、无 I/O） | 判定规则与主链路分离，可离线单测（注入假 registry + 假时钟 + 假计时器） |
| `index.js` | 接线：建闸门、`ctx.inject(['jobs'])`、在 `handle()` 里插一步、`dispose` 清理；`deliverToTarget` 接受 `extra.prompt` | 入口只做接线（沿用既有分层纪律） |
| `src/config.js` | 新增 `jobAwareComplete`（默认 `true`，`.volatile()`） | 排障时一键回到旧行为（FR-4） |
| `src/classify.js` | **不改** | 分类只管「说什么」，不管「发不发」；闸门是路由前的一道否决 |
| `src/router.js` / `src/deliver.js` / `src/channels/**` / `client.js` | **不改** | 出站与界面与本需求无关（FR-5） |
| `docs/guides/operations.md` | `drop` 原因码表新增 `job-running` 一行 | 排障入口必须能解释「这条通知为什么没来」（FR-6） |

## 3. 关键流程（serves: FR-1, FR-3）

### 3.1 抑制（serves: FR-1）

```
turn/start(turn=7) ──▶ gate.noteTurnStart(sessionId)   // 记轮次起点 = clock()
tool/call bash(run_in_background:true) ──▶ ctx.jobs 注册 job（bash-3, running）
turn/end(completed) ──▶ classify → 完成意图
                       └─▶ gate.gate(session, intent, prompt)
                             ├─ list(sessionId) 过滤 owner/status/startedAt
                             ├─ 命中 bash-3 → pending{session, intent, prompt, watched:{bash-3}}
                             └─ 返回 { suppressed: true, jobIds: ['bash-3'] }
                       └─▶ handle 返回 { action:'dropped', reason:'job-running' }（不投递）
```

### 3.2 结算后的两条路（serves: FR-3）

```
job 结算（ctx.jobs 事件 settled / removed）
   │  watched 里删掉它；非空 → 什么都不做
   ▼  watched 空 → 起宽限计时器（默认 1500ms）
   │
   ├─ 宽限内该会话 turn/start（DSH 默认 completionDelivery='wakeup' 会唤醒 agent）
   │     └─▶ pending 被取消 → 补发不发生；这一新轮次自己的 turn/end 照常投递（恰好 1 条）
   │
   └─ 宽限到点仍无新轮次（completionDelivery='quiet' / 唤醒预算耗尽）
         └─▶ 用 pending 里存的 session + 意图 + prompt 调 dispatch → 补发 1 条「会话已完成」
```

**为什么必须有 3.2 的兜底**：DSH 的结算唤醒不是强保证（`completionDelivery` 可配 `quiet`，`maxConsecutiveWakes` 可耗尽），
没有它就会出现「只抑制、永远不通知」——比误报更糟。

## 4. 边界与状态机（serves: FR-3）

| 情形 | 行为 | 理由 |
|---|---|---|
| 宽限窗口内开新轮次 | 取消补发 | 避免与新轮次的完成通知重复 |
| 一轮拉起 N 个 job | 只有**全部**结算后才起计时器，补发**至多一次** | 「最后一个 job 结算」= 真的可以回来了 |
| job `killed` / `failed` / 记录被 `removed` | 与正常结算同等对待 | 都是终态；终态即「这活不再占着」 |
| job 永不结算（常驻） | pending 挂着，**不补发**；下一个 `turn/start` 或 `dispose` 清掉 | 「活还没完」就不该下完成的结论 |
| 同一会话连续多轮都拉起 job | pending 按会话覆盖（后写覆盖前写） | 同一会话同时只可能有一个待发结论 |
| 闸门判定异常 / `list` 抛错 | **照旧投递** + 一条 warn | 口径：宁可误报，不可漏报 |
| 插件 `dispose` | 取消计时器、注销监听、清 pending（幂等） | 不留悬挂计时器与引用 |

## 5. 依赖与降级（serves: FR-4）

```
apply(ctx) ──▶ ctx.inject(['jobs'], jobCtx => jobCtx.effect(() => gate.attach(jobCtx.jobs)))
                    │
                    ├─ 服务可用 + 形状合规（list 是函数、events.subscribe 是函数）
                    │     └─▶ available = true，订阅 { owners:'all' }
                    └─ 不可用 / 形状不符
                          └─▶ available = false（判定恒「不抑制」）+ 一条 warn（只说一次）
```

- **服务晚于本插件加载也生效**：Cordis 服务可用性驱动，`inject` 回调在就绪时才跑（与既有 `webServer` 接线同一模式）。
- **不 import DSH 内部包**：只按**形状**消费 `ctx.jobs`，因此本包依赖表不动、离线可单测（既有 30 个测试文件天然走降级路径）。

## 6. 迁移与回滚（serves: FR-4）

| 场景 | 行为 |
|---|---|
| 老配置不加任何键 | 启用新行为（这是缺陷修复，不额外藏开关） |
| 排障时怀疑误判 | 配置 `jobAwareComplete: false`（**热改，不用重启**）→ 逐字回到旧行为 |
| 组合里没有 job 服务 | 自动降级为旧行为 + 一条 warn |
| 彻底回滚 | 卸载本版本即可：**零落盘数据变更**，卸载即净 |
| 破坏性变更 | 无：出站 v1 契约、`targets.json` / `bindings.json` 格式、RPC、客户端接口全不动 |

## 7. 不变量（serves: FR-5）

| 不变量 | 为什么 |
|---|---|
| 出站报文形状与 `event` 取值集合不变（补发仍 `turn/end`） | 六渠道接收端与既有断言不能被本需求带歪 |
| `classify` 的意图判定与文案不变 | 本需求只管「发不发」，不管「说什么」 |
| `skipReasons` / `onlyTopLevel` / goal 自动轮静默 / 类型开关的**判定顺序**不变 | 它们先于闸门生效（闸门只在「本来要发」时介入） |
| `targets.json` / `bindings.json` / Outcome 投影不变 | 与 job 无关，不引入写放大 |
| 无 job 服务时逐条等于改动前行为 | 降级路径必须是**可回归**的（既有 241 条测试即回归网） |

## 8. 测试策略（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

- **注入四个缝**：`options.jobs`（假 registry）、`options.jobGraceMs`、`options.clock`（假时钟）、`options.timers`（假计时器）→ 宽限窗口与结算时序可**瞬时推进**，无真实等待。
- **净室单测**：`test/jobs-gate.test.js` 直接驱动 `createNotifier(...).handle(...)` + 假 registry 推事件，断言 `action/reason` 与本地 HTTP 接收端收到的报文（沿用 `e2e.local.test.js` 的接收端写法）。
- **回归网**：既有 30 个测试文件**天然不注入 `jobs`** → 自动覆盖「降级 = 旧行为」这条最重要的兼容路径。
- **既有测试的唯一改动**：`test/config.test.js` 的**测试标题文案**「恰好这 9 个」→「恰好这 10 个」（该用例断言的是 schema 的 volatile 集合与 `VOLATILE_KEYS` **相等**，两处同时加新键即通过；**零断言改动**）。
- 用例编号与 FR 对应见 [test-cases.md](test-cases.md)。

## 9. 遗留风险（明确记账，不静默）（serves: FR-3）

| 风险 | 边界 | 本次处置 |
|---|---|---|
| 宽限窗口（1500ms）内唤醒的 `turn/start` 来晚了 → 补发 + 新轮次完成通知**重复**一条 | 需要唤醒延迟 >1.5s 才发生；默认 `wakeup` 下 `turn/start` 在毫秒级 | 接受；窗口可由 `jobGraceMs` 调大（不新增界面配置） |
| `quiet` 模式下补发后，用户下次回来后那一轮结束还会再报一次完成 | 两次通知之间隔着**用户自己的动作**，语义上成立 | 接受 |
| 常驻 job 所在的那一轮永不补发 | 与「活还没完」语义一致 | 接受；FR-2 已保证常驻 job 不静音**后续**轮次 |
