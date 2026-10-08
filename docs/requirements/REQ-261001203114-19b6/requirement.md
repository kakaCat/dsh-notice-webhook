---
requirement_id: REQ-261001203114-19b6
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend, frontend]
---

# 需求说明（REQ-261001203114-19b6）

> 面向：产品、开发、测试、使用者——**写给人看，不是写给代码看**。

## TL;DR

- **这是什么**：把 `turn/end` 的**终态**（`reason.kind`）当成一等公民来分类——只有 `completed` 才配叫「已完成」，
  `error` / `interrupted` / 未知终态叫「**会话异常中断**」，其余既不叫也不谎报。
- **为什么现在做**：使用者实测——`DeepSeek Messages stream: tool input is invalid JSON`（`LlmError` / `MALFORMED_RESPONSE`）
  让本轮以 `turn/end(reason.kind='error')` 收尾、**agent 就此停下不工作**，而插件推给用户的却是「**会话已完成**」。
  误报比漏报更伤：用户据此以为任务跑完了。
- **做完得到什么**：agent 因报错 / 崩溃停下时收到一条「会话异常中断（MALFORMED_RESPONSE）」；
  并且**再也不会**收到假的「已完成」。

## L1 一句话目标与判定标准

**目标**：本插件对 `turn/end` 的结论必须与 DSH 的真实终态一一对应——`completed` 才是完成，`error`/`interrupted`/未知是中断，谁都不许兜底成「已完成」。

**可证伪判定**（跑什么、看到什么算完成）：

| # | 跑什么 | 看到什么算过 |
|---|---|---|
| 1 | `node -e` 逐 kind 调 `Classifier.classify`（7 种终态） | 输出与「终态分类表」（FR-1）**逐行一致**：只有 `completed` 是 `complete`；`error`/`interrupted`/未知是 `interrupt`；其余为 `null` |
| 2 | `node --test test/classify.test.js` | 新增断言全绿；`error` 的期望值**不再是** `complete` / 「会话已完成」 |
| 3 | 本地接收端 + 注入 `turn/end(error: MALFORMED_RESPONSE)` | 收到 `event:"turn/error"`、`reason:"error"`、`error.code:"MALFORMED_RESPONSE"`，且**收不到** `event:"turn/end"` 的完成报文 |
| 4 | `notifyInterrupt:false` 重跑第 3 步 | 0 条报文（**尤其不得**出现「会话已完成」） |
| 5 | `skipReasons:['error']` 重跑第 3 步 | 0 条报文（静默名单优先于开关） |
| 6 | `node --test "test/*.test.js"` | 基线 `tests 244 / pass 244 / fail 0`，本次**只增不减**，fail 0 |

## 档位与升级记录

- 立项时按 **feature / expert** 受理。
- 本节点维持 **轻档**：改动面 = 一个分类函数（`src/classify.js`）+ 路由一条分支（`src/router.js`）+ 三个配置键（`src/config.js`）+
  报文两个追加字段（`src/channels/custom.js`）+ 事件元数据与静态清单（`src/payload.js` / `src/targets.js` / `client.js` 各一行）+ 文档同步；
  **不动架构、不新增子系统、不改出站契约版本、不新增落盘数据、不升文件格式版本**。
- 立项当日已由人在对话里裁决三条产品决策（有据可查，非本档自定）：
  - **D1（人已裁决）**：出站**新增 `event` 取值 `turn/error`**（而非复用 `turn/end` + `reason` 字段）——接收端可按 `event` 分流。
  - **D2（人已裁决）**：中断通知覆盖 **`error` / `interrupted` / 未知 kind**；`blocked` / `max-tokens` / `forked` **不推送**（口径见 FR-1）；
    `aborted`（用户自己按 Esc）永远静默。
  - **D3（人已裁决）**：新增**独立类型开关** `notifyInterrupt`（默认开），不并进 `notifyComplete`。
- 升级是单向的。出现下列任一信号立即停手升级为重档并重写本文：要求 `blocked`/`max-tokens` **也**推送（即引入按 kind 的独立开关与文案矩阵）、
  要求中断通知**可重试/可去重窗口**（引入新的状态机）、或要求把 `error.message` 全文/堆栈带入正文（引入敏感信息与排版策略）。

