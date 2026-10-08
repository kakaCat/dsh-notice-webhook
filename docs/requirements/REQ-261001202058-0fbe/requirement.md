---
requirement_id: REQ-261001202058-0fbe
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend]
---

# 需求说明（REQ-261001202058-0fbe）

> 面向：产品、开发、测试、使用者——**写给人看，不是写给代码看**。

## TL;DR

- **这是什么**：给通知插件的「完成类通知」补上一个判定维度——**这一轮有没有把活交给还在跑的后台 job**。
- **为什么现在做**：使用者实测反馈：agent 用后台模式（`run_in_background`）拉起 job 后本轮结束，插件照旧推「会话已完成」，可活还在跑——通知在**误报「已停止」**。
- **做完得到什么**：后台 job 还在跑时不再下「已完成」的结论；等最后一个 job 结算、且会话确实回到空闲，才补发一次真正的完成通知。

## 档位与升级记录

- 立项时按 **feature / expert** 受理。
- 本节点维持 **轻档**：改动面 = 新增一个判定模块（`src/jobs.js`）+ 主链路两处接线 + 一个 `volatile` 配置键；**不动架构、不新增子系统、不改出站契约、不新增落盘数据**。
- 两个产品决策已收口，无未定决策：
  - **D1（人已裁决）**：语义走「抑制 + 结算后兜底补发」（FR-1 / FR-3）——现场三选项 A，见本需求评论。
  - **D2（本档明示，请确认门一并裁决）**：抑制范围**只限本轮拉起的 job**（FR-2），避免常驻 job（如后台 dev server）把该会话**永久静音**。
- 升级是单向的。出现下列任一信号立即停手升级为重档并重写本文：确认门要求「常驻 job 也抑制」、要求补发策略可配（多档宽限 / 重试 / 按 kind 分流）、或要求为 job 新增一类出站事件。

## 产品定义

**后台 job 感知的完成通知**：把完成类通知的触发条件从「这一轮结束了」修正为
「**这一轮结束了，且它没有把活交给还在跑的后台 job**」。

**核心价值**：这个插件的全部价值是「该被叫一声」的信噪比。误报「已完成/已停止」有两种伤害——
白跑一趟（回来发现还在跑），以及**信号失效**（下次真完成时不当回事）。修好之后：
收到「会话已完成」= 真的可以回来了。

**与现状的区别**：

- 现状：只读 `session/event` 的 `turn/end`，把「本轮结束」直接等于「会话完成」（`src/classify.js`）。
- 本需求：首次消费 DSH 的后台 job 事实源（`ctx.jobs`），在 job 未结算时**不给结论**；
  job 结算且会话确实空闲时**补发**结论。

## 用户与角色

| 角色 | 什么场景用 | 痛点 |
|---|---|---|
| 开发者本人 | 让 agent 后台跑长活（构建 / 全量测试 / 子代理调研），自己去干别的 | 刚收到「会话已完成」，切回来发现任务还在跑 |
| 值守 / 团队群 | 群里看到「已完成」就当无人值守收工 | 误报让「完成」这个信号整体贬值 |
| 本包维护者 | 维护通知语义与 `drop` 原因码 | 手上只有 `turn/end` 一个信号，没有 job 维度可用 |

## 功能点（需求条款）

### 功能点清单

- **FR-1: 后台 job 未结算时不推完成通知**（P0）—— `turn/end` 判出完成意图时，若本会话仍有**本轮拉起且未结算**的 job，则本次不投递完成通知
- **FR-2: 抑制范围只限本轮拉起的 job**（P0）—— job 的 `startedAt` 早于本会话最近一次 `turn/start` 的，不参与抑制（常驻 job 不得永久静音该会话）
- **FR-3: 最后一个被抑制的 job 结算后兜底补发**（P0）—— 宽限窗口内该会话没有开启新轮次 → 补发一次完成通知；若已开新轮次 → 取消补发，由新轮次自己的 `turn/end` 正常通知
- **FR-4: 开关与降级**（P0）—— 新增 `volatile` 布尔 `jobAwareComplete`（默认 `true`）；关掉或 `ctx.jobs` 不可用时逐字回到旧行为，插件照常工作
- **FR-5: 出站契约与既有报文不变**（P0）—— 被抑制的与被补发的都走既有 v1 契约，`event` 仍是 `turn/end`，接收端零改动
- **FR-6: 抑制与补发可观测**（P1）—— 抑制给 `drop` 原因码 `job-running`（含 job id 列表），补发给一条日志；供排障与验收

**优先级说明**：P0 = 缺了核心价值不成立；P1 = 本期尽量交付。

---

