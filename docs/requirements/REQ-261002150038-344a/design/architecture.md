---
title: 架构设计 · 通知去噪（注入轮静默 + 卡片去重）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 架构设计

> **TL;DR**：把「这条 `user/message` 是不是人说的」抽成**一个纯函数** `isHumanSource(source)`（`src/source.js`），
> 轮次静默（`GoalTracker`）与「任务」字段取值（`PromptTracker`）**都改用它**——口径只有一处，
> 以后 DSH 新增注入 kind 时**默认安静**而不是默认吵闹。飞书卡片删掉与标题重复的「类型」行，
> 设置页的卡片预览同步过滤（纯文本预览保留，文本渠道报文一字不改）。
> **链路、出站契约版本、落盘格式、配置键全部不动。**

## 1. 判定点：从「只认 goal」到「只认 direct human」（serves: FR-1, FR-2, FR-3）

```
   本轮的所有 user/message（按到达顺序喂给 GoalTracker / PromptTracker）
                |
                v
        isHumanSource(event.data.source)
                |
     +----------+-----------+
     |                      |
   true                   false
 （direct human）        （注入：goal / dive / plugin / 未来新增 / 形状异常）
     |                      |
 sawHuman = true        sawInjected = true
     |                      |
     +----------+-----------+
                v
   isAutoRound = sawInjected && !sawHuman
                |
   +------------+---------------------------+
   |                                        |
 completed 且 isAutoRound               其余情形
   |                                        |
 handle() 返回 {action:'silent'}      照旧 dispatch（含 error/interrupted/未知 → 中断）
   |                                        |
 「任务」字段 = 本轮 direct human 文本（没有则整行消失）
```

- **不再有「只认 `'goal'`」的分支**：`src/goal.js:85` 与 `src/payload.js:76` 两处 `=== 'goal'` 判断一并替换。
- **direct human 定义（唯一口径）**：`source` 缺失 / `source.kind` 缺失 → 人；`source.kind === 'user'` → 人；其余 → 注入。
  该口径与 pmboard 既成事实一致（`sourceKind !== undefined && sourceKind !== 'user'` 视为非 direct human）。
- **形状异常方向（显式决策）**：`source` 是非对象 / 数组，或 `kind` 存在但非字符串 → **判为注入**（安静优先）；
  但**不影响中断推送**——注入轮里 `error`/`interrupted`/未知终态仍然叫人。
- **一轮里完全没有 `user/message`** → `#rounds` 里没有记录 → `isAutoRound()` 返回 `false` → **不静默**（维持现状，
  不把「结构未知」当「自动」）。
- **`aborted` 与静默名单语义不动**：仍在 `decideTurnEnd()` 里，与本次改动不在同一层。

## 2. 模块改动地图（serves: FR-1, FR-2, FR-3, FR-4, FR-5）

| 文件 | 改动 | 服务 FR |
|---|---|---|
| `src/source.js`（**新增**，约 15 行） | `export function isHumanSource(source)`：纯函数、无依赖、无 I/O | FR-1 |
| `src/goal.js` | `observe()` 的轮次标记 `sawGoal` → `sawInjected`，判定改调 `isHumanSource`；`isAutoRound()` 语义随之收敛；类注释补「dive / plugin」 | FR-1, FR-2 |
| `src/payload.js` | `createPromptTracker().observe()` 不再单点判断 `'goal'`，改调 `isHumanSource`（注释同步） | FR-3 |
| `src/channels/feishu.js` | `buildCard()` 删掉 `cardField('类型', context.title)` 一行与其注释 | FR-4 |
| `client.js` | `PayloadPreview` 的**「飞书卡片」区**过滤掉默认渲染的 `**类型**：…` 行；「纯文本」区保留 | FR-4 |
| `index.js` | **不改**（`handle()` 里 `intent.kind === 'complete' && autoRound → silent` 这条分支本就存在，本次只是让 `autoRound` 认得更准） | FR-2 |
| 测试 4 份 + README | `test/goal.auto.test.js`、`test/payload.test.js`、`test/channels.feishu.test.js`、`test/client-render.test.js`、`test/e2e.local.test.js`；README「为什么需要它」补全注入轮口径 | FR-1…FR-5 |

> **为什么新增 `src/source.js` 而不是把函数塞进 `goal.js`**：`payload.js` 也要用同一口径，`payload → goal` 的依赖方向别扭；
> 而**改名 `goal.js`**（它已不只是 goal 层）会牵动 `index.js` 与 5 个测试文件的导入，收益低于成本。新增 15 行纯函数是**最小改动面**。

## 3. 链路：两条轮次的对照（serves: FR-1, FR-2, FR-3）

