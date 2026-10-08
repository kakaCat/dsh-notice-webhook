---
title: 接口设计 · 会话异常中断通知（turn/end 按 reason 分类）
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 接口设计

> **TL;DR**：对内新增两个导出常量、三个纯函数，扩展一个意图形状与一个决策返回；对外（接收端）新增 `event` 取值 `turn/error`
> 与两个追加式字段 `reason` / `error`（`version` 仍 `1`）；配置新增 `notifyInterrupt` / `interruptMessage`，`skipReasons` 默认值变更；
> 目标记录追加一个可选字段 `eventsMode`。**非中断意图的报文与既有 RPC 形状一字不动**。

## 1. `Classifier.classify()` 的输出契约（serves: FR-1, FR-2）

```js
// 既有：不变
null                                                        // 不推送（静默 / 非目标事件）
{ kind: 'complete',  event: 'turn/end',    message, toolName: null }
{ kind: 'approval',  event: 'approval/asked',      message, toolName }
{ kind: 'question',  event: 'ask_user_question',   message, toolName: null }

// 新增：中断意图
{ kind: 'interrupt', event: 'turn/error',  message, toolName: null,
  reason: <string>,                        // 归一化后的终态：'error' | 'interrupted' | 未知 kind 原文 | 'unknown'
  error: { code: string, message: string } | null }
```

- `message`（FR-2）：`标题 · <interruptMessage><短原因>`；`includeTitle === false` 或无标题时不加前缀。
  - `reason === 'error'` → 短原因 `（${code}）`；
  - `reason === 'interrupted'` → **无**短原因；
  - 其它（未知 kind） → 短原因 `（${reason}）`。
- `error`：仅 `reason === 'error'` 时非空；`code` 非空字符串（缺省 `'UNKNOWN'`）；`message` 单行化 + **截断 200 字符**（可为空串）。
- `reason` 归一化：`reason.kind` 非字符串/空 → `'unknown'`；长度 > 40 → 截断到 40。

## 2. 新增 / 变更的导出（serves: FR-1, FR-6）

| 导出（`src/classify.js`） | 形态 | 语义 |
|---|---|---|
| `INTENT_INTERRUPT` | `'interrupt'` | 供 `router.js` 做类型开关判定 |
| `EVENT_TURN_ERROR` | `'turn/error'` | 出站事件取值（对接收端契约） |
| `KNOWN_TURN_KINDS` | `['completed','aborted','blocked','error','max-tokens','interrupted','forked']` | DSH 已知终态快照；**不在其中即未知 → 中断** |
| `decideTurnEnd(reason, skipReasons)` | `{ decision: 'complete'\|'interrupt'\|'skip', kind, error?, silentReason? }` | **唯一真相**（分类表），纯函数、不抛 |
| `silentReasonOf(reason, skipReasons)` | `{ reason: 'turn-skipped'\|'turn-aborted'\|'turn-not-notifiable', kind } \| null` | 静默留痕（FR-6）；非静默返回 `null` |
| `errorFacts(reason)` | `{ code, message } \| null` | 从 `reason.error` 取事实并做单行化/截断；非 error 返回 `null` |

## 3. 路由的类型开关（serves: FR-4）

```js
// src/router.js —— 两处必须同步（漏一处就有通路绕过开关）
isTypeDisabled(intent) {
  return (intent.kind === INTENT_COMPLETE   && this.#config.notifyComplete === false)
      || (intent.kind === INTENT_INTERRUPT  && this.#config.notifyInterrupt === false)   // 新增
      || (intent.kind === INTENT_APPROVAL   && this.#config.notifyApproval === false)
      || (intent.kind === INTENT_QUESTION   && this.#config.notifyQuestion === false)
}
```

- `route()`（已废弃的 v1 单地址通路）内联的同一判定**必须同步加这一行**——它仍被旧调用点使用。
- 命中即整条丢弃：`{ targets: [], reason: 'type-disabled' }`；命中会话绑定**也不豁免**（既有语义不变）。

**逐目标过滤必须知道 `eventsMode`**（否则 `'explicit'` + 空列表会被既有口径当成「全收」）：

```js
export function targetAccepts(target, event) {
  // 'explicit'：严格白名单——列表为空 = 这个目标什么都不收（用户全部取消勾选的合法意图）
  if (target?.eventsMode === 'explicit') return Array.isArray(target.events) && target.events.includes(event)
  // 'all'：全收（含未来新增事件）
  if (target?.eventsMode === 'all') return true
  // 缺省（mode 未知：直接构造的测试目标 / 未归一化的外部输入）→ **逐字保持既有口径**
  if (!Array.isArray(target?.events) || target.events.length === 0) return true
  if (target.events.includes(event)) return true
  if (event.startsWith('goal/') && target.events.includes('goal/*')) return true
  return false
}
```

- `mode` 缺省时行为与改动前**逐字一致** → 既有用例中直接构造目标记录的断言零改动。
- **`eventsMode: 'explicit'` 且列表为空 = 全不收**（不是全收）——这是本设计里唯一一处「空列表语义反过来」的地方，必须由测试锁死（见 [test-cases.md](test-cases.md) T6-9）。

## 4. `handle()` 的返回契约（serves: FR-6）