## 产品定义

**终态可信的通知**：把完成类通知的触发条件从「这一轮结束了」修正为「**这一轮是正常结束的**」。

**核心价值**：这个插件的全部价值是「该被叫一声」的信噪比。误报「已完成」有两种伤害——白跑一趟（回来发现任务停在半路），
以及**信号失效**（下次真完成时不当回事）。修好之后：收到「会话已完成」= 真的可以回来了；收到「会话异常中断」= 需要你看一眼。

**与现状的区别**：

- 现状（`src/classify.js`）：`turn/end` 只做一次判定——`kind` 命中 `skipReasons` 就静默，**否则一律当完成**
  （实测：`error` / `blocked` / `max-tokens` / `forked` 全部被判成 `complete`，正文「会话已完成」）。
- 本需求：按 DSH 真实终态集合分类；`error` 带错误码进结构化字段；未知终态按「未知」上报而**不是**按「完成」上报。

**分类流程（一眼看清「谁在什么条件下叫」）**：

```
 session/event ─► turn/end ─► reason.kind
                                 │
                                 ├─ 命中 skipReasons（默认 [aborted]）──► 静默
                                 │
                                 ├─ completed ────────────────────────► 「会话已完成」
                                 │                                      event: turn/end
                                 │
                                 ├─ error ─────┐
                                 ├─ interrupted ├─────────────────────► 「会话异常中断（code）」
                                 └─ 未知 kind ──┘                       event: turn/error
                                                                        + reason / error{code,message}
                                 │
                                 └─ blocked / max-tokens / forked ────► 静默 + drop 留痕
                                                                        （不叫，但绝不谎报「已完成」）
```

**终态分类表（写死在此，实现与测试以此为准）**：

| `reason.kind` | 含义（DSH 事实） | 现状 | 本需求 |
|---|---|---|---|
| `completed` | 正常结束 | 完成 | **完成**（不变） |
| `error` | 本轮失败，`error` 为 `LlmError` 事实（如 `MALFORMED_RESPONSE`） | ❌ 谎报「已完成」 | **中断**（带 `code` / `message`） |
| `interrupted` | 崩溃孤儿 turn 被事后补写收尾（agent 曾中断不工作） | 静默丢弃 | **中断** |
| 未知 kind（含 DSH 未来新增） | `TurnEndReasonMap` 是可合并扩展的 | ❌ 谎报「已完成」 | **中断**（带 kind 原文） |
| `aborted` | 取消请求打断了本轮（用户自己按的 Esc） | 静默 | **静默**（不变） |
| `blocked` | 本轮准入被拒，**没花模型调用** | ❌ 谎报「已完成」 | 不叫，也**不谎报**（静默 + `drop` 原因码） |
| `max-tokens` | 有 step 触顶（可能被插件续跑） | ❌ 谎报「已完成」 | 同上 |
| `forked` | fork 边界收尾（仅 fork 种子；子会话另被 `onlyTopLevel` 过滤） | ❌ 谎报「已完成」 | 同上 |

## 用户与角色

| 角色 | 什么场景用 | 痛点 |
|---|---|---|
| 开发者本人 | 让 agent 跑长活，自己去干别的 | 收到「会话已完成」，切回来发现 agent 早就报错停了（本次反馈场景） |
| 值守 / 团队群 | 群里看到「已完成」就当无人值守收工 | 误报让「完成」这个信号整体贬值 |
| 本包维护者 | 维护通知语义与事件契约 | 手上只有 `turn/end` 一个信号，终态被压成一个布尔 |

## 功能点（需求条款）

### 功能点清单

