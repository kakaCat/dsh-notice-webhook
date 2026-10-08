---
requirement_id: REQ-260930123701-250a
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11]
sides: [backend]
---

# 需求说明（REQ-260930123701-250a）

> 本文档面向：产品、开发、测试、使用者——**写给人看，不是写给代码看**。

## TL;DR

- **这是什么**：一个 DSH 插件。在你"该被叫一声"的三个时刻，把一条消息 POST 到你配置的 webhook 地址。
- **为什么现在做**：DSH 只有浏览器界面，人一离开电脑就会错过「等你授权 / 等你回答 / 已跑完」。
- **做完得到什么**：任何能收 HTTP 的地方（企业微信/钉钉机器人、自建服务、手机提醒）都能收到这三个提醒；其他插件还能把会话窗口自动绑到自己的 webhook 上；goal 自动续轮（系统唤醒）不吵人，只在目标跑到终态时叫你一次。

## 业务流程图

```
DSH 会话窗口                        dsh-notice-webhook                    webhook 接收端
     │                                     │                                   │
     ├── turn/end ────────────────────────▶│                                   │
     ├── approval/asked ──────────────────▶│   组装正文 + 路由解析             │
     ├── tool/call(ask_user_question) ────▶│   ┌──────────────────┐            │
     │                                     │   │ 窗口绑定了地址？ │            │
     │                                     │   └───┬──────────┬───┘            │
     │                                     │   是 │          │ 否                │
     │                                     │      ▼          ▼                  │
     │                                     │   绑定地址    默认地址              │
     │                                     │      └────┬─────┘                  │
     │                                     ├───────────┴── POST JSON ──────────▶│
     │◀── 会话照常继续（不等待、不阻塞）────┤  失败：只记日志，不打扰会话         │
```

## 档位与升级记录

- 立项时按**轻档**受理（改动面小、只有一个目标）。
- 本次升级为**重档**：触发 L3 升级信号 —— ① 新增子系统（webhook 投递 + 绑定注册表）；② 新增数据模型（窗口 ↔ webhook 绑定关系需持久化）；③ 新增对外接口（供其他插件调用的 Host Service）。
- 升级是单向的：本需求后续按重档执行，不再回落轻档。

## 产品定义

**DSH Webhook 通知插件**：DSH 插件体系里的一个事件转发器。

它只做一件事——监听 DSH 会话的三个"人需要介入"的时刻，把事件组装成一条人能看懂的短消息，POST 到配置好的 webhook 地址。

**核心价值**：把"你必须人在浏览器前才不错过"变成"你在哪都能收到"。DSH 的授权与提问是**阻塞式**的：你不点，任务就停在那里。

**与现状的区别**：

