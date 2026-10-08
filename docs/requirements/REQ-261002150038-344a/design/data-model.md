---
title: 数据模型设计 · 通知去噪（注入轮静默 + 卡片去重）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 数据模型设计

> **TL;DR**：**没有落盘数据变更**。本次只改一个内存里的轮次标记对象（字段名 `sawGoal` → `sawInjected`），
> 不新增 / 不修改任何配置键，不动目标与绑定文件格式，不动报文字段集。

## 1. 内存：轮次标记（`GoalTracker.#rounds`）（serves: FR-1, FR-2）

`WeakMap<session, RoundMark>`，随 `turn/end` 由 `endRound()` 删除（不落盘、不跨轮存活）。

| 字段 | 类型 | 改前 | 改后 | 说明 |
|---|---|---|---|---|
| `sawHuman` | boolean | 有 | 有 | 本轮出现过 direct human 的 `user/message` |
| `sawInjected` | boolean | —（新） | 有 | 本轮出现过注入的 `user/message` |
| `sawGoal` | boolean | 有 | **删除** | 语义被 `sawInjected` 取代（goal 只是注入的一种） |

- 缺省值：`{ sawHuman: false, sawInjected: false }`（懒建，`observe` 首次见到 `user/message` 时创建）。
- 不变量：`isAutoRound === (mark !== undefined && mark.sawInjected && !mark.sawHuman)`。
- 生命周期不变：`turn/end` 分类完成后 `endRound(session)`；会话对象被回收时随 `WeakMap` 一起释放。

## 2. 内存：人工输入缓存（`PromptTracker`）（serves: FR-3）

`WeakMap<session, string>`（本轮最后一条**人**的输入文本）。

- 键 / 值类型不变；唯一变化是**写入条件**收紧为 `isHumanSource(source)`。
- 读：`take(session)`（不改）；写：`observe(session, event)`（条件收紧）；清：`clear(session)`（不改）。

## 3. 配置契约（`Config` / `normalizeConfig`）（serves: FR-1, FR-2, FR-4）

**零变更**：不新增键、不改默认值、不改 schema、不改 `VOLATILE_KEYS`。

- 既有相关键语义重申（本次不改）：
  - `notifyComplete`（内容级开关）：注入轮静默发生在**路由之前**，与它正交（都关也静默，都开也静默）。
  - `skipReasons`：只作用于 `turn/end` 的 kind 静默名单，与「谁在说话」无关。
  - `payload.fields`：纯文本渠道的字段集，**保留 `event`**（见需求「边界」）。
- 因此：**不需要迁移、不需要回填、无版本升级**。

## 4. 落盘数据（serves: FR-5）

| 数据 | 变更 |
|---|---|
| 目标清单文件（`targets`，v3） | 不动 |
| 会话绑定（`bindings`） | 不动 |
| 投递结果（`outcomes`，内存） | 不动（静默路径本来就不写 outcome） |
| 新增文件 / 目录 | **无** |
| 文件格式版本 | 不动 |

## 5. 出站报文字段（serves: FR-4）

- 字段集不变：`event` / `title` / `color` / `time` / `session` / `id` / `workspace` / `prompt` / `detail` / `link`
  （见 `buildContext()`），`PAYLOAD_VERSION` 保持 `1`。
- 飞书卡片是 `buildCard()` 的**渲染结果**，不构成字段契约；本次只少一行 `类型`。
