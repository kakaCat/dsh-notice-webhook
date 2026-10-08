---
requirement_id: REQ-261005120639-f801
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend]
---

# 需求说明（REQ-261005120639-f801）

> 面向：产品、开发、测试、使用者——**写给人看，不是写给代码看**。

## TL;DR

- **这是什么**：把完成通知的闸门从「**后台 job 还有活吗**」推广为「**本会话还有活吗**」——
  把 **continuable 子代理**（`subagent` / `subagent_fork` 的默认形态）也纳入判定。
- **为什么现在做**：使用者实测——agent 用 `subagent` / `subagent_fork` 把活派出去，本轮随即以
  `turn/end(completed)` 收尾，插件照旧推「**会话已完成**」，可子代理还在跑（现场实测：同一个会话里
  27 次这样的窗口，子代理在「已完成」之后还干了 **35 秒 ~ 24 分钟**）。这是**误报「已停止」**。
- **做完得到什么**：只要本会话还有在跑的子代理，就不下「已完成」的结论；等它结算、且会话确实空闲，
  才补发一次真正的完成通知。「会话已完成」重新变成可信信号。

## L1 一句话目标与判定标准

**目标**：完成类通知的触发条件从「这一轮结束了，且没有未结算的后台 job」修正为
「这一轮结束了，且本会话**没有任何还在跑的活**（后台 job + subagent 后代）」。

**可证伪判定**（跑什么、看到什么算过）：

| # | 跑什么 | 看到什么算过 |
|---|---|---|
| 1 | `node --test test/jobs-gate.test.js` | 新增用例全绿：假 `agents.list()` 报一个本会话 `running` 子代理 + `turn/end(completed)` → `{ action:'dropped', reason:'subagent-running' }`，接收端 **0 条**完成报文 |
| 2 | 同上：子代理结算（`subagent/end`）后推进测试时钟越过宽限窗口 | 恰好 **1 条**补发报文，`event`/`version`/`message` 与既有完成报文逐字段一致 |
| 3 | 同上：子代理 `status:'idle'`（活着但不干活）/ `parentSession` 指向别的会话 / 只有 `parentSession` 没有 `origin:'subagent'`（fork 源会话） | 一律**照常投递**（`action:'sent'`） |
| 4 | 不注入 `agents`（模拟无该服务的组合）+ 有 running 子代理 | `action:'sent'`（降级回旧行为）+ 1 条 warn（只报一次） |
| 5 | `jobAwareComplete:false` + 有 running 子代理 | `action:'sent'`（一键回旧行为） |
| 6 | `node --test "test/*.test.js"` | 基线 `tests 307 / pass 307 / fail 0`，本次**只增不减**，fail 0 |
| 7 | 现场复算（可选，见「证据」节脚本） | 两个真实会话里 27 个「父轮次 completed 而子代理仍在跑」的窗口，在新判定下全部被压住 |

## 档位与升级记录

- 立项时按 **feature / expert** 受理。
- 本节点维持 **轻档**：改动面 = 一个既有判定模块（`src/jobs.js`）+ 主链路两处接线（`index.js`）+
  一个纯函数 + 配置语义扩写（`src/config.js` 注释/文档，无新键）+ 测试 + 文档口径；
  **不动架构、不新增子系统、不改出站契约、不新增落盘数据、不动 DSH 源码**。
- 三个产品决策已在本档收口（请确认门一并裁决）：
  - **D1（判定口径）**：抑制的判定源 = 「**本会话的 subagent 后代 ∧ `status === 'running'`**」，
    **不按 `turn/start` 过滤轮次**。理由：子代理的活**有界且必然结算**（不像常驻 job 可以是永久进程），
    不存在「永久静音」风险；且口径与 DSH 自身 `workspace/session-activity` 的 `subagent` 家族一致
    （`packages/subagent/subagent/src/archive-admission.ts` 的 `runningDescendants`）。
    备选（未采纳）：按「本轮拉起的子代理」过滤——需要额外跟踪子代理的 activation epoch，
    且会漏掉「本轮用 `send_message` 唤醒一个**既有**子代理」这种同源误报。
  - **D2（开关）**：**复用**既有 `jobAwareComplete` 作为完成闸门总开关（语义升级为「后台活感知」），
    **不新增配置键**。理由：产品语义只有一个——「还有活就别报完成」；`jobAwareComplete:false`
    仍是一键回旧行为（回滚面不翻倍）。该键不在客户端设置页暴露（现状即如此），无 UI 文案迁移。
    备选（未采纳）：新增 `subagentAwareComplete`——回滚要关两个开关。
  - **D3（结算信号）**：复检/补发信号用 **`ctx.on('subagent/end')`**（普通 Cordis 事件，无需服务注入；
    它按 activation epoch 结算触发），与既有 job 结算事件**共用**同一条 pending / 宽限 / 兜底补发机制。