- **FR-1: `turn/end` 终态按 kind 分类，禁止兜底成「完成」**（P0）——判定顺序：静默名单 → `completed` → 中断三类 → 其余不叫也不谎报
- **FR-2: 中断意图的内容与错误事实**（P0）——正文带短原因（`code`），结构化字段带 `error.code` / `error.message`（单行化 + 限长）
- **FR-3: 出站新增 `event` 取值 `turn/error`**（P0）——`turn/end` 语义收窄为「正常结束」；`custom` 报文追加 `reason` / `error`，`version` 保持 `1`
- **FR-4: 开关、文案与静默名单**（P0）——`notifyInterrupt`（默认开）、`interruptMessage`；`skipReasons` 语义收紧为静默名单且默认改为 `['aborted']`
- **FR-5: 配置面与文档同步（含老目标隐式全收迁移）**（P0）——`EVENT_TYPES` / 设置页「关心事件」新增一项；**否则新事件到不了任何既有目标**
- **FR-6: 可观测与回归**（P1）——静默丢弃给 `drop` 原因码；基线 244 用例只增不减

**优先级说明**：P0 = 缺了核心价值不成立；P1 = 本期尽量交付。

### 功能点 FR-1：`turn/end` 终态按 kind 分类，禁止兜底成「完成」

- 只有 `kind === 'completed'` 产出完成意图（`kind:'complete'`, `event:'turn/end'`）——**保持不变**。
- `kind ∈ {error, interrupted}` 或 **kind 非字符串 / 不在已知集合内** → 中断意图（`kind:'interrupt'`, `event:'turn/error'`）。
- 静默（返回 `null`）的唯一来源有两处：① `kind` 命中 `skipReasons`；② `kind === 'aborted'`（并默认写进 `skipReasons`）。
- `kind ∈ {blocked, max-tokens, forked}` → 返回 `null` 并**留痕**（`drop` 原因码 `turn-not-notifiable`，含 kind）。
  理由：它们不代表「干活干到一半停住」，叫了是噪音；但兜底成「已完成」是谎报，必须去掉。
- **顺序写死**：`skipReasons` 命中 → 静默；`completed` → 完成；`error`/`interrupted`/未知 → 中断；其余 → 静默 + 留痕。
  （`skipReasons` 因此获得「我不想被叫」的最终否决权，用户可自加 `error`。）
- **不得**新增任何「默认当完成」的分支——这是本需求的全部要点。

### 功能点 FR-2：中断意图的内容与错误事实

- 意图形状（对内契约）：

  ```
  { kind: 'interrupt', event: 'turn/error', message, toolName: null, reason: <kind 原文>, error: { code, message } | null }
  ```

- `message`：`标题 · <interruptMessage><短原因>`（`includeTitle` 语义沿用既有 `withTitle` 包装）：
  - `reason === 'error'` → 短原因 = `（code）`，`code` 缺省或非字符串时用 `UNKNOWN`；
  - `reason === 'interrupted'` → **不带**短原因；
  - 未知 kind → 短原因 = `（kind 原文）`（截断 40 字符）。
  - 例：`修复登录 bug · 会话异常中断（MALFORMED_RESPONSE）`
- `error` 字段：仅 `reason === 'error'` 时非 null；`message` 取 `event.data.reason.error.message`，**单行化（空白折叠）+ 截断 200 字符**；
  `code` 非字符串时用 `UNKNOWN`。其余情况 `error` 为 `null`（`reason` 仍带 kind）。
- **`error.message` 不进正文**：详情走结构化字段，正文只留短原因——避免刷屏，也避免换行破坏各渠道排版。

### 功能点 FR-3：出站新增 `event` 取值 `turn/error`

- `turn/end` 语义**收窄为**「正常结束」；中断一律走新取值 `turn/error`（D1）。
- `custom` 渠道 v1 报文**追加**两个字段、`version` 保持 `1`（追加式，不升版本）：

  ```json
  { "version": 1, "event": "turn/error", "message": "修复登录 bug · 会话异常中断（MALFORMED_RESPONSE）",
    "reason": "error", "error": { "code": "MALFORMED_RESPONSE", "message": "DeepSeek Messages stream: tool input is invalid JSON" } }
  ```

  其余字段（`context` / `title` / `toolName` / `goal` / `sessionId` / `workspace` / `at` / `source`）形状不变。
- 企微 / 飞书 / 钉钉 / Slack / Discord 五渠道**报文形状不变**，只发正文与标题。
- `src/payload.js` 的 `EVENT_META` 增加 `'turn/error': { title: '⚠️ 会话中断', color: 'red' }`（未知事件本就有中性回落）。

