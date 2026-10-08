---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11]
---

# 测试用例设计（REQ-260930123701-250a）

> 每个用例标注 `validates: FR-x`（验证哪条需求条款）。
> **任务键（`covers: t-xxx`）在拆分阶段落库后回填**——本份先按 FR 对齐，避免写死尚不存在的任务号。
> 测试全部用 Node 内置 `node:test` + 本地 HTTP 接收端，不引入测试框架依赖。

## 功能测试用例 `serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11`

### TC-1：对话完成推送 `validates: FR-1` `serves: FR-1`

**测试目标**：顶层会话 `turn/end` 触发一次推送，正文按标题有无正确拼接。

**前置条件**：默认地址指向本地接收端；`includeTitle: true`。

**测试步骤**：

1. 合成会话事件 `session/title`（`title = "修复登录 bug"`）；
2. 合成 `turn/end`（`reason.kind = "completed"`）；
3. 再合成一个**无标题**会话的 `turn/end`。

**预期结果**：

- 接收端收到 2 条请求，`event` 均为 `turn/end`；
- 第一条 `message` = `修复登录 bug · 会话已完成`，`title` = `修复登录 bug`；
- 第二条 `message` = `会话已完成`，`title` = `null`。

**覆盖场景**：

- [x] 正常流程
- [x] 边界值（无标题）
- [ ] 异常处理

### TC-2：等待授权推送 `validates: FR-2` `serves: FR-2`

**测试目标**：`approval/asked` 带工具名推送。

**测试步骤**：合成 `approval/asked`（`toolName = "Bash"`）；再合成一个 `toolName` 缺失的。

**预期结果**：

- 第一条 `event = approval/asked`，`message = 需要你允许执行操作（Bash）`，`toolName = "Bash"`；
- 第二条 `message = 需要你允许执行操作`，`toolName = null`。

**覆盖场景**：

- [x] 正常流程
- [x] 边界值（工具名缺失）

### TC-3：等待回答推送 `validates: FR-3` `serves: FR-3`

**测试目标**：只有 `ask_user_question` 触发提问推送。

**测试步骤**：合成 `tool/call`（`name = "ask_user_question"`）。

**预期结果**：`event = ask_user_question`，`message = 需要你回答一个问题`。

**覆盖场景**：

- [x] 正常流程

### TC-4：非目标事件不推送 `validates: FR-3, FR-5` `serves: FR-3, FR-5`

**测试目标**：普通工具调用与无关事件不产生请求。

**测试步骤**：合成 `tool/call`（`name = "read"`）、`step/start`、`assistant/message`。

**预期结果**：接收端**收到 0 条请求**。

**覆盖场景**：

- [x] 边界值（不该发的坚决不发）

### TC-5：子代理与中断过滤 `validates: FR-5` `serves: FR-5`

**测试目标**：`onlyTopLevel` 与 `skipReasons` 生效。

**测试步骤**：

1. 合成 `parentSession` 存在的会话的 `turn/end`；
2. 合成顶层会话 `turn/end`（`reason.kind = "interrupted"`）；
3. 合成顶层会话 `turn/end`（`reason.kind = "completed"`）。

**预期结果**：只有第 3 步产生 1 条请求。

**覆盖场景**：

- [x] 正常流程
- [x] 边界值（子会话 / 中断）

### TC-6：绑定优先于默认地址 `validates: FR-6` `serves: FR-6`

**测试目标**：窗口绑定覆盖默认地址。

**前置条件**：默认地址 = 接收端 A；会话 X 绑定到接收端 B；会话 Y 不绑定。

**测试步骤**：分别对 X、Y 合成 `turn/end`。

**预期结果**：X 的事件只到 B；Y 的事件只到 A；A 与 B 各收到 1 条，**无重复投递**。

**覆盖场景**：

- [x] 正常流程
- [x] 边界值（绑定地址 == 默认地址时只发一次）

### TC-7：总开关旁路 `validates: FR-7` `serves: FR-7`

**测试目标**：`enabled: false` 时未绑定窗口静默、已绑定窗口照发。

**测试步骤**：`enabled: false`；会话 X 已绑定接收端 B，会话 Y 未绑定；各合成一次 `turn/end`。

**预期结果**：B 收到 X 的 1 条；默认接收端 **0 条**。

**覆盖场景**：

- [x] 正常流程
- [x] 边界值（旁路语义）

### TC-8：分类开关不豁免绑定 `validates: FR-7` `serves: FR-7`

**测试目标**：内容级过滤优先于路由旁路。

**测试步骤**：`notifyApproval: false`；会话 X 已绑定；合成 `approval/asked`。

**预期结果**：接收端 **0 条**（绑定不豁免分类开关）。

**覆盖场景**：

- [x] 边界值（两条规则的交界）

### TC-9：goal 自动轮静默 `validates: FR-11` `serves: FR-11`

**测试目标**：系统唤醒的轮次不产生任何推送。

**前置条件**：插件已加载；会话 Z 有活动 goal。

**测试步骤**：

1. 合成 3 条 `user/message`（`source.kind = "goal"`）+ 对应 `turn/end`；
2. 再合成 1 条人工 `user/message`（无 goal source）+ `turn/end`。

