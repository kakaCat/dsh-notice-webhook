---
title: 数据模型 · 会话异常中断通知（turn/end 按 reason 分类）
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 数据模型

> **TL;DR**：**文件版本不变（`targets.json` 仍 `version: 3`）**。新增两个配置字段、变更一个配置默认值；
> 目标记录追加一个可选字段 `eventsMode`（`'all'` / `'explicit'`），用来把「全收」与「我明确只要这些」在数据里区分开——
> 这是 FR-5 的关键，也是本次唯一触碰落盘结构的地方。意图对象是**纯内存**、不落盘。

## 1. 新增 / 变更的配置字段（serves: FR-4）

| 字段 | 类型 | 默认 | 必填 | 约束 | 变化 |
|---|---|---|---|---|---|
| `notifyInterrupt` | boolean | `true` | 否 | 非布尔 → 默认 + warn | **新增**（`volatile`） |
| `interruptMessage` | string | `"会话异常中断"` | 否 | 非字符串 → 默认 + warn | **新增** |
| `skipReasons` | string[] | `['aborted']` | 否 | 元素皆为 string；非数组/含非字符串 → 默认 + warn | **默认值变更**（原 `['interrupted','aborted']`） |

- 语义：`skipReasons` = **静默名单**（命中即完全不推，优先于 `notifyInterrupt`）；不再只是「视为非完成」——因为本需求之后
  「非完成」有三种去向（中断 / 静默 / 不叫也不谎报），名单只保留「静默」这一种。
- `normalizeConfig` / schema / `VOLATILE_KEYS` 三处必须一致（既有测试锁一致性）。

## 2. 目标记录的事件语义（serves: FR-5）

单条目标记录（`targets.json` 的 `targets[]` 元素）新增可选字段：

| 字段 | 类型 | 取值 | 语义 |
|---|---|---|---|
| `events` | string[] | `EVENT_TYPES` 的子集或空 | 空 = 全收（既有语义，不变） |
| `eventsMode` | `'all' \| 'explicit'` | 可选 | `'all'` = 全收（含未来新增事件）；`'explicit'` = 只收列表里的，**永不自动追加** |

**归一化判定式（实现与测试以此为准，`validateTarget` 内唯一落点）**：

```
normalizeEvents(rawEvents, rawMode):
  rawEvents := input.events 中的字符串项（未知取值仍按既有规则报错，不静默过滤）
  if rawMode === 'all'        → { events: [],                eventsMode: 'all' }
  if rawMode === 'explicit'   → { events: dedupe(rawEvents), eventsMode: 'explicit' }
  // 缺省 / 非法 mode（= 本次改动前的记录、或旧客户端写入）→ 推断
  if rawEvents.length === 0                    → { events: [],                eventsMode: 'all' }
  if set(rawEvents) === set(LEGACY_ALL_EVENTS) → { events: [],                eventsMode: 'all' }   // 一次性兼容
  otherwise                                    → { events: dedupe(rawEvents), eventsMode: 'explicit' }
```

- `LEGACY_ALL_EVENTS = ['turn/end','ask_user_question','approval/asked','goal/*']`（改动前 UI「全选」写出的**唯一**形态）。
- **为什么需要 `eventsMode` 而不是只看集合**：新界面里用户主动取消勾选「会话中断」后保存的列表**恰好也是这四项**，
  只看集合会把他误判成「全收」→ 用户**关不掉**这个通知。加上 mode 后语义由用户意图决定，不再靠猜。
- **幂等**：对同一记录反复归一化结果不变；一旦带 mode 落盘，后续加载不再推断。

**归一化后的接收语义（`targetAccepts`，实现与测试以此为准）**：

| `eventsMode` | `events` | 该目标收不收某事件 |
|---|---|---|
| `'all'` | 必为 `[]`（归一化强制） | **收**（含未来新增事件） |
| `'explicit'` | 非空 | 只收列表内的（`goal/*` 仍覆盖 `goal/` 全部终态） |
| `'explicit'` | `[]` | **什么都不收**（用户全部取消勾选的合法意图，不是全收） |
| 缺省（未归一化的外部输入 / 直接构造的测试目标） | 空 | 收（**逐字保持旧口径**） |
| 缺省 | 非空 | 只收列表内的（**逐字保持旧口径**） |
- **兼容**：旧客户端（不传 mode）保存的显式四项 → 推断为 `all`（旧客户端不知道 `turn/error`，「全勾」即它的全部）✓；
  旧客户端少勾任意一项 → 集合不等 → `explicit` ✓。
- **回滚**：旧版本插件读本文件时按白名单构建记录，**丢弃未知字段 `eventsMode`**、只读 `events`，行为与改动前一致；
  新写入的 `events: []` 在旧语义里同样是全收 ✓。

## 3. 意图对象（内存，不落盘）（serves: FR-2）

| 字段 | 类型 | 说明 |
|---|---|---|
| `kind` | `'interrupt'` | 供路由做类型开关 |
| `event` | `'turn/error'` | 出站取值 |
| `message` | string | 已拼好标题与短原因 |
| `toolName` | `null` | 与既有意图形状对齐（渠道适配器统一读它） |
| `reason` | string | 归一化终态（`'error'` / `'interrupted'` / 未知 kind 原文 ≤40 / `'unknown'`） |
| `error` | `{ code, message } \| null` | 仅 `error` 终态非空；`message` 单行化 + ≤200 字符 |
| `goal` | 不设置 | goal 通路独立，不参与 |

- 生命周期：`classify()` 返回 → `dispatch()` → 渠道打包 → 丢弃。**不进任何 Store、不跨 tick 保存**。
- 投递结果仍进既有 `OutcomeStore`（每目标最近 5 条，内存）。

## 4. 不落盘 / 不迁移清单（serves: FR-3, FR-5）

| 对象 | 处置 |
|---|---|
| `targets.json` 的 `version` | **保持 3**（不升版本 → 回滚时旧插件照常读到全部目标） |
| `bindings.json` | 一字不动 |
| RPC 契约 / `payload` 字段投影 / 模板 | 一字不动 |
| 报文字段顺序与既有键 | 一字不动（新键仅中断意图追加） |
| goal 通路数据 | 一字不动 |

## 5. 内存上界（serves: FR-1）

- 分类与静默留痕**无状态**：不新增任何 `Map` / 定时器 / 缓存，内存增量恒为 0。
- 新增的字符串常量与常量数组均为模块级冻结值。
