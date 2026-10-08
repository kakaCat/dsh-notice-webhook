---
title: 接口设计 · 后台 job 运行中不再推「会话已完成」
requirement_refs: [REQ-261001202058-0fbe]
updated: 2026-10-01
---

# 接口设计

> **TL;DR**：对外**新增一个可选依赖** `ctx.jobs`（只读两个方法）；对内新增一个判定模块 `src/jobs.js`
> 与四个可选注入缝（假 registry / 宽限窗口 / 时钟 / 计时器）。**出站报文契约零变化**，
> 唯一的新增配置是 `jobAwareComplete`（boolean，默认 `true`，volatile）。

## 1. 消费的 DSH 契约 `ctx.jobs`（serves: FR-1, FR-3）

| 用到的方法 | 签名 | 本插件依赖的语义 |
|---|---|---|
| `list(caller)` | `(caller?: SessionId) => JobView[]` | 返回**调用方可见**的 job 投影（自己的 + 无主的），**不改游标**、返回的是**快照副本** |
| `events.subscribe(filter, cb)` | `({ owners:'all' }, (event: JobEvent) => void) => () => void` | effect 作用域监听；同步派发；返回 disposer |

**用到的 `JobView` 字段**：`id` / `kind` / `owner` / `status` / `startedAt` / `finishedAt`。
**用到的 `JobEvent` 形态**：`{ type:'settled', job, cause, awaited }`、`{ type:'removed', job }`；
其余（`registered` / `progress` / `stopping` / `output`）一律忽略——注意 `output` 事件**没有 `job` 字段**，读取前必须判空。

**形状校验（降级的唯一依据）**：

```js
const ok = typeof jobs?.list === 'function' && typeof jobs?.events?.subscribe === 'function'
```

- `ok === false` → 不接线、`available = false`、**判定恒「不抑制」**、一条 warn（只报一次）。
- 任一调用抛错 → 该次判定按「不抑制」处理 + 一条 warn；事件回调内的异常一律吞掉（绝不影响 job 结算本身）。

> **不 import `@deepseek-ai/dsh-jobs`**：只按上述形状消费，保证 `package.json` 依赖表不动、离线可单测。

## 2. 新增模块 `src/jobs.js`（serves: FR-1, FR-2, FR-3, FR-6）

```js
export const DEFAULT_JOB_GRACE_MS = 1500

/** 形状校验：满足 list + events.subscribe 才算可用。 */
export function isJobRegistryLike(jobs): boolean

/**
 * @param options.logger            记日志（warn/debug/info 可选）
 * @param options.graceMs           结算后的宽限窗口，默认 DEFAULT_JOB_GRACE_MS
 * @param options.clock             () => number，默认 Date.now（单测注入假时钟）
 * @param options.setTimer          (fn, ms) => handle，默认 setTimeout
 * @param options.clearTimer        (handle) => void，默认 clearTimeout
 * @param options.deliver           (session, intent, meta) => void，补发动作（由 index.js 接到 dispatch）
 * @returns 闸门对象（见下表）
 */
export function createJobGate(options = {}): JobGate
```

| 成员 | 签名 | 返回 / 语义 | 错误语义 |
|---|---|---|---|
| `available` | `get available(): boolean` | 是否已接上合规的 job 服务 | 永不抛 |
| `attach` | `(jobs) => () => void` | 订阅 `{ owners:'all' }`；返回 detach。**幂等**：重复 attach 先 detach 旧的 | 形状不符 → 返回空函数 + warn |
| `detach` | `() => void` | 注销订阅（幂等） | 永不抛 |
| `noteTurnStart` | `(sessionId, at?) => void` | 记该会话轮次起点；**并取消该会话的 pending**（新轮次 = 上一个结论作废） | 忽略空 `sessionId` |
| `gate` | `(session, intent, prompt) => { suppressed, jobIds, reason? }` | 判定是否抑制；命中时登记 pending | 内部异常 → `{suppressed:false, reason:'error'}` + warn |
| `observe` | `(event) => void` | job 事件入口（订阅回调即它）：`settled`/`removed` → 从 watched 摘除；watched 空 → 起宽限计时器 | 事件畸形 / 无 `job` → 直接返回；异常吞掉 + warn |
| `pendingOf` | `(sessionId) => record \| undefined` | 只读快照，供单测与排障 | 永不抛 |
| `dispose` | `() => void` | 清计时器、detach、清 pending（幂等） | 永不抛 |

**`gate()` 的 `reason` 取值**（供测试与日志区分，**不进** `handle` 的返回值）：

| reason | 含义 |
|---|---|
| `no-jobs` | 本会话没有符合 FR-2 条件的 live job → 不抑制 |
| `no-turn-start` | 没见过该会话的 `turn/start`（插件晚加载等）→ **保守不抑制** |
| `unavailable` | 没有合规的 job 服务（FR-4 降级） |
| `error` | 判定过程出错 → 保守不抑制 |

## 3. `createNotifier` 选项扩展（serves: FR-3, FR-4）