### 功能点 FR-4：开关、文案与静默名单

- 新增配置键：`notifyInterrupt`（boolean，默认 `true`，**volatile**）、`interruptMessage`（string，默认 `"会话异常中断"`）。
- `skipReasons` **语义收紧为「静默名单」**，默认值由 `['interrupted','aborted']` 改为 `['aborted']`：
  命中即**完全不推**，且优先于 `notifyInterrupt`。
- 关掉 `notifyInterrupt` = 中断类**静默**；**不得**回落到「当完成推」。
  这是本包「开关关掉 = 逐字回到旧行为」惯例的**唯一例外**，理由：旧行为在 `error` 上是**谎报**，不提供「退回谎报」的开关。
- 中断意图**不受**自动轮静默影响：`index.js` 的 `intent.kind === 'complete' && autoRound → silent` 分支只对完成意图生效；
  goal 自动轮里 agent 报错停下，正是最需要叫人的时刻（这条必须有一条测试锁死）。

### 功能点 FR-5：配置面与文档同步（含老目标隐式全收迁移）

- `src/targets.js` 的 `EVENT_TYPES` 增加 `'turn/error'`；设置页「关心事件」增加一项「会话中断」
  （`client.js` 的 `EVENTS`，顺序排在「对话完成」之后，`field: 'turn/error'`）。
- **老目标的隐式全收迁移（关键，否则新事件到不了任何既有目标）**：现有 UI 新建目标时把「全选」写成**显式四项**
  （`client.js:997` 的 `EVENT_IDS.slice()`），而 `targetAccepts` 对非空 `events` 走白名单 → 加入 `turn/error` 后，
  这些目标会把中断通知**全部过滤掉**。因此：读取 `targets.json` 时，若某目标 `events` **集合上恰等于旧版全集**
  `{turn/end, ask_user_question, approval/asked, goal/*}`，在**内存中**归一化为 `[]`（= 全收）。
  - 判等用**集合相等**（顺序无关、去重后比较），只认「恰好等于旧版全集」这一种形态；
  - **不改文件格式、不升 `TARGET_FILE_VERSION`**（保持 3）——回滚到旧版本时文件仍被正确读取；
  - 归一化幂等；用户显式勾选过子集（少勾了任一项）的**不动**，尊重其选择。
- 文档同步：`README.md`「推送契约」的 `event` 取值枚举与配置项表、`docs/architecture/notification-plugin.md` 的事件分类表、
  `docs/guides/operations.md` 的 `drop` 原因码。

### 功能点 FR-6：可观测与回归

- 静默丢弃留痕（debug 日志 + 决策结果 `reason`）：`turn-not-notifiable`（`blocked`/`max-tokens`/`forked`）、
  `turn-aborted`（`aborted`）、`turn-skipped`（`skipReasons` 命中）；均带 kind 原文。
- 中断投递结果进既有「最近投递」（`OutcomeStore`），与其它事件同口径。
- 回归：`node --test "test/*.test.js"` 基线 `tests 244 / pass 244 / fail 0`，本次**只增不减**；
  既有断言中把 `error` 期望成「完成」的写法必须改写为「中断」——这是修缺陷，不是改测试迁就实现。

## 接口契约

### 一、对内（模块与接线）

| 接口 | 输入 | 输出 / 语义 |
|---|---|---|
| `Classifier.classify(session, event)` | 同既有 | `null` = 不推（静默）；`{ kind:'complete', event:'turn/end', message, toolName:null }`；**新增** `{ kind:'interrupt', event:'turn/error', message, toolName:null, reason, error }` |
| `INTENT_INTERRUPT`（`src/classify.js` 新增导出） | — | `'interrupt'`；`EVENT_TURN_ERROR = 'turn/error'` 同步新增 |
| `Router.isTypeDisabled(intent)` | 同既有 | 新增分支：`intent.kind === INTENT_INTERRUPT && config.notifyInterrupt === false` → `true` |
| `handle(session, event, now)` | 同既有 | 新增返回 `{ action:'dropped', reason:'turn-not-notifiable' \| 'turn-aborted' \| 'turn-skipped', intent?: null }`（静默留痕）；中断走既有 `dispatch` |
| `custom.buildPayload({ intent, … })` | 同既有 | 追加 `reason`（string）与 `error`（`{code,message}` \| `null`） |