```
【Dive 注入轮】（现状会推 / 改后静默）
  pmboard: user/message{source:{kind:'dive', requirementId, round}}
      -> GoalTracker.observe : sawInjected = true
      -> PromptTracker.observe: 不记录（任务字段不会被注入正文污染）
      -> turn/end(reason.kind='completed')
      -> Classifier.classify -> INTENT_COMPLETE
      -> handle(): intent.kind==='complete' && isAutoRound -> { action:'silent' }   ← 0 报文
      -> goals.endRound(session) 清标记（下一轮从零开始）

【人工轮】（照常推）
  user: user/message{source:{kind:'user'}}（或 source 缺失）
      -> sawHuman = true -> isAutoRound() === false
      -> turn/end(completed) -> dispatch -> 飞书卡片（标题 ✅ 对话完成，正文无「类型」行）

【注入轮里出事】（照常推，信号不失效）
  dive 注入 -> turn/end(reason.kind='error')
      -> INTENT_INTERRUPT -> handle() 的静默分支只挡 complete -> 照常 dispatch
```

## 4. 不变量（serves: FR-2, FR-3）

1. **静默只作用于完成意图**：`silent` 判定只在 `intent.kind === 'complete'` 时成立（本次不动这一行）。
2. **注入文本永不进正文**：`PromptTracker` 只收 direct human 消息；「任务」行要么是人的原话，要么不存在。
3. **口径只有一处**：`'user'` / direct-human 字面量只允许出现在 `src/source.js`（grep 可验）。
4. **无消息轮不静默**：`#rounds` 无记录 → 不判自动轮。
5. **文本渠道报文零变化**：`DEFAULT_FIELDS` 与 `renderContext()` 不动。

## 5. 迁移、回滚与兼容（serves: FR-4, FR-5）

- **无数据迁移**：不新增配置键、不改目标 / 绑定文件、无落盘状态；`PAYLOAD_VERSION` 保持 `1`。
- **出站差异**：飞书卡片 `elements[0].fields` 少一项「类型」；其余渠道逐字节不变（老接收端无需改动）。
- **行为差异（本次目的）**：Dive / 插件注入轮不再推「对话完成」；真人轮、中断轮行为不变。
- **回滚**：还原 `src/source.js`（删除）、`src/goal.js`、`src/payload.js`、`src/channels/feishu.js`、`client.js` 五处即回到当前行为。
- **生效方式**：Host 半（`src/*`、`index.js`）需重启 Host；`client.js` 刷新页面即可（无构建步骤）。

## 6. 风险与降级（serves: FR-1, FR-2）

| 风险 | 处置 |
|---|---|
| DSH 未来用新的 kind 表示「人在键盘上打字」 | 接口少、可观测：`logger.debug` 已记录 `silent` 决策；判定函数是单点，一处改。**宁可漏推一次，也不刷屏**（与既有产品取向一致） |
| 注入轮里人插话却被判成自动轮 | 已用 `sawHuman` 兜住：只要本轮出现过 direct human 消息就不再静默；单测 T4 锁死 |
| 判定抛错影响会话 | `isHumanSource` 全分支返回布尔、不抛；既有 `apply()` 的 try/catch 仍在 |
| 客户端预览与 Host 卡片再次分叉 | 预览过滤规则与 `feishu.js` 同一条判断（默认 `**类型**：` 行），并在 T9 锁住 |

## 7. 测试策略（serves: FR-1, FR-2, FR-3, FR-4, FR-5）

- **单元（注入轮判定与静默）**：`test/goal.auto.test.js` 增 dive / plugin / 无消息轮 / 插话轮四类。
- **单元（任务字段）**：`test/payload.test.js` 增「注入不记、人记」。
- **渠道（卡片）**：`test/channels.feishu.test.js` 把「应有类型行」断言**翻转为「不应有」**，并保留 header 与其余字段断言。
- **客户端预览**：`test/client-render.test.js` 增卡片区无「类型」行、纯文本区仍有。
- **端到端**：`test/e2e.local.test.js` 起本地接收端，dive 轮 0 报文 + 人轮 1 报文。
- **回归**：`node --test "test/*.test.js"` → `fail 0` 且用例数 ≥ 288（基线，只增不减）。

## 8. 与需求文档的偏差记账（serves: FR-4, FR-5）

1. **`sides` 追加 frontend**：需求 front-matter 写的是 `[backend]`；设计追加一处 `client.js` 卡片预览过滤
   （否则「设置页预览有类型行、真卡片没有」= 预览说谎）。**不改接口 / 契约 / 数据**，属同一 FR-4 的呈现一致性。
2. **需求文档「不做：不改文本渠道默认字段」被遵守**：`DEFAULT_FIELDS` 保留 `event`，纯文本预览仍显示「**类型**：…」。
3. 无其他偏差。