```js
createNotifier(rawConfig, {
  logger, targets, bindings, outcomes, resolveSecret,   // 既有
  jobs,          // 【新】JobRegistry 形状；缺省 = 降级（既有测试即走此路）
  jobGraceMs,    // 【新】正整数，默认 1500
  clock,         // 【新】() => number，默认 Date.now
  timers,        // 【新】{ setTimer, clearTimer }，默认全局计时器
})
```

- 返回值**新增** `dispose()`：闸门清理（幂等）。既有返回字段（`config/targets/bindings/outcomes/service/rpcHandler/handle/dispatch/handleExternalQuestion/revision/store`）一个不动。
- `jobs` 也可在运行时由 `apply(ctx)` 通过 `ctx.inject(['jobs'])` 后调 `runtime.gate.attach(jobs)` 接上（两条路径等价；见 §7）。

## 4. `handle()` 的返回契约变化（serves: FR-1, FR-6）

| 场景 | 返回值 | 变化 |
|---|---|---|
| 完成意图 + 本轮有未结算 job | `{ action:'dropped', reason:'job-running', intent, jobIds:[…] }` | **新增**（此前会 `sent`） |
| 完成意图 + 无本轮 job | `{ action:'sent', … }` | 不变 |
| goal 自动轮（`autoRound`） | `{ action:'silent', intent }` | 不变：**静默轮不建 pending**（它本来就不该叫醒人） |
| goal 终态 / 授权 / 提问 | 各自既有路径 | 不变（闸门不介入） |
| 无 job 服务 / 开关关闭 | 与改动前逐条一致 | 不变 |

判定顺序（**不可换位**）：`prompts.observe` → `goals.observe` → `classify` → goal 终态 → `classify===null` → 自动轮静默 →
**job 闸门** → `dispatch` → `prompts.clear`。

> `job-running` 必须补进 `docs/guides/operations.md` 的 `drop` 原因码表（FR-6）。

## 5. 配置项契约（serves: FR-4）

| 键 | 类型 | 默认 | 可热改 | 校验 / 回落 |
|---|---|---|---|---|
| `jobAwareComplete` | boolean | `true` | ✅（`.volatile()`） | 非 boolean → 回落 `true` + warn（`normalizeConfig` 既有口径） |

- 需同时登记在 `DEFAULTS`、`BOOLEAN_KEYS`、`Config` schema（`.default(true).volatile()`）、`VOLATILE_KEYS` 四处；
  `test/config.test.js` 的集合断言（schema volatile 集合 == `VOLATILE_KEYS`）因此仍然成立，**零断言改动**。
- **不新增** RPC 字段、**不新增**界面控件（本需求 `sides: [backend]`；改值走插件配置）。

## 6. 出站报文（插件 → 接收端）（serves: FR-5）

**完全不变**：`version: 1`；补发仍以 `event: 'turn/end'` 出站；字段集合、渠道请求体形状、加签口径、业务码判定一字不动。

```json
{ "version": 1, "event": "turn/end", "message": "标题 · 会话已完成", "title": "标题",
  "toolName": null, "goal": null, "sessionId": "…", "workspace": "…", "at": "…", "source": "…" }
```

**补发与直接投递的唯一差别在「什么时候发」**，不在「发什么」：两者都走 `dispatch → deliverToTarget → channelBuildRequest`。
补发时「你说了什么」沿用**被抑制那一轮**捕获的 prompt（`extra.prompt` 透传）——否则 `prompts.clear(session)` 已把该轮输入清掉，报文会缺这一行。

## 7. `apply(ctx)` 接线（serves: FR-4）

```js
// 与既有 webServer 接线同一模式：服务就绪才跑回调，effect 负责回收
const offJobs = typeof ctx?.inject === 'function'
  ? ctx.inject(['jobs'], jobCtx => { jobCtx?.effect?.(() => runtime.gate.attach(jobCtx.jobs)) })
  : undefined
```

- `jobs` 服务**晚于**本插件加载也生效（Cordis 服务可用性驱动）。
- `dispose` 里：`offJobs?.()` → `runtime.gate.detach()` → `runtime.dispose()` → 既有 `offEvent` / `offQuestions` / `disposeService`。
  顺序要求：**先注销监听与计时器，再清理状态**（避免回调重入）。

## 8. 日志契约（serves: FR-6）

| 时机 | 级别 | 内容要点 |
|---|---|---|
| 接不上 job 服务 | `warn` | 只报一次：`jobs 服务不可用或形状不符，完成通知不做后台 job 判定（降级为旧行为）` |
| 抑制一条完成通知 | `debug` | `sessionId` + 被抑制的 `jobIds` 列表（kind/status 可带，**不带 job 输出**） |
| 补发一条完成通知 | `info` | `sessionId` + 本轮 job 数 / 最后一个 job 的 id |
| 判定或事件回调异常 | `warn` | 异常摘要（cookie 口径同既有：不带密钥、不带 URL query） |

**任何日志都不得包含**：job 输出正文、webhook 地址的 query、密钥明文。
