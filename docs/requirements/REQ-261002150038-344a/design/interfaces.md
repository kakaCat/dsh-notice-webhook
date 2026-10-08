---
title: 接口设计 · 通知去噪（注入轮静默 + 卡片去重）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 接口设计

> **TL;DR**：只新增**一个纯函数** `isHumanSource(source)`；其余全是既有方法**内部口径替换**（签名不变、返回形状不变）。
> 出站契约不升版本：唯一可见变化是飞书卡片少一行「类型」。

## 1. 新增：`src/source.js`（serves: FR-1）

```js
/**
 * 这条 user/message 是不是「人在说话」。
 * direct human = source 缺失 / source.kind 缺失 / source.kind === 'user'；
 * 其余（goal / dive / plugin / 未来新增 / 形状异常）一律视为注入。
 */
export function isHumanSource(source): boolean
```

**真值表（实现即契约，逐行可断言）**

| `source` | `source.kind` | 返回 | 语义 |
|---|---|---|---|
| `undefined` / `null` | — | `true` | 人（DSH 的直发消息可能不带 source） |
| 非对象（字符串 / 数字）/ 数组 | — | `false` | 形状异常 → 注入（安静优先） |
| `{}` | `undefined` / `null` | `true` | 人 |
| `{ kind: 'user' }` | `'user'` | `true` | 人 |
| `{ kind: 'goal', … }` | `'goal'` | `false` | goal 自动轮 |
| `{ kind: 'dive', requirementId, round }` | `'dive'` | `false` | **本次的靶子**（pmboard Dive 续跑） |
| `{ kind: 'plugin', form: 'notice' }` | `'plugin'` | `false` | 插件注入通知 |
| `{ kind: 'brand-new' }` | 任意其他字符串 | `false` | 未来新增 kind **默认安静** |
| `{ kind: 42 }` | 非字符串 | `false` | 形状异常 → 注入 |

**错误语义**：不抛错、不做文本匹配、无 I/O、无时钟依赖。

## 2. 变更：`GoalTracker`（`src/goal.js`）（serves: FR-1, FR-2）

```js
// 构造与其余方法签名不变
new GoalTracker(config, resolveTitle)
observe(session, event) -> terminalIntent | null     // 签名不变
isAutoRound(session) -> boolean                      // 签名不变，语义收敛
endRound(session) / snapshotOf(session)              // 不变
```

- `observe()` 内 `user/message` 分支：

  | 改前 | 改后 |
  |---|---|
  | `event.data.source.kind === 'goal'` → `round.sawGoal = true`；否则 `round.sawHuman = true` | `isHumanSource(event.data?.source)` → `round.sawHuman = true`；否则 `round.sawInjected = true` |

- `isAutoRound(session)`：`round !== undefined && round.sawInjected === true && round.sawHuman !== true`。
- **行为差异表**（`turn/end(completed)` 时）：

  | 本轮收到的 user/message | 改前 | 改后 |
  |---|---|---|
  | `{kind:'goal'}` | 静默 | 静默（不变） |
  | `{kind:'dive'}` | **推送** | **静默**（本次修复） |
  | `{kind:'plugin'}` | **推送** | **静默**（本次修复） |
  | 无 source（人） | 推送 | 推送（不变） |
  | `{kind:'dive'}` + 无 source（人插话） | 推送 | **推送**（人没被误伤） |
  | 一条 user/message 都没有 | 推送 | 推送（不变） |

## 3. 变更：`PromptTracker`（`src/payload.js`）（serves: FR-3）

```js
createPromptTracker() -> { observe(session, event), take(session), clear(session) }   // 签名不变
```

- `observe()` 的第二道门由「`source.kind === 'goal'` 则跳过」改为「`!isHumanSource(source)` 则跳过」。
- 效果：dive / plugin 注入正文**不进**「任务」字段；本轮无人工输入时「任务」行整行消失（既有行为）。
- `take()` / `clear()` 一字不改。

## 4. 变更：飞书卡片（`src/channels/feishu.js`）（serves: FR-4）

```js
buildCard(intent, context) -> card
```

- `elements[0].fields` 的构成由 `[类型, 会话, 工作区, 任务, 详情, 时间]` 变为 `[会话, 工作区, 任务, 详情, 时间]`（**去掉类型**）。
- 不变：`header.title.content`（`context.title ?? intent.message`）、`header.template`（`context.color`）、
  `config.wide_screen_mode`、按钮条件（仅 `http(s)`）、`idTag()` 的文本标签渲染、无 context 时的纯文本回落。
- `buildRequest()` 与加签算法**一字不改**。

## 5. 变更：设置页卡片预览（`client.js`）（serves: FR-4）

```js
PayloadPreview({ value }) -> vnode
```

- 「飞书卡片」区的行过滤条件追加一条：**默认渲染**的 `**类型**：…` 行不显示（因为卡片标题已给出事件）。
  - 判据：`line.startsWith('**类型**')`（即 `payload.fields` 含 `event` 且未用自定义 `template` 覆盖时那一行）。
  - 用自定义 `template` 时不做猜测（模板是用户显式拼的，原样展示）。
- 「纯文本（企微 / 钉钉 / Slack / Discord）」区**保留**该行。
- `payloadPreviewLines()` 本身不变（它服务两个区）。

## 6. 出站契约（插件 → 接收端）（serves: FR-4）

| 项 | 结论 |
|---|---|
| `PAYLOAD_VERSION` | 保持 `1`（无字段语义变更） |
| 新增 / 删除的报文字段 | 无（飞书卡片字段是渲染结果，不是契约字段集） |
| `event` 取值 | 不变（`turn/end` / `turn/error` / `approval/asked` / `ask_user_question` / `goal/*`） |
| 文本渠道报文 | **逐字节不变** |
| 飞书卡片 | 正文少一行「类型」；header 与其余字段不变 |

## 7. 兼容与回滚（serves: FR-4, FR-5）

- 老接收端：飞书卡片少一行无需适配。
- 调用方（RPC / 其他插件经 Host Service 绑定）：**零影响**（本设计不触碰 `service.js` / `rpc.js`）。
- 回滚：删 `src/source.js` + 还原 4 个文件的内部口径（见 architecture.md §5）。
