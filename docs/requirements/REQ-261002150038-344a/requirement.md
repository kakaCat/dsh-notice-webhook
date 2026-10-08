---
requirement_id: REQ-261002150038-344a
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5]
sides: [backend]
---

# 需求说明（REQ-261002150038-344a）

> 轻档需求：仪式短，**产物照旧**（本文件即产物）。

## TL;DR

- **这是什么**：把「系统自己注入的轮次」从「人说的话」里摘出来——Dive 自动续跑（pmboard 注入，`source.kind: 'dive'`）与插件注入
  （`source.kind: 'plugin'`）不再被当成人工轮推送「对话完成」；注入正文也不再冒充「任务」。
- **为什么现在做**：使用者实测收到 `REQ-260930230225-71be`「Dive 模式自动续跑，第 35 回合」的「对话完成」通知。
  看板 Dive 会连续自动跑几十轮，**每轮一条通知 = 刷屏**；而 README 承诺的「系统自己唤醒的轮次不该吵人」只覆盖了 goal 轮。
- **顺带**：飞书卡片正文的「类型」行与卡片标题（✅ 对话完成）完全重复，删掉。
- **做完得到什么**：自动跑时安静；人插话 / 人发起 / 出异常中断时才响；卡片不再有一行冗余。

## 判定总览（一图流）

```
        turn 内的所有 user/message
                    |
        +-----------+-----------+
        |                       |
  source.kind 缺失/'user'   其余 kind(goal/dive/plugin/…)
        |                       |
     direct human             注入消息
        |                       |
  本轮出现过人 → 不算注入轮   本轮无人消息 → 判为注入轮
        |                       |
   turn/end(completed)      turn/end(completed) → 静默（0 报文）
        |                  turn/end(error/interrupted/未知) → 照推
   照推「对话完成」

  飞书卡片：header「✅ 对话完成」+ 类型行「✅ 对话完成」  ──改为──>  只留 header
```

## L1 一句话目标与判定标准

**目标**：只有 **direct human**（`source` 缺失，或 `source.kind` 缺失 / `=== 'user'`）发起的轮次才可能推「对话完成」；
注入轮（`goal` / `dive` / `plugin` / 未来新增 kind）整轮静默，注入文本不得作为「任务」展示；
飞书卡片删掉与标题重复的「类型」行。

**可证伪判定**（跑什么 → 看到什么算过）：

| # | 跑什么 | 看到什么算过 |
|---|---|---|
| 1 | `node --test test/goal.auto.test.js` | 新增用例：注入 `user/message{source:{kind:'dive'}}`（及 `'plugin'`）+ `turn/end(completed)` → **0 条意图**；注入轮内再出现 direct human 消息 → 照常产出意图 |
| 2 | `node --test test/payload.test.js` | 注入消息不进 promptTracker：只有注入消息时 `take()` 为 `null`；既有真人消息后仍取到真人文本 |
| 3 | `node --test test/channels.feishu.test.js` | `card.elements[0].fields` 拼接文案**不含** `**类型**`；`header.title.content` 与 `header.template` 不变 |
| 4 | `node --test "test/*.test.js"` | `fail 0`，用例数 **≥ 288**（基线），只增不减 |
| 5 | `node --test test/e2e.local.test.js`（本地接收端） | 注入 dive 轮 → 接收端 **0 条**报文；随后 direct human 轮 → 1 条 `turn/end` 完成报文 |

> 基线（本次改动前实测）：`tests 288 / pass 288 / fail 0`。

## L2 范围边界（≤3 条）

1. **做**：统一「注入轮」判定口径为 direct-human，用于两处——① 轮次静默（完成意图不推）；② 「任务」字段取值（只认真人输入）。
2. **做**：飞书卡片 `buildCard` 去掉「类型」行（标题栏已给出 ✅ 对话完成）。
3. **不做**：不改文本渠道默认字段（`DEFAULT_FIELDS` 保留 `event`——去掉会让文本渠道丢失事件 emoji 标记）；
   不新增配置键；不改 goal 终态 / 授权 / 提问通路；不动出站契约版本与落盘格式。

## L3 轻路径依据与单向升级

**依据**：改动面 = 一个判定函数 + 3 个调用点（`src/goal.js` 轮次标记、`src/payload.js` promptTracker、`src/channels/feishu.js` 卡片）+ 测试；
**无新决策点**——direct-human 口径在本机 pmboard 已是既成事实（其 capture hook：`sourceKind !== undefined && sourceKind !== 'user'` → 非 direct human，
见 `~/.dsh/profiles/web/node_modules/dsh-pmboard/dist/index.mjs` 的 `eventSourceKind` 用法），本需求只是把同一口径搬到通知插件。