### 二、出站报文（插件 → 接收端）

- 新增取值 `turn/error`（追加式，`version` 仍 `1`）；新增字段 `reason` / `error`（追加式）。
- 接收端兼容性**如实写进 README**：只认 `turn/end` 的老接收端将**收不到**中断通知（D1 的已知代价），
  需要按 `turn/error` 分流或忽略。
- 不跟随重定向、日志只记 host、密钥不回显等既有约束不变。

## 数据契约

| 数据 | 形态 | 持久化 | 说明 |
|---|---|---|---|
| `notifyInterrupt` | boolean，默认 `true` | 是（插件配置，标 `volatile`） | 关掉 = 中断静默（FR-4） |
| `interruptMessage` | string，默认 `"会话异常中断"` | 是（插件配置） | 正文骨架（FR-2） |
| `skipReasons` | string[]，默认 `['aborted']`（**由 `['interrupted','aborted']` 变更**） | 是（插件配置） | 语义收紧为「静默名单」，命中优先于一切（FR-1/FR-4） |
| `targets.json` 的 `events` | string[] → 载入时**内存归一化** | 文件**不改**（版本仍 3） | 恰等于旧版全集 → 归一化为 `[]`（全收）（FR-5） |
| `OutcomeStore` | 内存，每目标最近 5 条 | 否（不变） | 中断投递同口径记录 |

**不新增/不改动**：`targets.json` / `bindings.json` 的字段与版本号、RPC 契约、`payload` 字段投影与模板、goal 通路。

## 迁移与兼容

- **`skipReasons` 默认值变更**：未显式配置的用户升级后，`interrupted` 由静默变为**推送中断**（这正是本需求的目的）；
  显式写过 `['interrupted','aborted']` 的用户维持静默（尊重其手写配置）。
- **老目标事件白名单**：按 FR-5 在**内存**中把「恰好等于旧版全集」归一化为全收；不改文件、不升版本、幂等。
- **接收端**：新增 `event` 取值属追加式；只认 `turn/end` 的老接收端收不到中断通知，README 明示。
- **回滚路径**：装回旧版本插件即可（文件格式未变、未新增落盘文件，卸载/回滚即净）。
  注意：`notifyInterrupt:false` **不是**回滚开关（它给静默，不给谎报）。
- **测试兼容**：既有 244 个用例中，仅允许改写「`error` 当完成」相关断言；其余不得改动。

## 边界（不做什么）

- **不做错误自动重试 / 自动续跑**：那是 DSH `llm-retry` 与 agent-loop 的职责；本插件只**如实上报**终态。
- **不把 stream 原始事件或错误堆栈搬进正文**：只取 `code` 与截断后的 `message`，且 `message` 只走结构化字段。
- **不给「退回谎报完成」的开关**（FR-4 明示的唯一惯例例外）。
- **不做按 kind 的独立开关与文案矩阵**：只有 `notifyInterrupt` 一个粗开关 + `skipReasons` 静默名单；
  `blocked` / `max-tokens` / `forked` 本次**不推送**（要推走后续需求）。
- **不做中断去重 / 重试窗口**：DSH 重试成功的请求不会产生 `turn/end(error)`，无需自建状态机。
- **不改 goal 终态通知**（`goal/complete`、`goal/blocked` 是独立通路）、**不改授权 / 提问两类通知**。
- **不改其余五渠道的报文形状、不动 RPC 契约、不新增落盘文件、不升文件格式版本**。

## 非功能需求

- **不阻塞会话**：分类是纯同步函数；`error.message` 的单行化与截断在分类里算完，回调里不做 I/O。
- **失败隔离**：`event.data` 缺字段 / 类型不对**一律不抛**——`kind` 非字符串即走「未知 kind → 中断」分支；
  分类中的任何异常都不得让会话报错、不得让插件停止工作。
- **日志洁净**：Host 日志只记 `code` 与 kind，**不记** `error.message` 全文（可能含 prompt 片段）；完整 message 只进用户自己的 webhook 报文。
- **可测性**：分类为纯函数、无 `node:` 依赖、无时钟依赖，离线可断言全部 8 行分类表。