- 现有 [dsh-notice](https://github.com/Tenold-a/dsh-notice) 做的是 **Windows 托盘气泡**，人必须在这台 Windows 机器前；本插件走 **HTTP**，接收端可以是任何服务。
- 现有方案每个插件要自己监听一遍会话事件；本插件把这套监听 + 路由做成**可被其他插件复用的 Host Service**，避免口径不一。

## 用户与角色

| 角色 | 什么场景用 | 痛点 |
|---|---|---|
| 跑长任务的 DSH 使用者 | 让 Agent 跑一个大改动，人去看别的事 | 回来才发现任务卡在「等你授权」半小时了 |
| 其他 DSH 插件作者（如 IM 插件、看板插件） | 想把自己管的会话窗口的提醒转发到自己的通道 | 每个插件各写一套 `session/event` 监听，重复且口径不一 |
| webhook 接收端（企业微信机器人 / 自建服务 / 手机推送） | 收到 POST 后转成自己的提醒形态 | 需要一个字段稳定的 JSON 契约，不能今天这个格式明天那个 |

## 功能点（需求条款）

### 功能点清单

- **FR-1: 对话完成时推送 webhook**（P0）—— 顶层会话 `turn/end` 触发，有标题时正文拼成「标题 · 会话已完成」
- **FR-2: 等待授权时推送 webhook**（P0）—— `approval/asked` 触发，正文「需要你允许执行操作（工具名）」
- **FR-3: 等待回答时推送 webhook**（P0）—— `tool/call` 且工具为 `ask_user_question` 触发，正文「需要你回答一个问题」
- **FR-4: webhook 投递契约**（P0）—— POST JSON、超时、非 2xx、失败只记日志不打扰会话
- **FR-5: 只提醒该提醒的**（P0）—— 只对顶层会话触发，跳过子代理/fork，跳过 interrupted/aborted，支持冷却
- **FR-6: 会话窗口绑定 webhook 地址**（P0）—— 窗口级地址优先于默认地址
- **FR-7: 总开关关闭时窗口绑定旁路照发**（P0）—— 总开关只管默认通道，已绑定窗口不受它影响
- **FR-8: 向其他插件提供自动绑定能力**（P0）—— 以 Cordis Host Service 暴露绑定/解绑/查询/解析
- **FR-9: 绑定关系持久化**（P1）—— 跨 Host 重启恢复，文件损坏时安全回落
- **FR-10: 绑定可观测**（P1）—— 能列出当前所有绑定及其来源，便于排查"为什么没收到"
- **FR-11: goal 自动续轮不推送、只在目标终态推送**（P0）—— 系统唤醒的自动轮静默，目标完成/阻塞/轮次耗尽各推一条

**优先级说明**：P0 = 缺了核心价值不成立；P1 = 本期尽量交付。

---

### 功能点详细说明

### 功能点 FR-1：对话完成时推送 webhook

**功能描述**：顶层会话一轮结束时，插件把「标题 · 会话已完成」POST 到该会话解析出的 webhook 地址。

**详细说明**：

- **使用场景**：使用者让 Agent 跑一个长任务，人离开了浏览器。
- **操作流程**：
  1. DSH 触发 `turn/end`；
  2. 插件判断是否为顶层会话、结束原因是否属于"被中断"；
  3. 插件取该会话最近一次 `session/title` 的标题，拼成正文并推送。
- **预期结果**：
  - 接收端收到一条 POST，`event` 为 `turn/end`；
  - `message` 在**有标题**时为「标题 · 会话已完成」，**无标题**时退化为「会话已完成」。
- **边界条件**：
  - 结束原因是 `interrupted` / `aborted` → 不推送（用户自己停的，不需要提醒）；
  - `includeTitle` 为 false → 只推「会话已完成」；
  - 子代理/fork 会话 → 不推送（见 FR-5）。

**验收标准**：

1. 配置好 webhook 后跑完一轮对话 → 接收端收到 `turn/end`，正文含「会话已完成」。
2. 会话已有标题 → 正文形如「修复登录 bug · 会话已完成」。
3. 手动中断该轮对话 → 接收端**收不到**该条推送。

---

### 功能点 FR-2：等待授权时推送 webhook

**功能描述**：有操作需要使用者点头时，插件把「需要你允许执行操作（工具名）」POST 到 webhook。

**详细说明**：

- **使用场景**：Agent 要执行一条需要授权的命令，人不在浏览器前。
- **操作流程**：
  1. DSH 触发 `approval/asked`；
  2. 插件读事件里的工具名；
  3. 拼正文并推送。
- **预期结果**：
  - `event` 为 `approval/asked`；
  - `message` 为「需要你允许执行操作（Bash）」这类带工具名的形态；
  - `toolName` 字段单独给出，方便接收端做分流。
- **边界条件**：
  - 事件里没有工具名 → 正文退化为「需要你允许执行操作」，`toolName` 为 null；
  - `notifyApproval` 为 false → 不推送。

**验收标准**：

1. 触发一次需要授权的工具调用 → 收到 `approval/asked`，`toolName` 与实际工具名一致。
2. 关闭 `notifyApproval` 后再触发 → 收不到。

---

### 功能点 FR-3：等待回答时推送 webhook

**功能描述**：模型用 `ask_user_question` 提问题时，插件把「需要你回答一个问题」POST 到 webhook。

**详细说明**：

- **使用场景**：Agent 跑到一半需要你做选择，人不在浏览器前。
- **操作流程**：
  1. DSH 触发 `tool/call`；
  2. 插件判断 `name === "ask_user_question"`；
  3. 拼正文并推送。
- **预期结果**：
  - `event` 为 `ask_user_question`（区别于原始 `tool/call`，便于接收端识别）；
  - `message` 为「需要你回答一个问题」。
- **边界条件**：
  - 其他任何 `tool/call` → 不推送（否则每次工具调用都会刷屏）；
  - `notifyQuestion` 为 false → 不推送。

**验收标准**：

1. 让 Agent 用 `ask_user_question` 问一个问题 → 收到 `ask_user_question` 事件。
2. 让 Agent 调用普通工具（如 `read`）→ 收不到推送。

---

### 功能点 FR-4：webhook 投递契约

**功能描述**：推送统一走 POST + JSON，超时与失败有明确语义，且任何失败都不得影响会话。

**详细说明**：

- **使用场景**：接收端可能离线、可能返回 500、可能慢到几秒。
- **操作流程**：
  1. 组装 JSON body（字段见「接口契约」）；
  2. 带配置的 headers 发起 POST；
  3. 按 `timeoutMs` 超时；非 2xx 或网络错误按 `retry` 次数重试；
  4. 最终失败写日志，流程结束。
- **预期结果**：
  - 成功：接收端拿到 JSON，字段与契约一致；
  - 失败：`ctx.logger.warn` 有一条记录（**只记 host，不记完整 URL 的 query/凭据**），会话侧无任何异常。
- **边界条件**：
  - 地址为空 → 不推送，静默（首次启动未配置属正常）；
  - 接收端返回 3xx → 不跟随重定向，视为失败（避免 SSRF/凭据外泄到非预期主机）；
  - 推送是异步的，**不得阻塞** `turn/end` 之后的会话流程。

**验收标准**：

1. 接收端正常 → 收到完整 JSON，字段齐全。
2. 把地址指向 `http://127.0.0.1:1/` → 会话照常完成，日志有 warn，无未捕获异常。
3. 接收端故意 sleep 10s → 会话不被卡住（`timeoutMs` 生效后即放弃）。

---

### 功能点 FR-5：只提醒该提醒的

**功能描述**：只对顶层会话触发；被用户中断的回合不触发；支持最低间隔冷却。

**详细说明**：

- **使用场景**：插件可能同时被多个子代理会话的事件命中；用户可能连续中断多轮。
- **操作流程**：
  1. 判断 `session.header.parentSession` 是否存在 → 存在即为子会话，跳过；
  2. 判断 `turn/end` 的 `reason.kind` 是否在 `skipReasons` 里；
  3. 判断距上次推送是否小于 `cooldownMs`。
- **预期结果**：
  - 子代理会话的完成不会产生推送；
  - `cooldownMs` 设为 5000 时，5 秒内的第二条事件被丢弃。
- **边界条件**：
  - `onlyTopLevel` 为 false → 子会话也推；
  - `cooldownMs` 为 0 → 不冷却（默认）。

**验收标准**：

1. 主会话派生子代理 → 只有主会话的事件产生推送。
2. 设 `cooldownMs: 5000` 后快速触发两次 → 只收到第一条。

---

### 功能点 FR-6：会话窗口绑定 webhook 地址

**功能描述**：任何一个会话窗口都可以绑定自己的 webhook 地址；绑定后该窗口的推送走绑定地址，不再走默认地址。

**详细说明**：

- **使用场景**：临时会话（如某个客户项目的会话）想推到独立的群机器人，其他会话仍走默认地址。
- **操作流程**：
  1. 绑定来源有二：① 配置文件里的初始绑定；② 其他插件通过 Host Service 调用 `bind(sessionId, url)`；
  2. 事件到达时按 `sessionId` 解析目标地址；
  3. 有绑定用绑定，无绑定用默认。
- **预期结果**：
  - 同一时刻两个会话可以推到两个不同地址；
  - 解绑后该会话立刻回落到默认地址。
- **边界条件**：
  - 既无绑定也无默认地址 → 不推送；
  - 绑定地址与默认地址相同 → 正常推送一次（不重复推）。

**验收标准**：

1. 给会话 A 绑定地址 1、会话 B 不绑定（默认地址 2）→ A 的事件只到地址 1，B 的只到地址 2。
2. 解绑 A 后再触发 → A 的事件到地址 2。

---

### 功能点 FR-7：总开关关闭时窗口绑定旁路照发

**功能描述**：总开关只管**默认通道**。总开关关闭时，未绑定窗口不再推送，但**已绑定 webhook 的窗口照旧推送到它绑定的地址**。

**详细说明**：

- **使用场景**：使用者想临时关掉默认通道（比如默认地址是公共群，下班不想被刷），但仍希望某几个关键会话保持提醒。
- **操作流程**：
  1. 事件到达 → 先解析路由（FR-6）；
  2. 若命中窗口绑定 → 无视总开关，直接推送；
  3. 若未命中绑定 → 检查总开关，关闭则不推送。
- **预期结果**：
  - `enabled: false` + 窗口已绑定 → 接收端**仍然收到**；
  - `enabled: false` + 窗口未绑定 → **收不到**。
- **边界条件**：
  - 分类开关（`notifyComplete` / `notifyApproval` / `notifyQuestion`）是**内容级**过滤，关闭时**已绑定窗口也不推**——即：总开关是通道级旁路，分类开关不是。

**验收标准**：

1. `enabled: false`，给会话 A 绑定地址 → A 仍收到推送。
2. `enabled: false`，会话 B 未绑定 → B 收不到。
3. `notifyApproval: false`，A 已绑定 → A 的授权事件**收不到**（分类开关优先于绑定）。

---

### 功能点 FR-8：向其他插件提供自动绑定能力

**功能描述**：插件通过 Cordis Host Service 暴露一套绑定接口，其他插件 `inject` 后即可自动绑定/解绑/查询/解析，无需自己监听会话事件。

**详细说明**：

- **使用场景**：IM 插件或看板插件想把自己管理的会话窗口的通知接到自己的通道。
- **操作流程**：
  1. 插件 `ctx.provide('dshNoticeWebhook', service)`；
  2. 消费方插件声明 `inject: ['dshNoticeWebhook']`；
  3. 消费方检查 `version === 1`，然后调用 `bind` / `unbind` / `list` / `resolve`。
- **预期结果**：
  - 消费方一次 `bind(sessionId, url)` 调用后，该会话的事件即改道到新地址；
  - 服务是**可选依赖**：本插件缺失时消费方插件应能正常加载（不做强依赖）。
- **边界条件**：
  - `sessionId` 为空串 / 非字符串 → 抛参数错误，不写坏绑定表；
  - `url` 不是 `http(s)://` 开头 → 拒绝并报错（不静默接受）；
  - 本插件被卸载 → 服务消失，消费方需自行降级（`resolve` 返回 null、`bind` 不生效）。

**验收标准**：

1. 写一个最小消费插件 `inject: ['dshNoticeWebhook']` → 能取到服务、`version === 1`。
2. 消费方调用 `bind` 后触发会话事件 → 事件到达新地址。
3. 消费方调用 `unbind` 后 → 回落默认地址。
4. 卸载本插件后重启 → 消费方插件不报错（服务缺失时安全降级）。

---

### 功能点 FR-9：绑定关系持久化

**功能描述**：绑定关系写在本机数据文件里，Host 重启后自动恢复。

**详细说明**：

- **使用场景**：DSH Desktop / `dsh web` 经常重启，绑定不应丢失。
- **操作流程**：
  1. `bind` / `unbind` 后立即原子写盘（先写临时文件再 rename）；
  2. Host 启动时读回绑定表；
  3. 文件缺失 → 视为空表；文件损坏 → 记 warn 并回落空表。
- **预期结果**：
  - 绑定会话 A → 重启 Host → 会话 A 的推送仍走绑定地址。
- **边界条件**：
  - 绑定表里有已不存在的会话 id → 保留不自动删（避免误删），`list()` 中可见；
  - 文件权限不可写 → 记 warn，绑定额度仅本次进程内存内有效。

**验收标准**：

1. 绑定后重启 Host → 绑定仍生效。
2. 手工把数据文件写成非法 JSON → Host 正常启动，日志有 warn，推送回落默认地址。

---

### 功能点 FR-10：绑定可观测

**功能描述**：能一眼看出"当前有哪些绑定、某条推送为什么走这个地址"。

**详细说明**：

- **使用场景**：没收到提醒时排查，或确认绑定是否生效。
- **操作流程**：
  1. 调 `list()` 拿全部绑定；
  2. 调 `resolve(sessionId)` 拿该会话将使用的地址与来源（`binding` / `default` / null）。
- **预期结果**：
  - `list()` 返回 `sessionId` + 地址 + 来源；
  - `resolve()` 明确告诉调用方"走的是绑定还是默认，还是根本没有目标"。
- **边界条件**：
  - 返回的地址**是否脱敏**：默认返回完整地址（调用方是同进程插件，非浏览器）；日志里必须脱敏。

**验收标准**：

1. 绑定两个会话 → `list()` 返回两条。
2. 对未绑定会话调 `resolve()` → 返回 `default` 来源；无默认地址时返回 null。

---

### 功能点 FR-11：goal 自动续轮不推送、只在目标终态推送

**功能描述**：goal 自动续轮（系统唤醒）产生的 `turn/end` 不推送；目标跑到终态（完成 / 阻塞 / 轮次耗尽）时各推一条。

**详细说明**：

- **使用场景**：看板 / dive 模式靠 goal 让 Agent 连续自动跑多轮，人不在旁边。这些自动轮不需要吵人，但目标卡住或跑完时必须叫人。
- **识别依据**：自动续轮由 `dsh-goal-round-driver` 注入，落在会话日志里是 `source.kind === "goal"` 的 user message（带 `goalId` / `revision` / `round`）；人自己发的消息不带这个 source。
- **操作流程**：
  1. 收到 `turn/end` 时，判断该轮是否由 goal 自动唤醒（该轮触发的 user message 的 `source.kind` 是否为 `goal`）；
  2. 是 → 不推送，直接返回；
  3. 否 → 按 FR-1 正常推送；
  4. 目标进入终态时，额外推一条终态通知。
- **预期结果**：
  - goal 自动轮 → 接收端**收不到**；
  - `phase=complete` → 收到 `goal/complete`，正文「标题 · 目标已完成」；
  - `phase=blocked` 且 `code=round-limit` → 收到 `goal/blocked`，正文「标题 · 目标轮次耗尽（N/N）」，N = `maxGoalRounds`；
  - `phase=blocked` 其他 code → 收到 `goal/blocked`，正文「标题 · 目标阻塞（code）」；
  - 人在 goal active 期间自己发的一轮 → **照常推送**。
- **边界条件**：
  - 会话没有 goal → 行为与 FR-1 完全一致（**无回归**）；
  - `paused` / `clear` **不算终态**，不推送——那是人的主动操作，不需要被通知；
  - 同一目标终态**只推一次**（按 `goalId` + `revision` + 终态去重），避免重复续跑时刷屏；
  - 终态通知与 FR-6 路由、FR-7 旁路语义一致（走该会话解析出的地址，而不是另找地址）。

**验收标准**：

1. 建一个 goal 后不干预，让它自动跑 ≥3 轮 → 接收端**收不到**任何 `turn/end` 推送。
2. 让 goal 跑到完成 → 收到一条 `goal/complete`，正文含「目标已完成」。
3. 把 `max_goal_rounds` 设为 1 让其耗尽 → 收到一条 `goal/blocked`，正文含「目标轮次耗尽（1/1）」。
4. goal active 期间人为发一轮 → 收到该轮 `turn/end` 推送（自动轮被抑制、人工轮不被误伤）。

---

**功能点关系图**：

```
FR-4（投递契约）
  ├─ FR-1 / FR-2 / FR-3（三类事件 → 组装正文）
  ├─ FR-5（事件过滤）
  └─ FR-11（goal 自动轮静默 + 终态通知）
FR-6（路由：绑定 > 默认）
  ├─ FR-7（总开关旁路语义）
  ├─ FR-8（Host Service 供其他插件绑定）── FR-10（可观测）
  └─ FR-9（绑定持久化）
```

## 接口契约

### 一、Webhook 出站请求（本插件 → 你的接收端）

| 项 | 值 |
|---|---|
| 方法 | `POST` |
| 路径 | 绑定地址，或默认地址（由你配置） |
| `Content-Type` | `application/json; charset=utf-8` |
| 自定义头 | 由 `webhookHeaders` 配置，原样带上（用于鉴权，如 `Authorization`） |
| 超时 | `timeoutMs`，默认 5000ms |
| 重试 | `retry` 次，默认 0；仅对网络错误与非 2xx 重试 |
| 重定向 | 不跟随 |

**请求体字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | number | 是 | 契约版本，当前 `1` |
| `event` | string | 是 | `turn/end` / `approval/asked` / `ask_user_question` / `goal/complete` / `goal/blocked` |
| `message` | string | 是 | 给人看的正文，如「修复登录 bug · 会话已完成」 |
| `title` | string \| null | 是 | 会话标题，无标题为 null |
| `toolName` | string \| null | 是 | 授权事件的工具名；其他事件为 null |
| `goal` | object \| null | 是 | goal 终态事件的目标信息 `{ id, phase, round }`；非 goal 事件为 null |
| `sessionId` | string | 是 | 会话窗口标识 |
| `workspace` | string \| null | 否 | 会话工作区绝对路径 |
| `at` | string | 是 | ISO-8601 时间戳 |
| `source` | string | 是 | 固定 `dsh-notice-webhook` |

**请求体样例**：

```json
{
  "version": 1,
  "event": "approval/asked",
  "message": "需要你允许执行操作（Bash）",
  "title": "修复登录 bug",
  "toolName": "Bash",
  "goal": null,
  "sessionId": "session-b7c52392-9cdf-4162-b1c6-ed768346fbd2",
  "workspace": "/Users/mac/Documents/ai/dsh/dsh-notice-webhook",
  "at": "2026-09-30T04:37:01.901Z",
  "source": "dsh-notice-webhook"
}
```

**响应语义**：接收端返回任意 2xx 即视为成功；其他状态码视为失败（记日志、按需重试）。

### 二、Host Service（本插件 → 其他插件）

服务名 `dshNoticeWebhook`，通过 `ctx.provide` 注册。

```ts
interface DshNoticeWebhook {
  readonly version: 1

  /** 绑定：该会话窗口的推送改走 url。返回 false 表示参数非法被拒。 */
  bind(sessionId: string, url: string): boolean

  /** 解绑：返回是否真的删掉了一条绑定。 */
  unbind(sessionId: string): boolean

  /** 列出全部绑定。 */
  list(): Array<{ sessionId: string; url: string; updatedAt: string }>

  /** 解析某会话将使用的目标；无绑定且无默认地址时返回 null。 */
  resolve(sessionId: string): { url: string; source: 'binding' | 'default' } | null
}
```

**错误语义**：

| 情况 | 行为 |
|---|---|
| `sessionId` 非字符串或空串 | `bind` 返回 false；不写绑定表 |
| `url` 非 `http://` / `https://` 开头 | `bind` 返回 false；不写绑定表 |
| 本插件未安装 / 已卸载 | 消费方 `ctx.dshNoticeWebhook` 为 undefined，需自行降级 |
| 数据文件不可写 | 仍返回 true（进程内生效），日志有 warn |

### 三、配置项（`cordis.patch.yml`）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关，只管默认通道（见 FR-7） |
| `webhookUrl` | string | `""` | 默认地址；空 = 未配置 |
| `webhookHeaders` | object | `{}` | 附加请求头 |
| `timeoutMs` | number | `5000` | 单次投递超时 |
| `retry` | number | `0` | 失败重试次数 |
| `cooldownMs` | number | `0` | 两次推送最小间隔 |
| `onlyTopLevel` | boolean | `true` | 只提示顶层会话 |
| `notifyComplete` | boolean | `true` | 对话完成推送开关 |
| `notifyApproval` | boolean | `true` | 等待授权推送开关 |
| `notifyQuestion` | boolean | `true` | 等待回答推送开关 |
| `completeMessage` | string | `"会话已完成"` | 完成正文 |
| `approvalMessage` | string | `"需要你允许执行操作"` | 授权正文 |
| `questionMessage` | string | `"需要你回答一个问题"` | 提问正文 |
| `includeTitle` | boolean | `true` | 完成推送是否拼标题 |
| `skipReasons` | string[] | `["interrupted","aborted"]` | 视为"非完成"的结束原因 |
| `bindings` | object | `{}` | 配置期初始绑定：`{ sessionId: url }` |

## 数据契约

**绑定记录**（运行时内存 + 持久化）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | string | 是 | 会话窗口标识，主键 |
| `url` | string | 是 | webhook 地址 |
| `updatedAt` | string | 是 | ISO-8601，最后变更时间 |

**持久化位置**：`$DSH_HOME/state/dsh-notice-webhook/bindings.json`（`DSH_HOME` 未设置时为 `~/.dsh`）。

**文件格式**：

```json
{
  "version": 1,
  "bindings": {
    "session-b7c52392-9cdf-4162-b1c6-ed768346fbd2": {
      "url": "https://example.com/hook",
      "updatedAt": "2026-09-30T04:37:01.901Z"
    }
  }
}
```

**版本兼容**：`version` 字段用于将来迁移；读到不认识的 `version` 时按空表处理并记 warn，不尝试猜测。

## 迁移与兼容

- **全新插件，无历史数据**：首次启动没有绑定文件属正常，走空表 + 默认地址。
- **与 dsh-notice 共存**：两者插件名不同，可同时安装。本插件**不读也不写** dsh-notice 的配置与触发目录，互不干扰。
- **会话 id 失效**：绑定表里的孤儿记录不自动清理（避免误删），在 `list()` 中可见，由使用者或调用方决定是否 `unbind`。
- **回滚**：卸载本插件即完全回滚——不残留会话数据，只留一个绑定文件（可手工删除）。
- **配置向后兼容**：新增配置键一律给默认值；旧配置文件不写新键也能跑。
- **payload 向后兼容**：`goal` 字段与 `goal/complete`、`goal/blocked` 两个取值都是**追加**，`version` 保持 `1`；接收端应忽略不认识的字段与取值，未升级的接收端行为不变。
- **无 goal 的会话零影响**：不创建 goal 的普通会话，事件与正文口径与 FR-1 完全一致（FR-11 只在检测到 goal 自动轮时生效）。

## 边界（不做什么）

- **不做双向通道**：外部 webhook 回消息**不会**注入会话继续跑。理由：本轮只做单向推送；双向需要接 Session Controller 的注入链路，属独立子系统，另立需求。
- **不做桌面托盘 / 系统通知**：理由是 [dsh-notice](https://github.com/Tenold-a/dsh-notice) 已经覆盖 Windows 场景，本插件只做 HTTP 这一跳。
- **不做签名加密（HMAC）**：本期用自定义请求头做鉴权（如 `Authorization`）。理由：签名需要双方约定密钥与算法，等出现真实安全诉求再单独立项。
- **不做管理 UI**：本期不注册设置页。理由是绑定主体是"其他插件自动绑定"（FR-8），手工绑定走配置文件即可；UI 留待有真实手工操作诉求时再做。
- **不做消息聚合 / 静默时段 / 免打扰**：理由是本期解决"收得到"，聚合与免打扰是"收得少"，属 P2。
- **不做 goal 过程轮通报**：goal 自动续轮的每轮完成**明确不推送**（见 FR-11）。理由：一轮可能只跑几十秒，逐轮提醒等于噪音；人只需要知道"跑完了"或"卡住了"。

## 非功能需求

- **不阻塞会话**：投递走异步，`turn/end` 之后的会话流程不被网络等待拖住。测试方法：接收端 sleep 10s，观察会话正常结束。
- **失败隔离**：任何 webhook 异常（DNS 失败、超时、非 2xx、JSON 解析失败）都不得让会话报错。测试方法：地址指向 `127.0.0.1:1` 跑完整轮次。
- **凭据不进日志**：URL 的 query 与 headers 不得出现在日志里，日志只记 host。测试方法：用带 token 的 URL 触发失败，检查日志。
- **无第三方依赖**：投递用 Node 内置 `fetch`；不因装这一个插件引入 npm 供应链。
- **跨平台**：macOS / Linux / Windows 行为一致（纯 HTTP，无平台特有代码）。

## 验收标准（整体）

1. 装好插件，配置一个本地接收器（见下方命令）+ 默认地址；
2. 跑一轮完整对话到结束 → 接收端收到 `turn/end`，`message` 形如「标题 · 会话已完成」；
3. 触发一次需要授权的操作 → 收到 `approval/asked`，`toolName` 正确；
4. 触发 `ask_user_question` → 收到 `ask_user_question`；
5. 普通工具调用（`read`）→ **没有**推送；
6. 关掉接收器再触发 → 会话照常完成，日志有 warn，无异常；
7. 用消费插件 `bind()` 绑定会话 A、`enabled: false` → A 仍推送；会话 B 未绑定 → 不推送；
8. 重启 Host → A 的绑定仍生效。
9. 建一个 goal 让它自动跑 ≥2 轮 → **没有**推送（自动唤醒静默）；
10. 让 goal 跑到完成、或把轮次上限设成 1 跑到耗尽 → 各收到一条终态推送。

**可执行判定命令**：

```sh
# 起一个本地接收器（只打印收到的 JSON）
python3 - <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0))
        print(self.rfile.read(n).decode(), flush=True)
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', 8899), H).serve_forever()
PY
```

```sh
# 失败隔离验证：地址指向必然拒绝的端口，观察会话是否照常完成
curl -sS -X POST http://127.0.0.1:1/ ; echo "exit=$?"
```

## 依赖与约束

- **依赖（强）**：DSH 会话事件 `session/event`，需能收到 `turn/end`、`approval/asked`、`tool/call`、`session/title`。
- **依赖（强）**：goal 自动轮的识别依据——会话日志里 `source.kind === "goal"` 的 user message（`dsh-goal-round-driver` 注入，带 `goalId`/`revision`/`round`），以及 goal 的 `phase`（终态判定）。轮次耗尽的终态 code 固定为 `round-limit`。
- **依赖（参考）**：[dsh-notice](https://github.com/Tenold-a/dsh-notice) 的事件映射与开关口径（只有顶层会话、跳过 interrupted/aborted），本需求沿用同一口径以保证两个插件行为一致。
- **约束**：服务名 `dshNoticeWebhook` 不得与现有 Host 服务冲突（已知占用：`dshIm`）。
- **约束**：插件 id 不得与 `dsh-notice` 冲突，两者可能装在同一 profile。
- **约束**：配置读取遵循 DSH profile 的 `cordis.patch.yml` 约定。

<!-- reqboard:marks:begin 机器维护，请勿手改 -->

#### 条款接收状态（随卡的生命周期自动更新）

| 编号 | 接收状态 | 承载任务 |
|------|---------|---------|
| FR-1 | ✅ 已接收 | t1、t5 |
| FR-2 | ✅ 已接收 | t5 |
| FR-3 | ✅ 已接收 | t5 |
| FR-4 | ✅ 已接收 | t1、t4、t9 |
| FR-5 | ✅ 已接收 | t5 |
| FR-6 | ✅ 已接收 | t2、t3、t7 |
| FR-7 | ✅ 已接收 | t9、t7 |
| FR-8 | ✅ 已接收 | t3 |
| FR-9 | ✅ 已接收 | t2、t10 |
| FR-10 | ✅ 已接收 | t3 |
| FR-11 | ✅ 已接收 | t6a、t6b |

> 无未接收条款（11 条全部有落点）。

<!-- reqboard:marks:end -->
