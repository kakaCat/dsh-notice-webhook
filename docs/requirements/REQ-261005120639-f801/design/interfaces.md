---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend]
---

# 接口设计：完成闸门（job + subagent 后代）

## 内部模块接口 · `src/jobs.js` <!-- serves: FR-1, FR-2, FR-3 -->

### 新增纯函数 <!-- serves: FR-1, FR-3 -->

```js
/**
 * 形状判定：满足 `list()` 才算可用的 agent 注册表。
 * 为什么按形状而不是构造器：本包零运行期依赖、不 import DSH 内部包。
 */
export function isAgentRegistryLike(agents): boolean

/**
 * 本会话仍在跑的 subagent 后代 id（只读、同步、不抛）。
 * @param agents  形状 `{ list() }` 的注册表（生产中 = ctx.agents）
 * @param sessionId 顶层会话 id
 * @returns string[] 命中的后代会话 id（去重，任意深度）
 *          null     = 注册表不可用 / list() 抛错 / 非数组（调用方按"该路不可用"处理）
 * 判定：血统可达 ∧ session.header.origin === 'subagent' ∧ status === 'running'
 */
export function liveSubagentIds(agents, sessionId): string[] | null
```

消费的条目形状（**只读这些字段，其余忽略**）：

```js
{ id: 'session-xxx',                  // 缺省时回落 session.header.id
  status: 'running' | 'idle' | …,     // 只认 'running'
  session: { header: { parentSession?: 'session-parent', origin?: 'subagent' } } }
```

### `createJobGate(options)` 增量 <!-- serves: FR-1, FR-2, FR-4 -->

```js
createJobGate({
  logger, graceMs, clock, setTimer, clearTimer, deliver,   // 既有，全部不变
  subagents,          // 新增（可选）：形状 { list() }；单测注入假件，生产由接线层传入
}) => {
  available,          // 既有：job 服务可用
  subagentsAvailable, // 新增：agent 注册表可用
  attach(registry), detach(),                              // 既有（job 事件订阅）
  attachSubagents(registry) => () => void,                 // 新增；形状不符 → 空函数 + 一次 warn
  detachSubagents(),                                       // 新增
  noteTurnStart(sessionId, at),                            // 既有不变
  gate(session, intent, prompt),                           // ↓ 返回扩展
  observe(event),                                          // 既有（job settled / removed）
  observeSubagentEnd() => number,                          // 新增：复检所有 pending，返回复检条数
  pendingOf(sessionId),                                    // ↓ 快照扩展
  dispose(),                                               // 既有 + 清理新增接线
}
```

### `gate()` 返回契约 <!-- serves: FR-1, FR-6 -->

| 情形 | 返回 |
|---|---|
| 两路事实源都不可用（无 job 服务 ∧ 无 agent 注册表） | `{ suppressed:false, reason:'unavailable' }`（既有语义不变） |
| 无会话 id / 无轮次起点 | `{ suppressed:false, reason:'no-turn-start' }`（既有语义不变） |
| 两路都空 | `{ suppressed:false, reason:'no-work' }` |
| 有活 | `{ suppressed:true, reason:'job-running' \| 'subagent-running' \| 'work-running', jobIds:string[], subagentIds:string[] }` |

- **不抑制时不带额外键**（保持既有 `deepEqual` 断言可写：`{suppressed:false, reason}`）。
- 诊断码 `'no-jobs'` → **重命名为 `'no-work'`**（`reason` 仅内部诊断/日志用，不进报文；
  两处既有断言同步更新）。`'job-running'` 在"只有 job"时**逐字保留**。
- `reason` 取值规则：只有 job 未结算 → `job-running`；只有子代理在跑 → `subagent-running`；两者都有 → `work-running`。

### 复检与补发契约（内部） <!-- serves: FR-2 -->

```js
maybeSettle(sessionId): void
// 条件：pending 存在 ∧ watched.size === 0（job 全结算）∧ liveSubagentIds(...) 为空
// 动作：起/重置宽限计时器；到点时 pending 仍在（期间无 turn/start）→ deliver(补发)
```