### 功能点详细说明

### 功能点 FR-1：后台 job 未结算时不推完成通知

**功能描述**：`turn/end`（非跳过原因）判出完成意图后，先看本会话名下的后台 job；只要还有**未结算**的 job，就不下「已完成」的结论。

**详细说明**：

- **使用场景**：agent 调 `bash` / `subagent` / `workflow` 的 `run_in_background` 拉起 job，本轮随即结束；活其实挂在后台。
- **操作流程**：收到 `turn/end` → 分类出完成意图 → 读一次本会话的 job 快照（`ctx.jobs.list(sessionId)`）→ 存在 `status ∈ {running, stopping}` 的 job → **本次不投递**，把该批 job 记为本轮 pending。
- **预期结果**：使用者收不到这条误报；pending 被登记，交给 FR-3。
- **边界条件**：
  - 其它判定（`skipReasons`、`onlyTopLevel`、goal 自动轮静默）**先于**本判定，顺序不变；
  - 授权 / 提问两类通知**不受影响**（与本判定无关）；
  - 只看 **owner 等于本会话** 的 job；无主（`owner` 缺省）job 与别的会话的 job 一律不算；
  - `list` 抛错或返回值形状不符 → 记一条 warn 并**照旧推送**（口径：宁可误报，不可漏报）。

**验收标准**：

1. 假 registry 里有 1 个本会话 `running` 的 job + 一条 `turn/end(completed)` → `handle()` 返回 `{ action:'dropped', reason:'job-running' }`，且接收端 0 条报文。
2. 假 registry 里只有别的会话的 job（或只有无主 job）→ 照常投递（`action:'sent'`）。

---

### 功能点 FR-2：抑制范围只限本轮拉起的 job

**功能描述**：参与抑制的 job 必须**由本轮拉起**——即 `startedAt` 不早于本会话最近一次 `turn/start` 的墙钟时刻。

**详细说明**：

- **使用场景**：会话里挂着一个几小时前起的常驻 job（dev server / 监听进程），之后又问了一句话并结束本轮。
- **操作流程**：插件在收到 `turn/start` 时记录该会话的轮次起点（毫秒）；`turn/end` 判抑制时用 `job.startedAt >= 本轮起点` 过滤。
- **预期结果**：常驻 job **不会**让该会话此后所有完成通知消失；只有「本轮把活交出去」的那一轮被抑制。
- **边界条件**：
  - 本轮起点未知（插件比 `turn/start` 晚加载，或事件缺失）→ 保守处理：**不抑制**（照旧推送），并记一条 debug；
  - job 的 `startedAt` 与轮次起点同毫秒（极快拉起）→ 视为本轮拉起（`>=`）。

**验收标准**：

1. 常驻 job（`startedAt` 早于本轮起点）+ `turn/end` → `action:'sent'`，报文照常到达。
2. 同一会话本轮拉起的 job（`startedAt` 晚于本轮起点）+ `turn/end` → `action:'dropped'`。

---

### 功能点 FR-3：最后一个被抑制的 job 结算后兜底补发

**功能描述**：本轮被抑制的那批 job 全部结算后，若该会话在宽限窗口内**没有开启新轮次**，补发一次完成通知——它才是「真的可以回来了」。

**详细说明**：

- **使用场景**：DSH 在 job 结算时会唤醒 agent（默认 `completionDelivery: 'wakeup'`）→ 新轮次 → 它自己的 `turn/end` 会正常通知；但 `completionDelivery: 'quiet'` 或唤醒预算（`maxConsecutiveWakes`）耗尽时**不会**开新轮次，此时若不补发，使用者**什么都收不到**。
- **操作流程**：订阅 `ctx.jobs.events`（`{ owners:'all' }`）→ 忽略非本会话、非本批的 job → 本批最后一个 job 拿到终态（`settled`；记录被 `removed` 视为已结算）→ 起一个宽限定时器（默认 **1500ms**，可在 `createNotifier` 选项里覆盖以便测试）→ 定时器到点且 pending 仍在（即期间没有 `turn/start`）→ 用**当时捕获的完成意图与会话引用**走同一条 `dispatch` 补发。
- **预期结果**：默认唤醒路径下使用者**只**收到最后那一条真完成通知（不重复）；quiet 路径下也一定收得到。
- **边界条件**：
  - 补发期间该会话已开启新轮次（`turn/start`）→ **取消**补发（新轮次结束时会正常通知，避免两条）；
  - 新轮次开始前 job 又结算了一个 → 以「本批最后一个」为准，只补发一次；
  - job 被 kill / 失败 / 记录被移除 → 与正常结算同等对待；
  - job 永不结算（长驻）→ pending 一直挂着，**不补发**（这符合「活还没完」的语义；该 pending 在会话销毁或新轮次时清掉）；
  - 插件卸载 / 会话销毁 → 清掉定时器与 pending，不留悬挂引用。