- 升级是单向的。出现下列任一信号立即停手、升级为重档并重写本档：要求子代理进度也推送、
  要求子代理的授权/提问越过 `onlyTopLevel` 提醒、要求抑制范围可配（按轮次 / 按时长 / 按 provider）。

## 产品定义

**完成闸门（work-aware completion）**：把完成类通知的触发条件从「这一轮结束了」修正为
「**这一轮结束了，且本会话没有任何还在跑的活**」。

**核心价值**：这个插件的全部价值是「该被叫一声」的信噪比。误报「已完成」有两种伤害——
白跑一趟（回来发现还在跑），以及**信号失效**（下次真完成时不当回事）。
后台 job 那一半已经在 REQ-261001202058-0fbe 修好了；**continuable 子代理这一半是漏的**：
DSH 默认 preset 的 `subagent` / `subagent_fork` 都是 `backgroundMode: continuable`
（`run_in_background` 默认 true），而只有 **one-shot** 后台子代理才注册 job——
continuable 走 `subagents.startContinuable()`，**不注册任何 job**，闸门根本看不见它。

**与现状的区别**：

- 现状：闸门只读 `ctx.jobs`（`src/jobs.js`），continuable 子代理不在其中 → 本轮 `completed` 就推「会话已完成」。
- 本需求：闸门再读一路只读事实源——「本会话还在跑的子代理后代」，两者都空才允许下「已完成」的结论。

## 用户与角色

| 角色 | 什么场景用 | 痛点 |
|---|---|---|
| 开发者本人 | agent 用 `subagent` / `subagent_fork` 并行派活（写文档 / 改模块 / 调研），自己去干别的 | 刚收到「会话已完成」，切回来发现几个子代理还在写文件 |
| 值守 / 团队群 | 群里看到「已完成」就当无人值守收工 | 误报让「完成」这个信号整体贬值 |
| 本包维护者 | 维护通知语义、`drop` 原因码与文档 | 文档写着「bash / subagent / workflow 都有闸门」，实际子代理这一路是空的——口径与实现漂移 |

## 功能点（需求条款）

### 功能点清单

- **FR-1: 完成闸门把「本会话还在跑的 subagent 后代」算作活**（P0）—— `turn/end` 判出完成意图时，若本会话仍有 `status === 'running'` 的子代理后代，则本次不投递完成通知
- **FR-2: 子代理结算后复检并兜底补发**（P0）—— `subagent/end` 触发复检：本会话既无未结算 job、也无 running 子代理 → 宽限窗口内无新轮次则补发一次完成通知；已开新轮次则取消
- **FR-3: 血缘与活体判定口径**（P0）—— 只认「`parentSession` 血统链可达本会话 ∧ `origin === 'subagent'` ∧ `status === 'running'`」，任意深度；不看模型自述、不猜
- **FR-4: 开关与降级**（P0）—— 复用 `jobAwareComplete`（volatile，默认 `true`）作为闸门总开关；`agents` 服务缺失/形状不符/判定抛错一律**不抑制**（照发）+ 一次 warn
- **FR-5: 出站契约与既有报文不变**（P0）—— 抑制改变的是「发不发」，不是「发什么」；补发与直接投递逐字段一致
- **FR-6: 可观测与文档口径纠正**（P1）—— 抑制给 `drop` 原因码（`job-running` / `subagent-running` / `work-running` 三态）与 id 列表；`project-manual` / `architecture` / `operations` 三处把「后台 job 闸门」改述为「完成闸门（job + 子代理）」

**优先级说明**：P0 = 缺了核心价值不成立；P1 = 本期尽量交付。

---

### 功能点详细说明

### 功能点 FR-1：完成闸门把「本会话还在跑的 subagent 后代」算作活

