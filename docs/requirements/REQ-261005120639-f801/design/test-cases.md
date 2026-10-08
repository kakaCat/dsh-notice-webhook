---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend]
---

# 测试用例设计：完成闸门纳入 continuable 子代理

跑法（全部在仓库根）：

```bash
node --test test/jobs-gate.test.js      # 本次新增与改造的用例
node --test "test/*.test.js"            # 基线：307 只增不减，fail 0
```

假件沿用既有测试脚手：`makeClock()`（假时钟）、`makeTimers()`（假计时器，`flush()` = 宽限到点）、
`makeRegistry()`（假 job 服务）；**新增** `makeAgents(entries)`（假 agent 注册表：`{ list: () => entries }`，
条目可增删改以模拟"子代理还在跑 / 已结算"）。

## TC-1 判定层：纯子代理在跑 → 抑制 <!-- serves: FR-1 -->

- **输入**：`gate.attachSubagents(makeAgents([child('s-child','s1','running')]))`；`noteTurnStart('s1')`；
  `gate.gate(sessionOf('s1'), completeIntent, null)`。
- **期望**：`{ suppressed:true, reason:'subagent-running', jobIds:[], subagentIds:['s-child'] }`。

## TC-2 判定层：子代理 `idle` / 血统不达 / 非 subagent origin → 不抑制 <!-- serves: FR-1, FR-3 -->

| 条目 | 期望 |
|---|---|
| `{ parentSession:'s1', origin:'subagent', status:'idle' }` | `{suppressed:false, reason:'no-work'}` |
| `{ parentSession:'s2', origin:'subagent', status:'running' }`（别的会话的） | 同上 |
| `{ parentSession:'s1', origin:undefined, status:'running' }`（普通 fork 共享血统） | 同上 |
| `{ header:{} }` / `{}` / `null`（脏条目） | 同上（跳过，不抛） |

## TC-3 判定层：孙代（任意深度）与环 <!-- serves: FR-3 -->

- `s-child`（parent=s1, running=false）→ `s-grand`（parent=s-child, origin=subagent, running=true）→ 抑制，`subagentIds:['s-grand']`。
- 自指环（entry id = parent）：不挂死、不死循环，返回 `[]`。

## TC-4 判定层：job 与子代理的三种 reason <!-- serves: FR-1, FR-6 -->

| 场景 | 期望 `reason` |
|---|---|
| 仅未结算 job | `'job-running'`（**逐字保留**既有语义） |
| 仅 running 子代理 | `'subagent-running'` |
| 两者都有 | `'work-running'`，且 `jobIds` 与 `subagentIds` 都非空 |

## TC-5 判定层：两路都不可用 / 无轮次起点 <!-- serves: FR-4 -->

- 不 `attach` 也不 `attachSubagents` → `{suppressed:false, reason:'unavailable'}`（既有断言保留）。
- `attach(makeRegistry())` + 无 `noteTurnStart` → `{suppressed:false, reason:'no-turn-start'}`（既有断言保留）。
- **仅 job 不可用但 agents 可用** → 子代理仍参与判定（不许因 job 服务缺失而整条失效）。

## TC-6 判定层：降级与容错 <!-- serves: FR-4 -->

| 情况 | 期望 |
|---|---|
| `attachSubagents({})`（缺 list） | 返回空 detach；一条 warn（只报一次）；判定照旧可用 |
| `attachSubagents({ list: () => { throw new Error('x') } })` | 该次视为无子代理；warn；**不抛** |
| `attachSubagents({ list: () => 'nope' })` | 同上（非数组） |

## TC-7 接线层：`handle()` 端到端抑制与补发 <!-- serves: FR-1, FR-2 -->

- **抑制**：`createNotifier({}, { targets, bindings, agents: makeAgents([runningChild]) , timers, clock })` →
  先 `handle(session, {type:'turn/start'})` 再 `handle(session, turnEndCompleted)` →
  `{action:'dropped', reason:'subagent-running'}`，接收端 **0 条**报文。
- **复检**：把假件里的子代理改成 `status:'idle'`（或从 `list()` 移除）→ `gate.observeSubagentEnd()` →
  `timers.flush()` → **恰好 1 条**补发报文，`event/version/message` 与直接投递逐字段一致（忽略 `at`）。
- **新轮次取消补发**：复检后、`flush()` 之前 `handle(session, {type:'turn/start'})` → `flush()` 后 0 条；随后该新轮次 `turn/end` 正常投递 1 条。
- **多子代理**：两个 running 子代理，只结算一个 → 0 条；第二个也结算 + `flush()` → 恰好 1 条。
- **job + 子代理混合**：job 先结算 → 0 条；子代理后结算 + `flush()` → 恰好 1 条。

## TC-8 开关与回滚 <!-- serves: FR-4 -->

- `createNotifier({ jobAwareComplete: false }, { agents: makeAgents([runningChild]), … })` + `turn/end` → `{action:'sent'}`（旧行为，不抑制、不补发）。
- 不注入 `agents` + running 子代理 → `{action:'sent'}` + 1 条降级 warn。

## TC-9 报文与既有断言不回归 <!-- serves: FR-5 -->

- `node --test test/compat*.test.js test/e2e.*.test.js test/jobs-gate.test.js` 全绿。
- 补发报文与基线完成报文逐字段相等（忽略 `at`）。
- `src/classify.js` 零改动（`git diff --stat` 核对）。

## TC-10 文档口径与原因码 <!-- serves: FR-6 -->

- `grep -rn "subagent-running" src/ docs/guides/operations.md` 命中（代码 + 文档表各一行）。
- `grep -rn "只读 ctx.jobs" docs/` 不再命中（旧口径已改述）。

## TC-11 存量断言的两处同步更新（预期内的改动） <!-- serves: FR-4 -->

`gate.gate()` 的"两路都空"诊断码由 `'no-jobs'` 改为 `'no-work'`：`test/jobs-gate.test.js` 中
两处 `deepEqual(..., {suppressed:false, reason:'no-jobs'})` 同步改为 `'no-work'`。
**除此以外不改任何既有断言**（`'unavailable'` / `'no-turn-start'` / `'job-running'` 逐字保留）。

## TC-12 现场复算（人工核对一次） <!-- serves: FR-1 -->

```bash
python3 docs/requirements/REQ-261005120639-f801/repro-continuable-window.py
```

- **口径**：脚本列出「父会话 `turn/end(completed)` 时同轮派出的 continuable 子代理仍在跑」的窗口；
  它读的是**历史日志**，用于证明问题规模（基线 27 个窗口）。
- **新行为核对**：新判定下这些窗口会被压住（`subagent-running`），补发发生在子代理真正结束之后。
- 期望：脚本输出仍为 27 个窗口（基线不变），且实现后人工抽查 1 个窗口的父/子时间线符合预期。