**验收标准**：

1. 抑制后 job 结算 + 宽限窗口内无 `turn/start` → 恰好 1 条补发报文，且 `version/event/message` 与既有完成报文逐字段一致。
2. 抑制后 job 结算，但宽限窗口内该会话 `turn/start` 了 → **0** 条补发；随后该新轮次的 `turn/end` 正常投递 1 条。
3. 一轮拉起 2 个 job：先结算 1 个 → 0 条；第 2 个结算 + 窗口到点 → 恰好 1 条。

---

### 功能点 FR-4：开关与降级

**功能描述**：新行为可关、可降级，任何情况下都不能让通知插件本身失效。

**详细说明**：

- **使用场景**：怀疑是本判定导致没收到通知时，一键回到旧行为做对照；或在没有 job 服务的组合里跑本插件。
- **操作流程**：新增插件配置键 `jobAwareComplete`（boolean，默认 `true`，标 `volatile` → 热改即生效）；`apply(ctx)` 用 `ctx.inject(['jobs'], …)` 接线，服务不存在时不接线。
- **预期结果**：
  - `jobAwareComplete: false` → 与改动前逐条一致（含抑制、补发全部不发生）；
  - 组合里没有 `ctx.jobs` → 同上，并留一条 warn（只说一次，不刷屏）。
- **边界条件**：配置类型不符 → 回落默认值 `true` 并 warn（沿用 `normalizeConfig` 既有口径）；`ctx.jobs` 形状不符（缺 `list`/`events`）→ 视为不可用，走降级。

**验收标准**：

1. `jobAwareComplete:false` + 有 running job + `turn/end` → `action:'sent'`（旧行为）。
2. 不注入 `jobs` 选项 + 有 running job + `turn/end` → `action:'sent'`，且 logger 收到 1 条降级 warn（不重复）。
3. 配置里写 `jobAwareComplete: 'yes'` → 回落 `true` 并 warn（配置规整单测）。

---

### 功能点 FR-5：出站契约与既有报文不变

**功能描述**：抑制改变的是「发不发」，不是「发什么」。补发与直接投递的报文**一字不差**。

**详细说明**：

- **使用场景**：接收端（企微/飞书/钉钉/Slack/Discord/自定义）与既有的接收端脚本、断言都不该因为本需求改动。
- **预期结果**：`version` 仍为 `1`，`event` 仍为 `turn/end`，字段集合与含义不变；文本渠道正文仍为「会话已完成」/「标题 · 会话已完成」。
- **边界条件**：**不新增**出站 event 取值（不做 `job/settled` 之类的新事件类型——那是另一件事）。

**验收标准**：

1. 补发报文与同一场景下的既有完成报文（改动前基线）逐字段相等（忽略 `at` 时间戳）。
2. 仓库既有报文断言（`test/compat*.test.js`、`test/e2e.*.test.js`）全绿。

---

### 功能点 FR-6：抑制与补发可观测

**功能描述**：每一次抑制与补发都留痕，排障时能一眼回答「那条通知为什么没来」。

**详细说明**：

- **预期结果**：
  - 抑制：`handle()` 返回 `{ action:'dropped', reason:'job-running', intent }`，日志带 `sessionId` 与被抑制的 job id 列表；
  - 补发：一条 info/debug 日志说明「本批 job 已全部结算，补发完成通知」；
  - 降级 / 判定异常：各一条 warn（含原因）。
- **边界条件**：日志不含密钥、不含 job 输出正文（只带 id / kind / status）。

**验收标准**：

1. 触发一次抑制 → 日志中出现原因码 `job-running` 与 job id；`docs/guides/operations.md` 的 `drop` 原因码表新增该行。
2. 触发一次补发 → 日志中出现补发记录（可用假 logger 断言）。

---

**功能点关系图**：

```
FR-4（开关与降级）—— 约束全部：关掉/无 job 服务 = 旧行为
FR-1（未结算不推）
  ├─ FR-2（只算本轮拉起的 job）—— 决定"哪些 job 参与"
  └─ FR-3（结算后兜底补发）—— 承接 FR-1 留下的 pending
FR-5（报文不变）—— 约束 FR-3 的补发通道
FR-6（可观测）—— 覆盖 FR-1/FR-3/FR-4
```

## 接口契约

### 一、对外（DSH Host 侧）：新增**可选**依赖 `ctx.jobs`