| 情形 | 返回 |
|---|---|
| 中断意图成功投递 | `{ action: 'sent', source, count, intent }` |
| 中断意图被路由丢弃 | `{ action: 'dropped', reason: <既有码>, intent }` |
| `turn/end` 静默（名单命中 / aborted / blocked / max-tokens / forked） | `{ action: 'dropped', reason: 'turn-skipped' \| 'turn-aborted' \| 'turn-not-notifiable', turnKind }`（**新增**：此前是 `ignored`） |
| 非目标事件 | `{ action: 'ignored' }`（不变） |
| goal 自动轮的完成意图 | `{ action: 'silent', intent }`（不变，**只对 `kind === 'complete'`**） |

- 静默码同时进一条 `logger.debug('[dsh-notice-webhook] 丢弃 turn/end：<码>（kind=<kind>）')`。
- **不得**把 `error.message` 全文写进 Host 日志（只记 `code` 与 `kind`）。

## 5. 配置项契约（serves: FR-4）

| 键 | 类型 | 默认 | volatile | 说明 |
|---|---|---|---|---|
| `notifyInterrupt` | boolean | `true` | ✅ | 中断通知总开关；关掉 = 中断静默（**不回落成「已完成」**） |
| `interruptMessage` | string | `"会话异常中断"` | — | 正文骨架 |
| `skipReasons` | string[] | `['aborted']`（**原 `['interrupted','aborted']`**） | — | **静默名单**，命中优先于一切（含 `notifyInterrupt`）；用户可自加 `error` 实现彻底静音 |

- `normalizeConfig` 兜底：`notifyInterrupt` 非布尔 → 默认 + warn；`interruptMessage` 非字符串 → 默认 + warn；`skipReasons` 非 string[] → 默认 + warn（既有口径）。
- schema（`Config`）与 `VOLATILE_KEYS` 必须与上表逐字一致（既有测试锁这条一致性）。

## 6. 出站报文（插件 → 接收端）（serves: FR-3）

`custom` 渠道 v1（**仅中断意图**追加两个键；其它事件报文逐字节不变）：

```json
{
  "version": 1,
  "event": "turn/error",
  "message": "修复登录 bug · 会话异常中断（MALFORMED_RESPONSE）",
  "context": "…（既有上下文行，形状不变）",
  "title": "修复登录 bug",
  "toolName": null,
  "goal": null,
  "reason": "error",
  "error": { "code": "MALFORMED_RESPONSE", "message": "DeepSeek Messages stream: tool input is invalid JSON" },
  "sessionId": "session-…",
  "workspace": "/Users/me/project",
  "at": "2026-10-01T04:37:01.901Z",
  "source": "dsh-notice-webhook"
}
```

构造规则（`src/channels/custom.js`）：

```js
...(intent.kind === 'interrupt' ? { reason: intent.reason, error: intent.error ?? null } : {}),
```

- `reason`：恒为字符串；`error`：对象或 `null`（`interrupted` / 未知 kind 时为 `null`）。
- `version` 保持 `1`（追加式）；企微 / 飞书 / 钉钉 / Slack / Discord **报文形状不变**（只发正文 + 标题）。
- `src/payload.js`：`EVENT_META['turn/error'] = { title: '⚠️ 会话中断', color: 'red' }`。
- **接收端兼容（如实告知）**：只认 `turn/end` 的老接收端收不到中断通知，需按 `turn/error` 分流或忽略。

## 7. 目标与 RPC 契约（serves: FR-5）

| 项 | 变化 |
|---|---|
| `EVENT_TYPES` | 追加 `'turn/error'`（既有四项顺序不变），共 5 项；`validateTarget` 的「不认识的关心事件」校验沿用 |
| 目标记录 | 追加可选字段 `eventsMode: 'all' \| 'explicit'`（见 [data-model.md](data-model.md#2-目标记录的事件语义serves-fr-5)） |
| `validateTarget()` 输出 | `{ …, events, eventsMode, … }`；`eventsMode` 缺失/非法 → 按 §2 的推断规则补齐 |
| `TargetStore.list()` / Service `listTargets()` | **形状不变**（`...rest` 展开 → `eventsMode` 自动随记录暴露给客户端，无需改投影） |
| RPC 写入 | `target.eventsMode` 可选；不传时由 `validateTarget` 推断（**旧客户端零改动仍可用**） |

## 8. 客户端内部契约（serves: FR-5）

| 项 | 契约 |
|---|---|
| `EVENTS` 列表 | 追加 `{ id: 'turn/error', label: '会话中断', field: 'turn/error' }`，位置紧随「对话完成」之后；`EVENT_IDS` 相应变为 5 项 |
| 回显 | `events` 非空 → 按列表勾选；`events` 为空 → **全勾**（既有语义：空 = 全收）；`eventsMode` 仅用于保存判定 |
| 保存 | 勾选集合 == `EVENT_IDS`（全部）→ 提交 `{ events: [], eventsMode: 'all' }`；否则 → `{ events: <勾选>, eventsMode: 'explicit' }` |
| 后端缺失支持时 | 旧 Host（不认 `eventsMode`）会忽略该字段 → 退化为既有的「显式列表」行为，不报错 |

- 变更点：[client.js:38-43](../../../../client.js#L38-L43)（`EVENTS`）、[client.js:1047](../../../../client.js#L1047)（保存载荷）。
- 验收口径见 [frontend.md](frontend.md)。
