---
title: 架构设计 · 会话异常中断通知（turn/end 按 reason 分类）
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 架构设计

> **TL;DR**：把 `turn/end` 的判定从「二值」（命中静默名单 → 静默，否则 → 完成）换成**一张终态分类表**：
> 唯一真相是一个纯函数 `decideTurnEnd(reason, skipReasons)`，`classify()` 与静默留痕共用它。
> 只有 `completed` 产出完成意图；`error`/`interrupted`/未知 kind 产出**中断意图**（新出站取值 `turn/error`）；
> `aborted` 与静默名单命中 → 静默；`blocked`/`max-tokens`/`forked` → 静默但**绝不产出完成意图**。
> 链路（意图 → 路由 → 投递）与落盘格式**不动**，只追加一个可选字段与两个追加式报文键。

## 1. 判定点：从「二值」到「终态分类表」（serves: FR-1, FR-5）

- 唯一入口不变：`Classifier.classify(session, event)`（`src/classify.js`）。
- 新增**纯函数** `decideTurnEnd(reason, skipReasons)`，返回决策对象，**代码级顺序即语义**：

  | 顺序 | 条件 | 决策 | 静默码 |
  |---|---|---|---|
  | 1 | `kind === 'aborted'`（用户自己按的 Esc） | `skip` | `turn-aborted` |
  | 2 | `kind ∈ skipReasons` | `skip` | `turn-skipped` |
  | 3 | `kind === 'completed'` | `complete` | — |
  | 4 | `kind === 'error'` | `interrupt`（带 error 事实） | — |
  | 5 | `kind === 'interrupted'` | `interrupt`（error 为 null） | — |
  | 6 | `kind ∉ KNOWN_TURN_KINDS` | `interrupt`（未知终态，error 为 null） | — |
  | 7 | 其余（`blocked` / `max-tokens` / `forked`） | `skip` | `turn-not-notifiable` |

  > **实施期修正（2026-10-01）**：第 1 条（`aborted`）必须排在第 2 条（静默名单）**之前**——默认名单里就含 `aborted`，
  > 排在后面会让专门为它写的 `turn-aborted` 原因码**永远不可达**（实施时被 T5-3 用例抓到，已改）。行为不变，只是码更准。

  `kind` 归一化：`reason.kind` 非字符串或空串 → `'unknown'`（走第 6 行，**不谎报完成**）。
- 静默 ≠ 丢弃得不明不白：`silentReasonOf(reason, skipReasons)` 复用同一决策，把第 1/5/7 行的静默码交给 `handle()` 记 debug 日志与决策结果（FR-6）。
- **`blocked`/`max-tokens`/`forked` 必须走 `skip`，绝不能落到 `complete`**——这是本需求修的核心缺陷（现状它们全被当「已完成」推）。

## 2. 模块改动地图（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| 文件 | 改动 | 服务 FR |
|---|---|---|
| `src/classify.js` | 新增 `INTENT_INTERRUPT` / `EVENT_TURN_ERROR` / `KNOWN_TURN_KINDS` / `decideTurnEnd()` / `silentReasonOf()` / `errorFacts()`；`classify()` 的 `turn/end` 分支改为查表 | FR-1, FR-2, FR-6 |
| `src/config.js` | `DEFAULTS` 增 `notifyInterrupt: true`、`interruptMessage: '会话异常中断'`；`skipReasons` 默认改 `['aborted']`；`BOOLEAN_KEYS` / `STRING_KEYS` / `VOLATILE_KEYS` / schema 同步 | FR-4 |
| `src/router.js` | `isTypeDisabled()` 与废弃的 `route()` **两处**都加 `notifyInterrupt === false` 分支；`targetAccepts()` 改按 `eventsMode` 判定（`explicit` + 空列表 = **全不收**；mode 缺省 = 旧口径） | FR-4, FR-5 |
| `src/channels/custom.js` | `buildPayload()` 仅对中断意图追加 `reason` / `error` | FR-3 |
| `src/payload.js` | `EVENT_META` 增 `'turn/error'`（`⚠️ 会话中断` / red） | FR-3 |
| `src/targets.js` | `EVENT_TYPES` 追加 `'turn/error'`；新增 `LEGACY_ALL_EVENTS` / `normalizeEvents()`；`validateTarget()` 输出加 `eventsMode` | FR-5 |
| `client.js` | `EVENTS` 追加「会话中断」；`save()` 按「全选 → `[]`+`all`，否则显式+`explicit`」提交 | FR-5（frontend） |
| `index.js` | `intent === null` 分支改为先问 `silentReasonOf()` 再决定 `ignored` / `dropped`；`autoRound` 静默分支**保持只对 `complete` 生效** | FR-6, FR-4 |

## 3. 关键流程（serves: FR-1, FR-3, FR-4, FR-6）