## 验收标准（整体）

1. **分类表**：逐 kind 断言（`completed`/`error`/`interrupted`/未知/`aborted`/`blocked`/`max-tokens`/`forked`）与 FR-1 表逐行一致。
2. **不再谎报**：`error` 不得产出 `event:'turn/end'` 的任何报文（本缺陷的回归锁）。
3. **中断报文**：`event:'turn/error'`、`reason:'error'`、`error.code === 'MALFORMED_RESPONSE'`、`message` 含短原因、`error.message` 已单行化且 ≤200 字符。
4. **开关**：`notifyInterrupt:false` → 0 条；且**不得**出现「会话已完成」。
5. **静默名单优先**：`skipReasons:['error']` → 0 条。
6. **自动轮不静默**：goal 自动轮（无人工输入）中的 `error` → 照常推中断；同轮 `completed` → 仍静默。
7. **老目标迁移**：`events` 恰为旧版四项的目标在 `targetAccepts('turn/error')` 下**放行**；少勾一项的目标**仍被过滤**；文件字节未变。
8. **回归**：`node --test "test/*.test.js"` → fail 0，用例数 ≥244。

**可执行判定命令**：

```sh
# 分类表现场复现（改动前后对照；改动后 error/interrupted/未知 应变成 interrupt）
node -e "import('./src/classify.js').then(async m=>{const {normalizeConfig}=await import('./src/config.js');const c=new m.Classifier(normalizeConfig({}));const s={header:{}};for(const k of ['completed','error','interrupted','blocked','max-tokens','aborted','forked','weird-new-kind'])console.log(k,'=>',JSON.stringify(c.classify(s,{type:'turn/end',data:{reason:{kind:k,error:k==='error'?{message:'DeepSeek Messages stream: tool input is invalid JSON',code:'MALFORMED_RESPONSE'}:undefined}}})))})"

# 全量回归（改动前基线 244 passed / 0 failed）
node --test "test/*.test.js"

# 本次新增的分类与迁移用例（计划落在 test/classify.test.js 与 test/targets-events.test.js）
node --test test/classify.test.js
```

```sh
# 端到端（真机观察）：起本地接收端，触发一次流错误，观察是否收到 turn/error
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(q.url,b);s.end('{}')})}).listen(8899,()=>console.log('listening 8899'))"
```

## 依赖与约束

- **依赖（事实）**：DSH `turn/end` 的终态集合由 `TurnEndReasonMap` 定义（`packages/core/session/src/types.ts`）：
  `completed` / `aborted` / `blocked` / `error` / `max-tokens` / `interrupted` / `forked`，且该 Map **可被插件合并扩展**（故必须处理未知 kind）。
- **依赖（事实）**：`MALFORMED_RESPONSE` **不在**默认重试码内（`packages/llm/llm/src/retry-policy.ts` 的 `DEFAULT_RETRYABLE_CODES`
  = `EMPTY_RESPONSE`/`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`），因此流报错会一路走到 `turn/end(error)` 并让本轮停下——
  本需求修的就是这条路径的**通知**。
- **约束**：不新增包依赖（`package.json` 的 `dependencies` 不动）。
- **约束**：既有测试文件只允许改写「`error` 当完成」相关断言，新增用例独立成节/独立文件。
- **约束**：`drop` 原因码必须同步进 `docs/guides/operations.md`（FR-5/FR-6）。

<!-- reqboard:marks:begin 机器维护，请勿手改 -->

#### 条款接收状态（随卡的生命周期自动更新）

| 编号 | 接收状态 | 承载任务 |
|------|---------|---------|
| FR-1 | ✅ 已接收 | t1、t3 |
| FR-2 | ✅ 已接收 | t1、t4 |
| FR-3 | ✅ 已接收 | t4、t8 |
| FR-4 | ✅ 已接收 | t3、t7 |
| FR-5 | ✅ 已接收 | t8、t2、t5、t6 |
| FR-6 | ✅ 已接收 | t3、t7、t9 |

> 无未接收条款（6 条全部有落点）。

<!-- reqboard:marks:end -->