**升级信号（出现任一 → 立即停手升级重档，单向不可逆）**：
① 要为「哪些注入轮可豁免」引入按 kind 的开关 / 白名单配置（引入新配置矩阵）；
② 要改文本渠道字段默认值并升出站契约版本；
③ 要把「类型」行改成别的形态（并入 payload template 变量语义等）。

## L4 批准闸门 + 下一步

下一步：**design** —— 用 `reqboard_ask_confirm(target=artifact, kind=requirement)` 请人确认；未获批准不得进入设计。

## L5 轻档 ≠ 无产物

产物 = `docs/requirements/REQ-261002150038-344a/requirement.md`（本文件，头部带 REQ id），
用 `reqboard_submit(kind=requirement)` 登记，再用 `reqboard_ask_confirm` 请人确认。

## 产品定义

**安静的通知**：知会只发生在「人在等结果」的时刻。

- **现状（缺陷）**：`src/goal.js` 只把 `source.kind === 'goal'` 认作自动轮，Dive 的 `'dive'` 与插件的 `'plugin'` 被当成人工轮；
  `src/payload.js` 的 promptTracker 同样只跳过 `'goal'`。于是自动续跑每轮推一条「对话完成」，
  并且把注入正文当成「任务」显示（截图里的 `任务 继续执行需求 REQ-…（Dive 模式自动续跑，第 35 回合）` 就是注入正文）。
- **改成**：本轮出现过非 direct human 的 `user/message`、且**没有**任何 direct human 消息 → 判为注入轮 → 完成意图静默。
  **中断照推**（`error` / `interrupted` / 未知终态，沿用既有语义：自动轮里出事更要叫人）。
- **卡片**：飞书卡片标题栏已给出事件（✅ 对话完成 / ⚠️ 会话中断 / ❓ 等待回答 / 🔐 等待授权），正文再列一行「类型」是纯重复。

**与现状的区别**：自动跑安静（噪音 ≈ 0）；真人参与的一轮不漏（人插话即恢复正常通知）；中断不漏（信号不失效）。

## 用户与角色

- **用通知的人**（看板 Dive 的使用者）：自动跑不吵；自己发起的、或自己插话的那一轮照常响；出事（中断）一定响。
- **接收端**：飞书卡片少一行「类型」；其余渠道与字段一字不改。
- **维护者**：口径集中在一个纯函数里，注释写清「为什么只认 direct human、为什么不能只认 'goal'」。

## 功能点（需求条款）

### 功能点清单

| 编号 | 名称 | 优先级 |
|---|---|---|
| FR-1 | 注入轮按 direct-human 口径识别 | P0 |
| FR-2 | 注入轮的完成意图整轮静默（中断照推） | P0 |
| FR-3 | 注入文本不得进入「任务」字段 | P1 |
| FR-4 | 飞书卡片删除重复的「类型」行 | P1 |
| FR-5 | 回归与文档同步 | P1 |

### 功能点 FR-1：注入轮按 direct-human 口径识别

- **FR-1: direct human 判定 = `source` 缺失，或 `source.kind` 缺失，或 `source.kind === 'user'`；其余 kind（含 `goal` / `dive` / `plugin` 与未来新增）一律判为注入。**
  - 「注入轮」= 本轮出现过注入的 `user/message`，且本轮**没有**任何 direct human 的 `user/message`。
  - 一轮里**完全没有** `user/message` 时维持现状：**不**判为注入轮（不静默）——避免把「结构未知」误当「自动」。
  - 判定只读结构化 `source`，不做文本特征匹配（注入正文可能被人为改写，文本匹配必失效）。

### 功能点 FR-2：注入轮的完成意图整轮静默

- **FR-2: 注入轮的 `turn/end(completed)` 不产生任何推送（主链路返回 `{action:'silent'}`），且 `error` / `interrupted` / 未知终态照旧推送。**
  - 与既有 FR-4（REQ-261001203114-19b6）一致：静默只作用于**完成**意图。
  - 静默不写冷却、不消耗投递、不进 outcome 记录（与现有 goal 自动轮静默同一条路径）。

### 功能点 FR-3：注入文本不得进入「任务」字段

- **FR-3: promptTracker 只记录 direct human 的 `user/message`；本轮无人工输入时「任务」行整行消失（与现有无输入行为一致）。**
  - 反例（现状）：截图里「任务」行取自 Dive 注入正文，看起来像「用户要求继续执行」，属于误导。
  - 注入轮既然静默，本条的可见效果主要落在「注入 + 人工插话」的轮次：此时「任务」显示的必须是**人**那句。

### 功能点 FR-4：飞书卡片删除重复的「类型」行

- **FR-4: 飞书交互式卡片正文不再输出「类型」行；`header.title.content`、`header.template` 与其余字段（会话 / 工作区 / 任务 / 详情 / 时间）的形状与顺序不变。**
  - 只改飞书卡片；文本类渠道（企微 / 钉钉 / Slack / Discord / custom）报文一字不改。
  - 无上下文（老调用方直调）时的纯文本回落路径不变。