**功能描述**：`turn/end` 判出完成意图后，除既有 job 判定外再看一眼子代理：只要本会话还有 running 的子代理后代，就不下「已完成」的结论。

**详细说明**：

- **使用场景**：agent 调 `subagent` / `subagent_fork`（continuable + 后台默认），本轮随即结束；活挂在子会话里。
- **操作流程**：收到 `turn/end` → 分类出完成意图 → 既有 job 快照 + 新增子代理快照（`agents.list()` 血缘下钻）→ 任一非空 → **本次不投递**，把该批 job id 与子代理 id 记入本会话 pending。
- **预期结果**：使用者收不到这条误报；pending 交给 FR-2。
- **边界条件**：
  - 其它判定（`skipReasons` / `onlyTopLevel` / goal 自动轮静默）**先于**本判定，顺序不变：`classify → goal → 闸门 → dispatch`；
  - 授权 / 提问 / 中断三类通知**不受影响**（本闸门只否决「完成」）；
  - 只看**本会话**的后代；别的会话的子代理（含「fork 源会话」这种有 `parentSession` 关系的普通 fork）不算；
  - `agents.list()` 抛错 / 非数组 / 条目形状不符 → 视为不可用，**照旧推送**（口径：宁可误报，不可漏报）。

**验收标准**：

1. 假 `agents.list()` 里有 1 个本会话 `running` 子代理 + `turn/end(completed)` → `handle()` 返回 `{ action:'dropped', reason:'subagent-running' }`，接收端 0 条报文。
2. 子代理 `status:'idle'`（活着但不干活）→ 照常投递。
3. 孙代（子代理的子代理，`parentSession` 链两级）`running` → 同样抑制（任意深度）。

---

### 功能点 FR-2：子代理结算后复检并兜底补发

**功能描述**：被压住的那条完成通知，等本会话**真的没活了**再补发——与既有 job 补发共用同一条通路与宽限窗口。

**详细说明**：

- **使用场景**：子代理跑完后 DSH 会把结果送回父会话并唤醒它（新轮次 → 新轮次自己的 `turn/end` 正常通知）；但唤醒不是强保证（`completionDelivery: 'quiet'`、唤醒预算耗尽），此时若不补发，使用者**什么都收不到**。
- **操作流程**：订阅 `ctx.on('subagent/end')` → 对本会话（以及所有挂着的 pending 会话）复检「未结算 job 空 ∧ running 子代理空」→ 成立则起宽限定时器（沿用默认 **1500ms**，注入式计时器）→ 到点 pending 仍在（期间没有 `turn/start`）→ 用**当时捕获的完成意图与会话引用**走同一条 `dispatch` 补发。
- **预期结果**：默认唤醒路径下使用者**只**收到最后那一条真完成通知（不重复）；quiet 路径下也一定收得到。
- **边界条件**：
  - 子代理在宽限窗口内被 `send_message` 唤醒开新 epoch（仍 `running`）→ 复检不通过，**继续挂起**（不是"结算一次就发"）；
  - 宽限窗口内本会话 `turn/start` → **取消**补发（新轮次结束时会正常通知）；
  - 一个子代理多次结算（continuable 多 epoch）→ 以「最后一次结算且确实没活」为准，只补发一次；
  - job 与子代理同时被压住 → 两个来源都要清空才补发（任一未清空都不发）；
  - 插件卸载 → 清掉定时器与 pending，不留悬挂引用。

**验收标准**：

1. 抑制后 `subagent/end` + 宽限窗口内无 `turn/start` → 恰好 1 条补发报文，逐字段等于既有完成报文。
2. 抑制后 `subagent/end`，但宽限窗口内该会话 `turn/start` → 0 条补发；随后该新轮次的 `turn/end` 正常投递 1 条。
3. 抑制后只结算了一个子代理、另一个仍 `running` → 0 条；第二个也结算 + 窗口到点 → 恰好 1 条。
4. 同一会话既有未结算 job 又有 running 子代理：job 先结算 → 0 条；子代理随后结算 + 窗口到点 → 恰好 1 条。

---

### 功能点 FR-3：血缘与活体判定口径

**功能描述**：谁是"本会话的后代子代理"，只按**结构化事实**判定，不靠模型自述、不猜。

