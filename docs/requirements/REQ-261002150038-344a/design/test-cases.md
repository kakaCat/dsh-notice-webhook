---
title: 测试用例 · 通知去噪（注入轮静默 + 卡片去重）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 测试用例

> **TL;DR**：新增/改写覆盖分四层——**判定纯函数**（`test/payload.test.js` 或新 `test/source.test.js`）、
> **轮次静默链路**（`test/goal.auto.test.js` 扩展）、**卡片与预览**（`test/channels.feishu.test.js` 断言翻转 + `test/client-render.test.js` 新增）、
> **端到端**（`test/e2e.local.test.js`：注入轮 0 报文 / 人轮 1 报文）。
> 全量基线 `tests 288 / pass 288 / fail 0`，本次**只增不减**。

## 0. 跑法与基线（serves: FR-1, FR-2, FR-3, FR-4, FR-5）

```bash
node --test "test/*.test.js"      # 全量：改动前 288 passed / 0 failed；改动后 fail 0 且总数 ≥ 288
node --test test/goal.auto.test.js        # 注入轮静默
node --test test/payload.test.js          # 「任务」字段取值
node --test test/channels.feishu.test.js  # 卡片字段
node --test test/client-render.test.js    # 设置页预览
node --test test/e2e.local.test.js        # 端到端报文条数
```

## 1. 判定纯函数 `isHumanSource`（serves: FR-1）

| 用例 | 输入 `source` | 期望 |
|---|---|---|
| TC-1 | `undefined` / `null` | `true`（人） |
| TC-2 | `{}` / `{ kind: undefined }` / `{ kind: null }` | `true`（人） |
| TC-3 | `{ kind: 'user' }` | `true`（人） |
| TC-4 | `{ kind: 'goal', goalId: 'g-1' }` / `{ kind: 'dive', requirementId: 'REQ-x', round: 35 }` / `{ kind: 'plugin', form: 'notice' }` | 三者都 `false`（注入） |
| TC-5 | `{ kind: 'brand-new-kind' }` / `{ kind: 42 }` / `'user'`（非对象） / `['user']`（数组） | 四者都 `false`（默认注入 + 形状异常） |

> 放在 `test/source.test.js`（新文件，纯函数零依赖）或并入 `test/payload.test.js`；实施时二选一。

## 2. 轮次静默链路（`test/goal.auto.test.js` 扩展）（serves: FR-1, FR-2）

复用该文件既有的 `pipeline()` 假件（`feed()` = 观察 → 分类 → 自动轮抑制）。

| 用例 | 喂入序列 | 期望 |
|---|---|---|
| TC-6 | `user/message{source:{kind:'dive',requirementId:'REQ-x',round:35}}` ×3 轮，每轮接 `turn/end(completed)` | `emitted` 为空（**0 条意图**）——本次修复的回归锁 |
| TC-7 | `user/message{source:{kind:'plugin',form:'notice'}}` + `turn/end(completed)` | 0 条意图 |
| TC-8 | `user/message{source:{kind:'goal'}}` + `turn/end(completed)` | 0 条意图（**既有行为不变**） |
| TC-9 | `dive` 注入 + `user/message{source:{kind:'user'}}`（人插话）+ `turn/end(completed)` | **1 条**意图（人不被误伤）；`isAutoRound()` 为 `false` |
| TC-10 | 整轮**只有** `turn/end(completed)`（无任何 user/message） | **1 条**意图（无消息轮不静默，维持现状） |
| TC-11 | `dive` 注入 + `turn/end(reason.kind='error')` | **1 条**中断意图（`event === 'turn/error'`）——静默只挡完成 |
| TC-12 | `dive` 注入 + `turn/end(reason.kind='interrupted')` | **1 条**中断意图 |

## 3. 「任务」字段取值（`test/payload.test.js` 扩展）（serves: FR-3）

