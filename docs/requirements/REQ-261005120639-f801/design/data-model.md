---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend]
---

# 数据模型设计：完成闸门的内存状态

> **本需求不新增任何落盘数据**：闸门状态全在内存（进程重启归零），存储版本、目标清单、
> 绑定关系、出站报文一概不动。

## 内存状态模型 <!-- serves: FR-1, FR-2 -->

```
createJobGate 实例
├── jobs            : { list(), events.subscribe() } | null      ← 既有（形状消费 ctx.jobs）
├── agents          : { list() } | null                          ← 新增（形状消费 ctx.agents）
├── offEvents       : () => void | null                          ← 既有（job 事件订阅）
├── turnStarts      : Map<sessionId, number>                     ← 既有（轮次起点墙钟毫秒）
├── pending         : Map<sessionId, PendingRecord>              ← 既有，字段扩展
├── warnedUnavailable      : boolean                             ← 既有（job 服务降级只报一次）
└── warnedSubagentsUnavailable : boolean                         ← 新增（agent 注册表降级只报一次）
```

## `PendingRecord` 字段 <!-- serves: FR-2 -->

| 字段 | 类型 | 说明 | 新增 |
|---|---|---|---|
| `session` | Session（引用） | 被压住那一刻的会话对象（补发要用同一引用取标题/绑定） | 否 |
| `intent` | 意图对象 | 被压住的完成意图（补发时逐字段复用） | 否 |
| `prompt` | string \| null | 该轮最后一条人工输入（补发报文里"任务"字段要用） | 否 |
| `jobIds` | string[] | 抑制时快照到的未结算 job id（可观测 / 日志） | 否 |
| `subagentIds` | string[] | 抑制时快照到的 `running` 后代会话 id（可观测 / 日志） | **是** |
| `watched` | Set<string> | 仍在等的 job id（收到终态即删；空 = job 路已清） | 否 |
| `timer` | handle \| undefined | 宽限计时器句柄（到点补发） | 否 |

**为什么子代理只用快照、不用 watched 集合**：job 的存活靠事件（settled / removed）推进；
子代理的存活**每次现查** `agents.list()`（"拉"），所以 `subagentIds` 只作留痕，
`maybeSettle` 判定时**重新拉取**——避免漏事件导致 pending 永久卡住。

## 生命周期与清理 <!-- serves: FR-2, FR-4 -->

| 时机 | 动作 |
|---|---|
| `turn/start(S)` | `cancelPending(S)`（清计时器 + 删记录，既有语义）；记 `turnStarts[S] = now`（既有） |
| `gate()` 抑制 | `cancelPending(S)` 后写入新 `PendingRecord`（既有语义：一轮只留一条 pending） |
| job 终态（settled / removed） | `watched.delete(jobId)` → `maybeSettle(S)`（既有逻辑改为调用 `maybeSettle`） |
| `subagent/end` | 对**每个** pending 会话 `maybeSettle(S)`（不依赖事件归因；pending 数量级为个位数） |
| `maybeSettle` 通过 | 起/重置宽限计时器（1500ms 默认，注入式） |
| 计时器到点 | pending 仍在 → `deliver()` 补发 → 删记录；已被新轮次清掉 → 什么都不做 |
| `dispose()` | 清所有 pending + 计时器；`detach()` + `detachSubagents()` |

**有界性**：`pending` ≤ 活跃会话数；`turnStarts` ≤ 会话数（既有）——无新增无界增长。

## 只读事实源形状 <!-- serves: FR-3 -->

### `agents.list()` 条目（只读字段） <!-- serves: FR-3 -->

```js
{ id: 'session-child',                                   // 缺省回落 session.header.id
  status: 'running' | 'idle' | …,
  session: { header: { id, parentSession?, origin?, delegationDepth? } } }
```

血缘下钻算法（纯函数，`visited: Set` 防环）：

```
childrenOf ← 遍历 list()：有 header.parentSession（非空字符串）∧ header.origin === 'subagent'
            ∧ id 非空字符串 的条目，按 parentSession 分桶
BFS(root=sessionId)：逐层取出子条目 → status === 'running' 的收进结果 → 继续下钻
返回：去重后的 id 列表
```

### `subagent/end` 事件（只读首参，仅作复检时机） <!-- serves: FR-2 -->

```js
{ runId, provider, id /* 子会话 id */, local, stopReason? }
```

### `ctx.jobs`（既有，不变） <!-- serves: FR-1 -->

沿用既有形状校验 `isJobRegistryLike` 与 `list(sessionId)` 过滤（`owner === sessionId` ∧
`status ∈ {running, stopping}` ∧ `startedAt >= 本轮起点`）。

## 无落盘数据 <!-- serves: FR-5 -->

- 不新增文件、不改 `~/.dsh/storages/*` 的任何 schema、不动 `targets` / `bindings` / `outcomes` 存储；
- 不新增出站字段（报文 `version: 1` 不变）；
- 卸载后零残留：内存状态随插件实例销毁。