**详细说明**：

- **口径**（三条同时成立）：① 从本会话出发沿 `session.header.parentSession` 血统链可达（任意深度，环要防住）；
  ② `session.header.origin === 'subagent'`；③ `status === 'running'`。
- **为什么要有 ②**：`subagent_fork` 的子会话带 `parentSession` **且** `origin:'subagent'`；而**普通 fork / 派生窗口**只共享血统字段、不带 `origin`，它是独立会话，**不得**压住源会话的通知（与 DSH 自身 `runningDescendants` 的判据逐条一致）。
- **为什么 ③ 用 `running`**：`running` = 驱动已排定或正在跑；`idle` = 没有任何驱动在跑。continuable 子代理空闲常驻（等着被 `send_message`）时是 `idle`，**不该**让父会话永久静音。
- **预期结果**：判定与 DSH 的归档准入（`workspace/session-activity` 的 `subagent` 家族）**同口径**，不出现"DSH 说还有活、插件说没活"。

**验收标准**：

1. 单测覆盖：`origin` 缺失 / `parentSession` 指向别的会话 / `status:'idle'` / 自己拥有自己（环）→ 均**不**计入。
2. 单测覆盖：`delegationDepth > 0` 的孙代 → 计入。

---

### 功能点 FR-4：开关与降级

**功能描述**：新行为可关、可降级，任何情况下都不能让通知插件本身失效。

**详细说明**：

- **操作流程**：复用 `jobAwareComplete`（boolean，默认 `true`，保持 `volatile` → 热改即生效）；
  `apply(ctx)` 用 `ctx.inject(['agents'], …)` 接线（与既有 `ctx.inject(['jobs'], …)` 同一模式），服务不存在时不接线。
- **预期结果**：
  - `jobAwareComplete: false` → 与改动前逐条一致（job 与子代理的抑制、补发全部不发生）；
  - 组合里没有 `ctx.agents` / 形状不符（缺 `list`）→ 子代理这一路不判定，**照发**，并留一条 warn（只说一次，不刷屏）；
  - 文件路径 / 依赖不新增：**不 import DSH 内部包**，按形状消费（`{ list() }`）。
- **边界条件**：判定抛错（`list()` 抛、条目形状怪）→ 本次不抑制并记 warn；`agents.list()` 是同步调用，闸门**不得**变成异步或阻塞会话。

**验收标准**：

1. `jobAwareComplete:false` + running 子代理 + `turn/end` → `action:'sent'`（旧行为）。
2. 不注入 `agents` + running 子代理 + `turn/end` → `action:'sent'`，logger 收到 1 条降级 warn（不重复）。
3. `agents = { list: 'nope' }`（形状不符）→ 同上，不抛异常。

---

### 功能点 FR-5：出站契约与既有报文不变

**功能描述**：抑制改变的是「发不发」，不是「发什么」。

**详细说明**：

- **预期结果**：`version` 仍为 `1`，`event` 仍为 `turn/end`，字段集合与含义不变；补发与直接投递的报文逐字段相等（忽略时间戳）。
- **边界条件**：**不新增**出站 event 取值（不做 `subagent/settled` 之类的新事件——那是另一件事）；不动 `classify.js` 的终态分类表。

**验收标准**：

1. 补发报文与同一场景下的既有完成报文逐字段相等（忽略 `at`）。
2. 仓库既有报文断言（`test/compat*.test.js`、`test/e2e.*.test.js`）全绿。

---

### 功能点 FR-6：可观测与文档口径纠正

**功能描述**：每一次抑制与补发都留痕，并把文档里"后台 job 闸门"的旧口径纠正为"完成闸门"。

**详细说明**：

- **预期结果**：
  - 抑制返回 `{ action:'dropped', reason, intent }`：`reason` 取 `job-running`（仅 job）/ `subagent-running`（仅子代理）/ `work-running`（两者都有），并带对应 id 列表；
  - 补发一条 info 日志（含被压住的 job / 子代理 id）；
  - 降级 / 判定异常各一条 warn（含原因）；
  - `docs/guides/operations.md` 的 `drop` 原因码表补 `subagent-running` / `work-running` 两行；
  - `docs/architecture/project-manual.md`（后台 job 感知一节）与 `docs/architecture/index.md`、
    `docs/architecture/notification-plugin.md` 三处把口径写成「完成闸门 = 后台 job + subagent 后代」，
    并写明 continuable 子代理**不注册 job** 这一事实。