触发点：① `observe()` 收到该批 job 的终态；② `observeSubagentEnd()`（由接线层的 `subagent/end` 调用）。
`liveSubagentIds` 返回 `null`（不可用）⇒ 视同"无子代理"，允许补发（宁可补发，不可静默丢）。

## 接线接口 · `index.js` / `apply(ctx)` <!-- serves: FR-1, FR-2, FR-4 -->

```js
// 与既有 ctx.inject(['jobs']) 同一模式：服务就绪才接线，effect 负责回收
ctx.inject(['agents'], agentsCtx => {
  agentsCtx?.effect?.(() => runtime.gate.attachSubagents(agentsCtx.agents))
})

// 结算信号：普通（emit 模式）Cordis 事件，不是 waterfall → 不需要 next() 放行
const offSubagentEnd = ctx.on('subagent/end', () => {
  try { runtime.gate.observeSubagentEnd() } catch (error) { logger?.warn?.(…) }   // 通知插件绝不搞崩会话
})
```

- `createNotifier(rawConfig, options)` 增 `options.subagents`（单测注入假件，与 `options.jobs` 对称）。
- `handle()` 的抑制分支：`return { action:'dropped', reason: verdict.reason, intent, jobIds: verdict.jobIds, subagentIds: verdict.subagentIds }`。
- `apply()` 的 `dispose()`：先摘 `offSubagentEnd`，再 `runtime.dispose()`（与既有摘线顺序一致）。

**事件契约（消费，不产生）**：`subagent/end` 的载荷首参 `info = { runId, provider, id, local, stopReason? }`，
本插件**只用不到**它的字段——复检按会话拉取，不依赖事件归因（见 architecture §结算与兜底补发时序）。

## 配置契约 <!-- serves: FR-4 -->

| 键 | 类型 | 默认 | volatile | 语义变化 |
|---|---|---|---|---|
| `jobAwareComplete` | boolean | `true` | 是（不变） | **无新增键**；语义从「后台 job 感知」扩写为「完成闸门总开关 = 后台 job + subagent 后代」 |

- 非法值回落 `true` + 一条 warn（沿用 `normalizeConfig` 既有口径，**不改代码**）。
- 客户端设置页不暴露该键（现状即如此），**无 UI 改动**。

## 出站契约 <!-- serves: FR-5 -->

**零改动**：`version: 1`；`event` 仍为 `turn/end` / `turn/error` / `approval/asked` / `ask_user_question`；
字段集合与含义不变；补发与直接投递逐字段一致（仅 `at` 时间戳不同）。**不新增事件取值**。

## 观测契约 · `drop` 原因码与日志 <!-- serves: FR-6 -->

| 原因码 | 含义 | 载荷 |
|---|---|---|
| `job-running` | 本会话仍有**本轮拉起、尚未结算**的后台 job（**语义与既有逐字一致**） | `jobIds` |
| `subagent-running`（新） | 本会话仍有 `running` 的 subagent 后代 | `subagentIds` |
| `work-running`（新） | 两者都有 | `jobIds` + `subagentIds` |

日志：抑制记 debug（含 id 列表）；补发记 info（含被压住的 id）；降级/异常各一条 warn（含原因，只报一次）。
日志**不含**子代理输出正文、不含密钥。

## 错误语义表 <!-- serves: FR-4 -->

| 情况 | 处理 |
|---|---|
| `agents` 服务缺失 | `attachSubagents` 不接；`gate()` 该路视空；一条 warn（只报一次） |
| `agents.list` 不是函数 / `agents` 是 `{list:'x'}` | 同上（形状不符） |
| `agents.list()` 抛错 | 该次判定把子代理路视为空 + warn；**不影响 job 路**，也不抛给会话 |
| `agents.list()` 返回非数组 | 同上 |
| 条目缺 `session.header` / `status` 未知值 | 跳过该条目（保守：不计入活动） |
| `subagent/end` 监听回调抛错 | 接线层 try/catch 兜住 + warn（既有纪律：通知插件绝不搞崩会话） |