```
 session/event ──► handle(session, event, now)
                     │
                     ├─ prompts.observe / goals.observe（不变）
                     ├─ intent = classifier.classify(...)
                     │        │
                     │        └─ turn/end ──► decideTurnEnd(reason, skipReasons)
                     │                          ├─ complete  ──► { kind:'complete',  event:'turn/end'   }
                     │                          ├─ interrupt ──► { kind:'interrupt', event:'turn/error',
                     │                          │                   reason:<kind>, error:{code,message}|null }
                     │                          └─ skip ──────► null
                     │
                     ├─ intent === null ──► silentReasonOf(...) ──► { action:'dropped', reason:'turn-*', turnKind }
                     │                                        └──► { action:'ignored' }（非 turn/end 事件）
                     ├─ intent.kind === 'complete' && autoRound ──► { action:'silent' }   ← 只对完成生效
                     │                                                        （中断**不**静默）
                     └─ dispatch(session, intent, now)
                              │
                              ├─ Router.resolveTargets ──► isTypeDisabled（notifyInterrupt）
                              │                              ├─ 目标解析 / 总开关 / 逐目标过滤（targetAccepts）
                              │                              └─ cooldown
                              └─ channelBuildRequest ──► custom: + reason / error（仅中断）
```

## 4. 不变量（serves: FR-1, FR-3, FR-5）

- **I1**：`error` / 未知 kind **永不**产出 `event:'turn/end'` 的任何报文（本缺陷的回归锁）。
- **I2**：**非中断意图**的 `custom` 报文逐字节不变（新增键只在 `intent.kind === 'interrupt'` 时出现）——既有报文断言零改动。
- **I3**：分类是纯函数：不抛异常、无 `node:` 依赖、无时钟、无 I/O。任何畸形 `event.data` 只降级为「未知 kind → 中断」。
- **I4**：`targets.json` 的 `version` **保持 3**；只对**单条记录**追加可选字段 `eventsMode`（旧版本读到时忽略/丢弃，不报错）。
- **I5**：`blocked` / `max-tokens` / `forked` 既不推送、也不产出完成意图。
- **I6**：`autoRound`（goal 自动轮）静默**只对完成意图**生效；中断意图在任何轮次都照常推送。

## 5. 迁移与回滚（serves: FR-5）

- **老目标的「全选」白名单**：UI 历史上把「全选」写成显式四项，而 `targetAccepts` 对非空列表是白名单 → 新事件会被静默过滤掉。
  设计上不再靠「猜集合相等」，而是**引入显式语义字段 `eventsMode`**：
  - `eventsMode: 'all'` + `events: []` → 全收（含未来新增事件）；
  - `eventsMode: 'explicit'` + `events: [...]` → 只收这些，**永不自动追加**；
  - **缺省（老记录）** → 推断：`events` 为空，或集合恰等于 `LEGACY_ALL_EVENTS` → 按 `all`（一次性兼容）；否则按 `explicit`。
- 详见 [data-model.md](data-model.md#2-目标记录的事件语义serves-fr-5)。
- **回滚路径**：装回旧版本即可——文件 `version` 未变、旧版本照旧读 `events`（新写入的 `[]` 在旧语义里同样是全收）。
- **需求侧默认值变更**：`skipReasons` 默认 `['interrupted','aborted']` → `['aborted']`（`interrupted` 由静默改为推送，正是本需求目的）。

## 6. 依赖与降级（serves: FR-1）

- **依赖 DSH 事实**：`TurnEndReasonMap`（`packages/core/session/src/types.ts`）当前 7 种终态，且**可被插件合并扩展**——
  所以第 6 行「未知 kind → 中断」是**刻意的正向兜底**：宁可提示「未知终态」，也不谎报「已完成」。
- **零新增依赖**：不引入任何包；不消费新的 `ctx` 服务；无网络、无定时器。
- **降级**：配置缺项 / 类型错误一律回落默认值并 warn（既有 `normalizeConfig` 口径不变）。

## 7. 测试策略（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| 层 | 文件 | 覆盖 |
|---|---|---|
| 单元（决策表） | `test/classify.test.js`（扩展） | 8 种 kind 的决策与静默码（FR-1）、消息与 error 事实（FR-2） |
| 集成（链路） | `test/interrupt.test.js`（新增） | `handle` → `dispatch` → **出站报文字节**（FR-3）、开关（FR-4）、静默留痕（FR-6）、autoRound 不静默（FR-4） |
| 数据（迁移） | `test/targets-events.test.js`（新增） | `eventsMode` 推断与幂等、文件 `version` 仍为 3、回滚可读（FR-5） |
| 存量 | 既有 244 用例 | **只允许**改写「`error` 当完成」相关断言 |

## 8. 记账：与需求文档的措辞偏差 + 遗留风险（serves: FR-3, FR-5）

- **偏差 1（机制收紧，需人确认）**：需求 FR-5 写「不改文件格式」——本设计精确化为「**不升 `version`**，仅对每条记录追加一个可选字段 `eventsMode`」。
  原因：单纯靠「集合等于旧版全集」推断，会把**新界面里主动取消勾选「会话中断」**的用户（保存后恰好也是四项）误判成全收，
  等于用户关不掉它。`eventsMode` 让「全收」与「我明确只要这些」在数据里可区分，且旧版本忽略未知字段、回滚安全。
- **偏差 2（码值收敛）**：需求 FR-6 列了三个静默码，实现为 `turn-skipped`（静默名单命中）/ `turn-aborted`（用户自己停）/
  `turn-not-notifiable`（blocked / max-tokens / forked）——数量一致，语义按第 1 节的判定顺序落位。
- **遗留风险 1**：只认 `turn/end` 的**老接收端收不到中断通知**（D1 选定「新增 event 取值」的已知代价）——README 明示。
- **遗留风险 2**：`blocked` / `max-tokens` / `forked` 本次不推送。若将来要推，需引入按 kind 的开关与文案矩阵（按立项记录，届时**升级重档**）。