### 功能点 FR-5：回归与文档同步

- **FR-5: 全量测试 `fail 0` 且用例数 ≥ 288；README 把「系统自己唤醒的轮次不该吵人」的口径补全为 goal / dive / plugin 注入轮一律静默。**

## 接口契约

**对内（模块与接线）**

- 新增纯函数：`isHumanSource(source) -> boolean`（`source` 缺失 / `source.kind` 缺失 / `=== 'user'` → true）。
- `GoalTracker.observe` 的轮次标记由「见过 goal / 见过人工」改为「见过注入 / 见过人工」；
  `GoalTracker.isAutoRound(session)` 语义收敛为「见过注入且无人工」；无 `user/message` 的轮次仍返回 false。
- `createPromptTracker().observe` 改用同一判定，不再单点判断 `'goal'`。
- 调用点与返回形状不变：`index.js` 的 `handle()` 分支与返回值（`'sent' | 'dropped' | 'silent' | 'ignored'`）保持既有契约。

**出站报文（插件 → 接收端）**

- 不新增字段、不新增 `event` 取值；`PAYLOAD_VERSION` 保持 `1`。
- 唯一可见变化：飞书卡片 `elements[0].fields` 少一项「类型」（接收端按 label 渲染，无需升级）。

## 数据契约

- 不新增 / 不修改任何配置键（`notifyComplete` / `skipReasons` / `payload` 等语义不变）。
- 目标清单与绑定文件的字段与版本不动；不新增落盘文件。

## 迁移与兼容

- **旧接收端**：飞书卡片少一行，无需改动；其余渠道零影响。
- **行为变化（本次要的效果）**：以前会收到 Dive / 插件注入轮的「对话完成」，现在不会；中断仍会收到，故不存在「出事没人叫」。
- **回滚**：还原 `src/goal.js` / `src/payload.js` / `src/channels/feishu.js` 三处即回到当前行为，无落盘数据需要迁移。

## 边界（不做什么）

- **不改文本渠道的默认字段集**：`DEFAULT_FIELDS` 保留 `event`（「**类型**：✅ 对话完成」对纯文本渠道仍是唯一的事件 emoji 标记）。
  > 若你要求文本渠道也去掉这一行，请在确认时说一声（会改边界，可能触发升级信号 ②）。
- **不新增开关 / 白名单**：不做「哪些注入轮可豁免」的配置矩阵（要就另立需求）。
- **不改注入轮的中断语义**：`error` / `interrupted` / 未知终态照推，不得因静默而漏报。
- **不改 goal 终态通知**（`goal/complete`、`goal/blocked` 独立通路）、**不改授权 / 提问两类通知**。
- **不动 RPC 契约与设置页**、**不新增落盘文件**、**不升文件格式版本与出站契约版本**。

## 非功能需求

- **纯函数、无 I/O、无时钟依赖**：注入判定与卡片拼装均可离线断言。
- **失败隔离**：`event.data.source` 形状异常（非对象 / 非字符串 kind）一律按「注入」还是「人」需**明确**——
  本次定为：形状异常 → 视为注入轮（安静优先），但**不影响中断推送**；判定过程不得抛错影响会话。
- **演练可查**：静默时沿用既有 `logger.debug` 留痕口径，说明「为什么没收到」。

## 验收标准（整体）

1. **注入轮静默**：`dive` / `plugin` / `goal` 三种注入轮 + `completed` → 0 条报文（含端到端）。
2. **人不被误伤**：注入轮里出现 direct human 消息 → 照常推送，且「任务」为该人的文本。
3. **中断不漏**：注入轮的 `error` / `interrupted` / 未知 kind → 照常推送。
4. **无消息轮不静默**：整轮无 `user/message` 的 `completed` → 仍推送（维持现状）。
5. **卡片**：飞书卡片字段不含「类型」，标题 / 配色 / 其余字段顺序不变；文本渠道报文逐字节不变。
6. **回归**：`node --test "test/*.test.js"` → `fail 0`，用例数 ≥ 288。

<!-- reqboard:marks:begin 机器维护，请勿手改 -->

#### 条款接收状态（随卡的生命周期自动更新）

| 编号 | 接收状态 | 承载任务 |
|------|---------|---------|
| FR-1 | ✅ 已接收 | t1、t2 |
| FR-2 | ✅ 已接收 | t2、t6 |
| FR-3 | ✅ 已接收 | t3 |
| FR-4 | ✅ 已接收 | t4、t5 |
| FR-5 | ✅ 已接收 | t6 |

> 无未接收条款（5 条全部有落点）。

<!-- reqboard:marks:end -->
