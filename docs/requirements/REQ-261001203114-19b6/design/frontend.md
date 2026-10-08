---
title: 前端设计 · 会话异常中断通知（设置页「关心事件」与保存语义）
requirement_refs: [REQ-261001203114-19b6]
sides: [frontend]
updated: 2026-10-01
---

# 前端设计（`client.js`）

> **TL;DR**：设置 → 通知 的「关心事件」多一项「会话中断」；**保存语义修正**为
> 「全勾 → 提交 `events: []` + `eventsMode: 'all'`（全收，含未来新增事件）；没全勾 → 提交显式列表 + `eventsMode: 'explicit'`」。
> 布局、样式、图标、弹框结构一律不动；**改动共两处**。

## 1. 关心事件列表新增一项（serves: FR-5）

`client.js` 的 `EVENTS`（当前 [client.js:38-43](../../../../client.js#L38-L43)）在「对话完成」之后插入：

```js
const EVENTS = [
  { id: 'turn/end',      label: '对话完成', field: 'turn/end' },
  { id: 'turn/error',    label: '会话中断', field: 'turn/error' },   // 新增（位置紧随完成）
  { id: 'ask_user_question', label: '等待回答', field: 'ask_user_question' },
  { id: 'approval/asked',    label: '等待授权', field: 'approval/asked' },
  { id: 'goal/*',            label: '目标终态', field: 'goal/*（完成/阻塞/轮次耗尽）' },
]
```

- `EVENT_IDS` 由 `EVENTS.map(...)` 派生 → 自动变 5 项（新建目标的默认全勾即 5 项）。
- 文案用「会话中断」而不是「异常中断」：勾选框宽度有限，且该事件本身就代表异常，前缀冗余。
- 组件 `EventFilterGrid`（渲染勾选网格）**不需要改**：它按 `EVENTS` 驱动。

## 2. 保存语义：全收 vs 显式（serves: FR-5）

现状：`save()` 恒提交 `events: draft.events`，而新建时 `draft.events = EVENT_IDS.slice()`（全量）→
「全选」被物化成显式白名单，本次新增事件后会被目标级过滤掉（**根因**）。

改后（[client.js:1047](../../../../client.js#L1047) 附近）：

```js
const chosen = Array.isArray(draft.events) ? draft.events : []
const allChecked = EVENT_IDS.every(id => chosen.includes(id)) && chosen.length === EVENT_IDS.length
// 全勾 = 全收（含未来新增事件）；否则是用户明确挑选的集合
const events = allChecked ? [] : chosen
const eventsMode = allChecked ? 'all' : 'explicit'
```

提交载荷中带上 `events, eventsMode`（其余字段不动）。

- **为什么必须做**：这是 UC-6「开箱即收」的前端半边；不做则新事件永远进不了显式白名单，用户得手动勾。
- **向后兼容**：旧 Host 不认识 `eventsMode` → 忽略该字段，行为等于改动前；旧客户端不认识本改动 → 继续提交显式列表，Host 侧按
  [data-model.md](data-model.md#2-目标记录的事件语义serves-fr-5) 的推断规则兼容。

## 3. 回显规则（serves: FR-5）

`selectTarget()`（[client.js:1009](../../../../client.js#L1009) 附近）保持既有口径，**仅补一条注释**：

| 记录形态 | 界面显示 | 说明 |
|---|---|---|
| `events: []`（含后端归一化后的老「全选」） | **5 项全勾** | 空 = 全收（既有语义） |
| `events: [4 项]` + `eventsMode: 'explicit'` | 按列表勾（「会话中断」不勾） | 用户明确不要中断 → 尊重 |
| `events: [5 项]` | 5 项全勾 | 保存时会被折成全收（下次读回 `events: []`） |

- 依赖前提：后端在**载入时**已完成老记录归一化（同一次改动的后端半边）；若 Host 未升级，老目标会显示成 4 项未勾，用户手动勾上即可（两条路都通）。

## 4. 验收口径（serves: FR-5）

**可执行**（浏览器 + 文件观察，改动后按序执行）：

1. 设置 → 通知 → 新建目标 → 「关心事件」应显示 **5 项**且默认全勾 → 保存 →
   `$DSH_HOME/state/dsh-notice-webhook/targets.json` 中该记录应为 `"events": []` 且 `"eventsMode": "all"`。
2. 同一目标取消勾选「会话中断」→ 保存 → 文件应为 `"events": [四个旧值]` 且 `"eventsMode": "explicit"`；
   刷新页面重进该目标 → 「会话中断」**保持不勾**（不会被自动勾回）。
3. 把老版本写下的记录（`events` 恰为旧版四项、无 `eventsMode`）放回文件 → 重启 Host → 打开该目标应显示 **5 项全勾**。
4. 回归：`node --test test/client-render.test.js test/client-service.test.js`（既有客户端用例）fail 0；
   设置页其余标签与交互（保存/测试/停用/删除）行为不变。

**不做**：不新增控件类型、不改配色与图标、不引入新依赖、不动 `renderTargetPicker` 对外契约。