- **边界条件**：日志只带 id / kind / status，不带子代理输出正文，不含密钥。

**验收标准**：

1. 触发一次纯子代理抑制 → `handle()` 返回 `reason:'subagent-running'` 且带子代理 id；文档 `drop` 表已含该行。
2. 三处文档检索「后台 job 闸门」不再出现"只读 ctx.jobs"的错误口径（人工核对 + 归档材料申报 `manual_updates`）。

---

**功能点关系图**：

```
FR-4（开关与降级）—— 约束全部：关掉 / 无 agents 服务 = 旧行为
FR-1（有活不推）—— 依赖 FR-3（口径）
  ├─ FR-3（血缘 + running 口径）—— 决定"哪些子代理参与"
  └─ FR-2（结算后复检 + 兜底补发）—— 承接 FR-1 留下的 pending
FR-5（报文不变）—— 约束 FR-2 的补发通道
FR-6（可观测 / 文档口径）—— 覆盖 FR-1/FR-2/FR-4
```

## 接口契约

**内部接口（本包）**：

| 入口 | 输入 | 输出 / 错误语义 |
|---|---|---|
| `createJobGate(options)`（`src/jobs.js`） | 新增 `options.subagents`：形状 `{ list() }` 的只读事实源（生产由 `ctx.inject(['agents'])` 注入） | 形状不符 → 该路不判定（不抛） |
| `liveSubagentIds(agents, sessionId)`（新增纯函数） | agents 形状对象 + 会话 id | `string[]`（本会话 running 后代 id，去重）；形状不符返回 `null`（调用方按"不可用"处理） |
| `gate.gate(session, intent, prompt)` | 同现状 | 返回增加 `subagentIds`；`suppressed` 语义不变 |
| `gate.observeSubagentEnd()`（新增） | 无参 | 复检所有 pending 会话；返回被触发的 pending 数（供测试断言） |
| `gate.pendingOf(sessionId)` | 会话 id | 快照增加 `subagentIds` |

**配置契约**：无新增键；`jobAwareComplete` 语义扩写为「完成闸门（后台 job + subagent 后代）总开关」，默认 `true`、`volatile` 不变。

**出站契约**：不变（`version 1`，`event` 仍 `turn/end` / `turn/error` / `approval/asked` / `ask_user_question`）。

## 数据契约

- **不新增落盘数据**：闸门状态全在内存（pending / watched / 宽限计时器），进程重启归零。
- **内存 pending 记录扩写**（`src/jobs.js` 内部）：`{ session, intent, prompt, jobIds, subagentIds, watched, timer }`。
- **只读契约**：只用 `agents.list()` 与 `ctx.on('subagent/end')`，**从不** `cancel` / `kill` / `followup` 任何子代理。

## 迁移与兼容

| 人群 / 场景 | 迁移动作 |
|---|---|
| 既有使用者（默认配置） | **无需改动**：装上即生效（误报消失） |
| 想回到旧行为的人 | `jobAwareComplete: false`（热改即生效，不用重启 Host） |
| 无 `agents` 服务的组合 | 自动降级：子代理这一路不判定，照发 + 一次 warn |
| 接收端（6 种渠道 / 既有脚本） | **零改动**：报文逐字段不变 |
| 老配置 / 老目标清单文件 | 不动 schema、不动存储版本 |

## 边界（不做什么）

1. **不做子代理自己的通知**：子代理的 `turn/end`、授权、提问仍被 `onlyTopLevel` 过滤——它们本就是"内部工序"，不该打扰顶层使用者；本需求只改"父会话的完成结论"。
2. **不动 one-shot 后台子代理的既有 job 路径**（它本来就注册 job，已经在闸门里）；也不把 continuable 改成注册 job。
3. **不动 DSH 源码**：这是插件侧修复，不改 DSH 的 subagent 实现（不要求它把 continuable 注册成 job）。
4. **不新增配置键、不新增出站事件、不新增落盘数据、不改终态分类表**（`classify.js` 一字不动）。

## 非功能需求