| 用到的方法 | 语义 | 本插件怎么用 |
|---|---|---|
| `ctx.jobs.list(caller: SessionId)` | 返回该会话可见的 job 投影（自己的 + 无主的），不改游标 | `turn/end` 时读一次快照，按 `owner === sessionId` 过滤 |
| `ctx.jobs.events.subscribe({ owners:'all' }, cb)` | 注册 effect 作用域监听，事件：`registered` / `progress` / `stopping` / `settled` / `removed` / `output` | 只关心 `settled` / `removed`，用于判「本批是否全部结算」 |

- **接线**：`apply(ctx)` 内 `ctx.inject(['jobs'], jobsCtx => gate.attach(jobsCtx.jobs))`；`jobs` 服务晚于本插件加载也能生效（Cordis 服务可用性驱动）。
- **缺失语义**：不接线 → 判定恒为「不抑制」→ 与旧行为一致；一条 warn（只报一次）。
- **错误语义**：`list` 抛错 / 返回非数组 → 该次判定按「不抑制」处理 + warn；事件回调内的任何异常都必须被吞掉（只留日志），**不得**影响 job 结算本身。

### 二、对内（模块与接线）

| 接口 | 输入 | 输出 / 语义 |
|---|---|---|
| `createNotifier(config, options)`（既有入口，**新增可选字段**） | `options.jobs`：JobRegistry 形状（可选）；`options.jobGraceMs`：正整数，默认 `1500` | 返回值不变；新增判定接入 `handle()`，并在 `dispose` 时清定时器与监听 |
| `runtime.handle(session, event, now)` | 同既有 | 命中 FR-1 → `{ action:'dropped', reason:'job-running', intent }`；其余不变 |
| `runtime.dispose()`（新增） | — | 取消宽限定时器、注销 job 事件监听、清 pending（幂等） |
| `src/jobs.js` 的判定模块 | `{ jobs, graceMs, logger, dispatch }` | `noteTurnStart(sessionId, now)` / `gateComplete(session, intent)` → `{ suppressed: boolean, jobIds: string[] }` / `dispose()`；**纯内存、无 I/O**，便于离线单测注入假 registry |

### 三、出站报文（插件 → 接收端）

**不变**：仍为 v1 契约（`version` / `event` / `message` / `title` / `toolName` / `goal` / `sessionId` / `workspace` / `at` / `source`）。
补发与直接投递走**同一条** `dispatch` → 渠道打包路径，因此六种渠道形状、加签、去重、冷却、逐目标过滤全部自动一致。

## 数据契约

| 数据 | 形态 | 持久化 | 说明 |
|---|---|---|---|
| `jobAwareComplete` | boolean，默认 `true` | 是（插件配置，标 `volatile`） | 关掉 = 逐字回到旧行为（FR-4） |
| 会话轮次起点 | `Map<sessionId, number>`（墙钟毫秒） | 否（进程内） | 由 `turn/start` 维护；缺失时保守不抑制（FR-2） |
| 本轮 pending | `Map<sessionId, { session, intent, watched: Set<jobId>, turnSeq }>` | 否（进程内） | 新轮次 / 会话销毁 / 插件卸载即清（FR-3） |

**判定式（写死在此，实现与测试以此为准）**：

```
参与抑制的 job := ctx.jobs.list(sessionId)
                   .filter(j => j.owner === sessionId)
                   .filter(j => j.status === 'running' || j.status === 'stopping')
                   .filter(j => j.startedAt >= 本会话最近一次 turn/start 的墙钟毫秒)
```

**不新增/不改动**：`targets.json` / `bindings.json` 的任何字段与版本号、Outcome 投影、RPC 契约、客户端半的任何接口（`sides: [backend]`）。

## 迁移与兼容

- **默认值兜底**：老配置不加任何键 → 启用新行为（这是缺陷修复，不额外藏一个开关）。
- **回滚路径**：配置 `jobAwareComplete: false`（**热改，不用重启**）→ 逐字回到旧行为；彻底回滚 = 卸载本版本（无落盘数据变更，卸载即净）。
- **组合兼容**：没有 job 服务的组合（最小 profile / headless 变体）→ 自动降级 + 一条 warn，插件照常工作。
- **破坏性变更**：无。出站 v1 契约、落盘文件格式、RPC 与客户端接口全部不动。
- **测试兼容**：既有 30 个测试文件**不得改动**（它们不注入 `jobs`，因此天然走降级路径，正好回归 FR-4）。

## 边界（不做什么）

