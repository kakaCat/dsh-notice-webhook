---
title: 后端设计 · 会话异常中断通知（Host 半函数级改动）
requirement_refs: [REQ-261001203114-19b6]
sides: [backend]
updated: 2026-10-01
---

# 后端设计（Host 半）

> **TL;DR**：Host 侧共 6 个文件的函数级改动——分类（新纯函数 + 查表）、配置（2 新键 + 1 默认值）、
> 路由（1 个开关分支 ×2 处）、报文（条件追加 2 键）、事件元数据（1 条）、目标记录（1 个可选字段 + 归一化）。
> 全部**无状态、无 I/O、无新依赖**；`targets.json` 版本不变。

## 1. `src/classify.js`（serves: FR-1, FR-2, FR-6）

| 单元 | 改动 |
|---|---|
| `KNOWN_TURN_KINDS` | 新增冻结数组：7 种已知终态（`packages/core/session/src/types.ts` 的 `TurnEndReasonMap` 快照） |
| `decideTurnEnd(reason, skipReasons)` | **新增纯函数**：按 [architecture.md §1](architecture.md#1-判定点从二值到终态分类表serves-fr-1-fr-5) 的 7 行顺序返回 `{ decision, kind, error?, silentReason? }`；**不抛异常**（畸形输入 → `kind:'unknown'`） |
| `silentReasonOf(reason, skipReasons)` | **新增**：复用 `decideTurnEnd`，只在 `skip` 时返回 `{ reason, kind }`，供 `index.js` 留痕 |
| `errorFacts(reason)` | **新增**：`{ code, message }`；`code` 缺省 `'UNKNOWN'`，`message` 单行化（`\s+` → 空格）+ `slice(0,200)` |
| `INTENT_INTERRUPT` / `EVENT_TURN_ERROR` | 新增导出常量 |
| `Classifier.classify()` 的 `turn/end` 分支 | 由「命中名单 → null，否则完成」改为**查表**：`complete` → 完成意图；`interrupt` → 中断意图（含 `reason` / `error`）；`skip` → `null` |

- `session/title` 缓存、`onlyTopLevel` 嵌套过滤、`approval/asked`、`user-questions/request` 分支**一字不动**。

## 2. `src/config.js`（serves: FR-4）

| 位置 | 改动 |
|---|---|
| `DEFAULTS` | `notifyInterrupt: true`、`interruptMessage: '会话异常中断'`；`skipReasons: ['aborted']` |
| `BOOLEAN_KEYS` / `STRING_KEYS` | 分别追加 `'notifyInterrupt'` / `'interruptMessage'`（自动获得类型兜底 + warn） |
| `normalizeConfig()` | 无结构性改动（走既有键驱动兜底）；注释更新「skipReasons = 静默名单」 |
| schema（`Config`） | `notifyInterrupt: z.boolean().default(true).volatile()`；`interruptMessage: z.string().default('会话异常中断')`；`skipReasons` 默认值同步 |
| `VOLATILE_KEYS` | 追加 `'notifyInterrupt'`（与 schema 的 `.volatile()` 保持一致——既有测试锁这条） |

## 3. `src/router.js`（serves: FR-4）

- `isTypeDisabled(intent)`：加 `intent.kind === INTENT_INTERRUPT && config.notifyInterrupt === false`。
- 废弃的 `route()` 内联判定：**同加一行**（两处不同步就会出现「v1 通路绕过开关」）。
- `targetAccepts(target, event)`：加 `eventsMode` 分支——`'explicit'` 严格白名单（**空列表 = 全不收**）、`'all'` 一律收、
  **缺省走既有口径**（逐字不改那三行，既有用例零改动）。契约见 [interfaces.md §3](interfaces.md#3-路由的类型开关serves-fr-4)。
- `import` 行补 `INTENT_INTERRUPT`。其余（目标解析 / 总开关 / 去重 / 冷却顺序）不动。

## 4. `src/channels/custom.js` + `src/payload.js`（serves: FR-3）

- `buildPayload()`：在 `toolName` 之后条件追加 —— `...(intent.kind === 'interrupt' ? { reason: intent.reason, error: intent.error ?? null } : {})`。
- `payload.js` 的 `EVENT_META`：加 `'turn/error': { title: '⚠️ 会话中断', color: 'red' }`。
- 其余五个渠道适配器**零改动**（它们只消费 `intent.message` 与上下文文本）。

## 5. `src/targets.js`（serves: FR-5）

| 单元 | 改动 |
|---|---|
| `EVENT_TYPES` | 追加 `'turn/error'`（既有四项顺序不变） |
| `LEGACY_ALL_EVENTS` | 新增常量：改动前 UI「全选」写出的唯一形态 |
| `normalizeEvents(events, mode)` | **新增纯函数**：按 [data-model.md §2](data-model.md#2-目标记录的事件语义serves-fr-5) 的判定式返回 `{ events, eventsMode }`；幂等 |
| `validateTarget()` | 读取 `input.eventsMode`（值域 `'all' \| 'explicit'`，其它视为缺省）；未知事件**仍按既有规则报错**；输出补 `eventsMode` |
| `TargetStore.#persist()` | **零改动**（记录整体序列化 → `eventsMode` 自动落盘） |
| 版本闸门 | **零改动**（`TARGET_FILE_VERSION` 仍 3；仍拒绝未知版本并保留原文件） |

- `TargetStore.load()` 的调用链不变：`validateTarget()` 是唯一归一化落点 → 载入与保存**同一套规则**（不会出现「存进去和读出来不一样」）。

## 6. `index.js`（serves: FR-4, FR-6）

- `handle()`：`intent === null` 分支改为

  ```js
  if (intent === null) {
    const silent = event?.type === 'turn/end' ? silentReasonOf(event.data?.reason, config.skipReasons) : null
    if (silent !== null) {
      logger?.debug?.(`[dsh-notice-webhook] 丢弃 turn/end：${silent.reason}（kind=${silent.kind}）`)
      return { action: 'dropped', reason: silent.reason, turnKind: silent.kind }
    }
    return { action: 'ignored' }
  }
  ```

- `intent.kind === 'complete' && autoRound` 静默分支**保持原样**（逐字不改即满足「中断不受自动轮静默影响」，并有 T5-1 锁死）。
- 其余（`prompts` / `goals` / `dispatch` / `deliverToTarget`）不动。

## 7. 错误处理与日志（serves: FR-1, FR-6）

- **不抛**：`decideTurnEnd` / `errorFacts` / `normalizeEvents` 全部是纯函数，畸形输入走默认分支；分类异常不得让会话报错（既有铁律）。
- **日志洁净**：Host 日志只记 `code` 与 `kind`；`error.message` 全文只进用户自己的 webhook 报文。
- **可观测**：静默原因码进 debug 日志与 `handle()` 返回值；中断投递进既有 `OutcomeStore`。

## 8. 验收口径（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

```sh
# 1) 决策表（期望：error/interrupted/未知 → interrupt；aborted/blocked/max-tokens/forked → null）
node -e "import('./src/classify.js').then(async m=>{const {normalizeConfig}=await import('./src/config.js');const c=new m.Classifier(normalizeConfig({}));const s={header:{}};for(const k of ['completed','error','interrupted','aborted','blocked','max-tokens','forked','weird'])console.log(k,'=>',JSON.stringify(c.classify(s,{type:'turn/end',data:{reason:{kind:k,error:k==='error'?{message:'DeepSeek Messages stream: tool input is invalid JSON',code:'MALFORMED_RESPONSE'}:undefined}}})))})"

# 2) 全量回归（基线 tests 244 / pass 244 / fail 0）
node --test "test/*.test.js"

# 3) 迁移（老「全选」记录 → events:[] + eventsMode:'all'；文件 version 仍为 3）
node --test test/targets-events.test.js
```

**期望**：第 1 步输出与决策表逐行一致；第 2 步 `fail 0` 且用例数 ≥244；第 3 步全绿且断言 `version === 3`。