**预期结果**：前 3 轮 **0 条请求**；第 4 轮**收到 1 条** `turn/end`（人工轮不被误伤）。

**覆盖场景**：

- [x] 正常流程
- [x] 边界值（人工轮与自动轮同会话混跑）

### TC-10：goal 完成终态推送 `validates: FR-11` `serves: FR-11`

**测试步骤**：合成 `goal/change`，`phase` 由 `active` 变为 `complete`。

**预期结果**：收到 1 条 `goal/complete`，正文 `标题 · 目标已完成`，`goal.phase = "complete"`。

**覆盖场景**：

- [x] 正常流程

### TC-11：轮次耗尽与阻塞终态 `validates: FR-11` `serves: FR-11`

**测试步骤**：

1. 合成 `goal/change`，`phase = "blocked"`、`blockedReason.code = "round-limit"`、`maxGoalRounds = 20`；
2. 合成另一个 goal 的 `blocked`（`code = "queue-failed"`）；
3. 对同一 `(goalId, revision, phase)` 重复上报一次。

**预期结果**：

- 第 1 步收到 `message = 标题 · 目标轮次耗尽（20/20）`；
- 第 2 步收到 `message = 标题 · 目标阻塞（queue-failed）`；
- 第 3 步**不产生新请求**（去重生效）。

**覆盖场景**：

- [x] 正常流程
- [x] 边界值（重复上报去重）

### TC-12：投递失败隔离 `validates: FR-4` `serves: FR-4`

**测试目标**：接收端不可用时，会话不受影响。

**测试步骤**：地址指向 `http://127.0.0.1:1/`；合成 `turn/end`；观察会话与日志。

**预期结果**：

- 会话流程正常结束，**无未捕获异常 / 无 unhandledRejection**；
- 日志出现 1 条 warn，含 host 与错误类名；
- 日志中**不含**完整 URL 的 query 与 headers。

**覆盖场景**：

- [x] 异常处理
- [x] 边界值（超时：接收端 sleep 10s，`timeoutMs = 1000` 后放弃且不阻塞）

### TC-13：绑定持久化往返 `validates: FR-9, FR-10` `serves: FR-9, FR-10`

**测试目标**：绑定跨重启恢复，坏文件安全降级。

**测试步骤**：

1. `bind(sessionId, url)` → 检查文件内容为 `{version:1, bindings:{...}}`；
2. 重新构造插件实例（模拟重启）→ `resolve(sessionId)`；
3. 把文件写成非法 JSON → 重新构造 → 观察启动日志与 `list()`。

**预期结果**：

- 第 2 步 `resolve()` 返回 `{ url, source: 'binding' }`；
- 第 3 步插件正常加载，日志 warn，`list()` 为空，**原文件未被覆盖**。

**覆盖场景**：

- [x] 正常流程
- [x] 异常处理（损坏文件）

### TC-14：Host Service 契约 `validates: FR-8, FR-10` `serves: FR-8, FR-10`

**测试目标**：服务签名与降级语义符合 interfaces.md。

**测试步骤**：

1. 取 `ctx.dshNoticeWebhook`，校验 `version === 1`；
2. `bind('', 'https://x')`、`bind('s1', 'ftp://x')`、`bind('s1', 'not-a-url')`；
3. `unbind('不存在的会话')`；
4. `resolve('未绑定且无默认地址的会话')`。

**预期结果**：

- 第 2 步全部返回 `false`，且绑定表**无新增**；
- 第 3 步返回 `false`；
- 第 4 步返回 `null`。

**覆盖场景**：

- [x] 边界值
- [x] 异常处理

## 测试覆盖度统计 `serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11`

| 需求条款 | 关联任务 | 测试用例 | 覆盖状态 |
|---|---|---|---|
| FR-1 | 拆分阶段落库后回填 | TC-1 | ✅ 已覆盖 |
| FR-2 | 拆分阶段落库后回填 | TC-2 | ✅ 已覆盖 |
| FR-3 | 拆分阶段落库后回填 | TC-3, TC-4 | ✅ 已覆盖 |
| FR-4 | 拆分阶段落库后回填 | TC-12 | ✅ 已覆盖 |
| FR-5 | 拆分阶段落库后回填 | TC-4, TC-5 | ✅ 已覆盖 |
| FR-6 | 拆分阶段落库后回填 | TC-6 | ✅ 已覆盖 |
| FR-7 | 拆分阶段落库后回填 | TC-7, TC-8 | ✅ 已覆盖 |
| FR-8 | 拆分阶段落库后回填 | TC-14 | ✅ 已覆盖 |
| FR-9 | 拆分阶段落库后回填 | TC-13 | ✅ 已覆盖 |
| FR-10 | 拆分阶段落库后回填 | TC-13, TC-14 | ✅ 已覆盖 |
| FR-11 | 拆分阶段落库后回填 | TC-9, TC-10, TC-11 | ✅ 已覆盖 |

**端到端验收**（人工，对应 requirement.md「验收标准（整体）」）：用真实 `dsh web` 起本地接收端，跑一轮对话 / 一次授权 / 一次提问 / 一个 goal，核对第 1–10 步观察项。