- **不把 job 进度/输出搬进通知正文**：job 的输出属于 DSH（`job_output` 的职责），本插件只消费「有没有在跑 / 结算了没」。
- **不做「只要有任何 job 在跑就静音」**：常驻 job 会永久静音该会话（FR-2 明确排除）。
- **不新增出站事件类型**：不引入 `job/*` 之类的出站 `event`；补发仍是 `turn/end`。
- **不做定时轮询**：只订阅 `ctx.jobs` 事件 + 在 `turn/end` 读一次快照，不引入轮询定时器。
- **不改 goal 终态通知**：`goal/complete`、`goal/blocked` 是独立通路，不受本判定影响。
- **不改授权 / 提问两类通知**：它们与 job 无关。
- **不做「按 job kind 分流」**：bash / subagent / workflow 一视同仁（kind 只进日志，不进判定）。

## 非功能需求

- **不阻塞会话**：判定是同步只读 + 事件回调；补发在定时器里执行，**绝不**在 `session/event` 回调里 `await`。
- **失败隔离**：`ctx.jobs` 任何异常都不得让会话报错、不得让插件停止工作；判定失败一律退回「照旧推送」。
- **内存有界**：pending 按会话清理（新轮次 / 会话销毁 / 卸载），`watched` 不超过本轮 job 数。
- **零新增依赖**：不引入 `@deepseek-ai/dsh-jobs` 包依赖，只按**形状**消费 `ctx.jobs`（保证离线可单测、可降级）。
- **日志洁净**：不带密钥、不带 job 输出正文。
- **可测性**：判定模块不碰 `node:` 与计时器全局——宽限窗口与时钟经选项注入，单测可瞬时推进。

## 验收标准（整体）

1. **抑制**：本轮拉起 1 个 `running` job + `turn/end(completed)` → 0 条报文，`action:'dropped'`、`reason:'job-running'`。
2. **补发**：该 job 结算 + 宽限窗口内无新轮次 → 恰好 1 条报文，且与既有完成报文逐字段一致（忽略 `at`）。
3. **不重复**：job 结算、宽限窗口内该会话开了新轮次 → 0 条补发；新轮次自己的 `turn/end` 正常投递 1 条。
4. **常驻 job 不静音**：`startedAt` 早于本轮起点的 job 在跑 + `turn/end` → 照常投递。
5. **开关**：`jobAwareComplete:false` → 逐条等于改动前行为。
6. **降级**：不注入 `jobs` → 逐条等于改动前行为，且有且仅有一条 warn。
7. **回归**：`node --test "test/*.test.js"` 退出码 0，且用例数**只增不减**（改动前基线：`tests 241 / pass 241 / fail 0`）。

**可执行判定命令**：

```sh
# 全量回归（改动前基线 241 passed / 0 failed）
node --test "test/*.test.js"

# 本次新增的判定用例（计划落在 test/jobs-gate.test.js）
node --test test/jobs-gate.test.js
```

```sh
# 现场复现口径（真机观察，可选）：起一个本地接收端，观察后台 job 期间是否还有完成推送
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(q.url,b);s.end('{\"ok\":true}')})}).listen(8899,()=>console.log('listening 8899'))"
```

## 依赖与约束

- **依赖（强）**：DSH `ctx.jobs`（`@deepseek-ai/dsh-jobs` 的 `JobRegistry`），desktop profile 由 base bundle 的 `jobs` 行（`@deepseek-ai/dsh-jobs-local`）加载；`tools`/`jobs` 的 `tool-jobs` 负责结算后唤醒 agent。
- **依赖（事实）**：DSH 的结算唤醒语义——`completionDelivery` 默认 `wakeup`，可配 `quiet`；`maxConsecutiveWakes` 可让唤醒退化为注入。**FR-3 的兜底补发正是为了这条路径**。
- **约束**：不新增包依赖（`package.json` 的 `dependencies` 不动）；既有 30 个测试文件不改；新增测试独立文件。
- **约束**：`drop` 原因码 `job-running` 必须同步进 `docs/guides/operations.md`（FR-6）。

<!-- reqboard:marks:begin 机器维护，请勿手改 -->

#### 条款接收状态（随卡的生命周期自动更新）

| 编号 | 接收状态 | 承载任务 |
|------|---------|---------|
| FR-1 | ✅ 已接收 | t2、t3 |
| FR-2 | ✅ 已接收 | t2 |
| FR-3 | ✅ 已接收 | t2、t3、t6 |
| FR-4 | ✅ 已接收 | t3、t1、t4 |
| FR-5 | ✅ 已接收 | t3、t6 |
| FR-6 | ✅ 已接收 | t3、t5 |

> 无未接收条款（6 条全部有落点）。

<!-- reqboard:marks:end -->