- **只读**：闸门只查询，不干预任何会话/子代理的生命周期。
- **零第三方运行时依赖**；不 import DSH 内部包（按形状消费 `{ list() }`）。
- **失败隔离**：任何判定异常都降级为「照发」+ 一条 warn，绝不让会话报错、绝不影响其它目标投递。
- **不阻塞**：判定必须同步完成（`agents.list()` 同步；不引入 await/异步 dispatch）。
- **零 I/O**：时钟与计时器继续靠注入（单测可瞬时推进）。
- **热改**：开关仍 `volatile`。

## 验收标准（整体）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `node --test test/jobs-gate.test.js` | 全绿（含 FR-1..FR-4 新增用例） |
| 2 | `node --test "test/*.test.js"` | 基线 307 只增不减，fail 0 |
| 3 | `grep -rn "subagent-running" src/ docs/guides/operations.md` | 命中（原因码 + 文档表） |
| 4 | `grep -rn "只读 ctx.jobs\|ctx.jobs 说" docs/` | 不再出现旧口径（已改述为完成闸门） |
| 5 | 现场复算脚本（见「证据」节） | 27 个窗口在新判定下全部被压住（人工核对一次） |

## 依赖与约束

- 依赖 DSH 提供的：`ctx.agents`（形状 `{ list() }`，条目含 `session.header` 与 `status`）、
  `ctx.on('subagent/end')` 事件（含 `info.id` = 子会话 id）、`ctx.jobs`（既有）。
- 依赖既有实现：`src/jobs.js` 的 pending / 宽限 / 兜底补发机制、`src/classify.js` 的终态分类（不改）。
- 累积约束（跨需求稳定）见 `docs/architecture/project-manual.md` 第四节。

## 证据（现场复现，2026-10-05）

**结构证据（源码）**：

- `packages/bundle/web-app/presets/standard.patch.yml:96,102`——`subagent` / `subagent_fork` 均 `backgroundMode: continuable`。
- `packages/subagent/tool-subagent/src/index.ts:526-549`——continuable 走 `subagents.startContinuable()`；
  只有 one-shot 才 `jobs.start({ kind: 'subagent' })`。→ **闸门读 `ctx.jobs` 必然看不见它**。
- `packages/subagent/subagent/src/child-agent.ts:139-160`——子会话 header 带 `parentSession` + `origin:'subagent'` + `delegationDepth`（本需求 FR-3 的判据来源）。

**现场数据**（本机 `~/.dsh/sessions/`，两个真实会话：`f92af7dc…`（47 轮）、`00af6c69…`（16 轮））：

复算方法（可重跑）：

```bash
# 1) 解压会话日志，找「父轮次 turn/end(completed)」与其同轮派出的子代理
zstd -dc ~/.dsh/sessions/--Users-mac-Documents-ai-dsh-dsh-pmboard--/session-f92af7dc-*/session.v4.jsonl.zstd | grep -c 'started subagent'
# 2) 对比子会话自身活动时间（脚本见本次需求评论：/tmp/repro_notice2.py 的口径）
```

复算脚本随需求落盘：`docs/requirements/REQ-261005120639-f801/repro-continuable-window.py`
（`python3 repro-continuable-window.py`，只读 `~/.dsh/sessions/`，不改任何文件）。

结论：**27 个窗口**满足「父会话 `turn/end(completed)` 时，同一轮派出的 continuable 子代理仍在跑」，
子代理在父会话「已完成」之后继续工作了 **35 秒 ~ 24 分钟**（最长的 `1bcf9a40`：+678s，`e41e2ca6`：+729s，
`3d70ed8c`：+1429s）。这些窗口在现状下**每一条都会推「会话已完成」**。

<!-- reqboard:marks:begin 机器维护，请勿手改 -->

#### 条款接收状态（随卡的生命周期自动更新）

| 编号 | 接收状态 | 承载任务 |
|------|---------|---------|
| FR-1 | ✅ 已接收 | t1、t2 |
| FR-2 | ✅ 已接收 | t2、t5 |
| FR-3 | ✅ 已接收 | t1 |
| FR-4 | ✅ 已接收 | t2、t3 |
| FR-5 | ✅ 已接收 | t5、t3 |
| FR-6 | ✅ 已接收 | t1、t4 |

> 无未接收条款（6 条全部有落点）。

<!-- reqboard:marks:end -->