| 用例 | 操作 | 期望 |
|---|---|---|
| TC-13 | `tracker.observe(session, { type:'user/message', data:{ source:{kind:'dive'}, message:{content:[{type:'text',text:'继续执行需求 REQ-x（Dive 模式自动续跑，第 35 回合）'}]} } })` → `take(session)` | `null`（注入不进「任务」） |
| TC-14 | 先 observe `{kind:'goal'}` 文本，再 observe `{kind:'user'}` 文本 → `take()` | 返回**人的**那段文本（既有 goal 用例的等价扩展） |
| TC-15 | 先 observe `{kind:'dive'}` 文本，再 observe 无 source 的消息 → `take()` | 返回无 source 那条（人） |
| TC-16 | 无 source 的消息 → `take()` → `renderContext()` | 「任务」行存在且等于人的文本（既有行为不变） |

## 4. 飞书卡片（`test/channels.feishu.test.js` 改写）（serves: FR-4）

| 用例 | 断言 |
|---|---|
| TC-17 | `buildCard(...)` 的 `elements[0].fields` 拼接文案**不含** `**类型**`（原断言 `includes('**类型**')` **翻转为 `!includes`**，注释写明「标题栏已给出事件」） |
| TC-18 | 同一用例内保留并加强：`header.title.content === '✅ 对话完成'`、`header.template === 'green'`、字段顺序为 `会话 → 工作区 → 任务 → 时间`、`<text_tag>` 短 id、`dsh://` 不放按钮 |
| TC-19 | 无 `context` 直调 `buildRequest()` → 仍是 `{ msg_type:'text', content:{ text: intent.message } }`（回落路径不变） |
| TC-20 | 配色用例（等待授权=橙 / 目标阻塞=红）不变 |

## 5. 设置页预览（`test/client-render.test.js` 新增）（serves: FR-4）

用既有 `loadComponents()`（`__test.PayloadPreview`）渲染两个区块。

| 用例 | 断言 |
|---|---|
| TC-21 | 渲染 `PayloadPreview({ value: { fields: PAYLOAD_DEFAULTS.fields } })`：**第一个区块（飞书卡片）**的文本里没有 `**类型**：✅ 对话完成` |
| TC-22 | 同一次渲染：**第二个区块（纯文本）**的文本里**有** `**类型**：✅ 对话完成`（文本渠道保留事件标记） |
| TC-23 | `payloadPreviewLines({ fields:['event','session','prompt'] })` 返回值**不变**（仍是三行含 `**类型**`，既有用例 TC 不动） |

> 区分两个区块的办法（实施时二选一）：按渲染树的区块标题「飞书卡片」/「纯文本（…）」切段，或给卡片区容器加 `data-dnw-region="feishu-card"` 后按属性取段。

## 6. 端到端（`test/e2e.local.test.js` 扩展）（serves: FR-1, FR-2, FR-3, FR-4）

复用既有 `withReceiver()` + `createNotifier()`（真起本地 HTTP 接收端）。

| 用例 | 操作 | 期望 |
|---|---|---|
| TC-24 | 目标指向接收端，喂 `user/message{kind:'dive'}` → `turn/end(completed)` | `received.length === 0`（**0 条报文**） |
| TC-25 | 紧接着喂 `user/message{kind:'user'}` → `turn/end(completed)` | `received.length === 1`；`msg_type === 'interactive'`；`card.header.title.content === '✅ 对话完成'`；`JSON.stringify(card)` **不含** `**类型**` |
| TC-26 | 喂 `user/message{kind:'dive'}` → `turn/end(error)` | `received.length === 1`；`card.header.title.content === '⚠️ 会话中断'` |

## 7. 回归锁与不做（serves: FR-5）

| 用例 | 断言 |
|---|---|
| TC-27 | `node --test "test/*.test.js"` → `fail 0`，`tests ≥ 288` |
| TC-28 | 文本渠道用例（`test/channels.cn.test.js` / `channels.global.test.js`）**一字不改**且全绿 —— 证明「不改文本渠道」 |
| TC-29 | `grep -rn "'goal'" src/` → **仅** `src/goal.js` 的 goal 终态通路（`goal/change`、`EVENT_GOAL_*`）保留；用户消息来源判定处**不再出现** `'goal'` 字面量 |

## 8. 验收口径（整体）（serves: FR-1, FR-2, FR-3, FR-4, FR-5）

对照需求文档「验收标准（整体）」六条，逐条映射：① TC-6/7/8/24 ② TC-9/25 ③ TC-11/12/26
④ TC-10 ⑤ TC-17/18/19/21/22 ⑥ TC-27。
