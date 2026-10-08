---
title: 数据模型 · 后台 job 运行中不再推「会话已完成」
requirement_refs: [REQ-261001202058-0fbe]
updated: 2026-10-01
---

# 数据模型

> **TL;DR**：**零落盘变更**。新增一个配置字段 `jobAwareComplete`（boolean，默认 `true`，volatile）与
> 两张进程内表（轮次起点、本轮 pending）；两张表按会话在「新轮次 / `dispose`」时清理，上界由会话数决定。

## 1. 新增配置字段（serves: FR-4）

| 字段 | 类型 | 默认 | 必填 | 约束 | 变化 |
|---|---|---|---|---|---|
| `jobAwareComplete` | boolean | `true` | ✕ | 非 boolean → 回落 `true` + warn | **新增** |

四处登记（缺一处会出现「schema 声明了 DEFAULTS 没有」或 volatile 集合断言失败）：
`src/config.js` 的 `DEFAULTS` / `BOOLEAN_KEYS` / `Config` schema（`.volatile()`）/ `VOLATILE_KEYS`。

## 2. 进程内状态（serves: FR-2, FR-3）

```js
// ① 轮次起点：判定「哪些 job 是本轮拉起的」（FR-2）
turnStarts: Map<SessionId, number>            // 值 = 收到 turn/start 时的 clock() 毫秒

// ② 本轮 pending：被抑制的那条结论 + 还在等结算的 job 集合（FR-3）
pending: Map<SessionId, {
  session,            // 捕获的会话对象引用（报文要读 header.id / header.cwd）
  intent,             // 捕获的完成意图（message 已按当时的标题拼好）
  prompt,             // 捕获的「本轮你说的话」（补发报文要用）
  watched: Set<JobId>,// 本轮拉起、尚未结算的 job id
  timer,              // 宽限计时器句柄（watched 空时才存在）
}>
```

| 生命周期事件 | `turnStarts` | `pending` |
|---|---|---|
| `turn/start`（FR-2/FR-3） | 覆盖为该时刻 | **整条删除**（并取消计时器） |
| `turn/end` 被抑制 | 不变 | 新建 / 覆盖（同一会话至多一条） |
| job `settled` / `removed` | 不变 | 从 `watched` 摘除；空则起计时器 |
| 宽限到点 | 不变 | 删除 → 补发一次 |
| `dispose`（插件卸载） | 清空 | 逐条取消计时器后清空 |

## 3. 判定式（实现与测试共用，唯一口径）（serves: FR-1, FR-2）

```
gate(session, intent) :=
  let sid = session.header.id
  let since = turnStarts.get(sid)
  if (since === undefined) → { suppressed:false, reason:'no-turn-start' }   // 保守：不抑制
  let live = jobs.list(sid)
              .filter(j => j.owner === sid)                                 // 只算本会话名下的
              .filter(j => j.status === 'running' || j.status === 'stopping')
              .filter(j => Number.isFinite(j.startedAt) && j.startedAt >= since)  // 只算本轮拉起的
  if (live.length === 0) → { suppressed:false, reason:'no-jobs' }
  pending.set(sid, { session, intent, prompt, watched:new Set(live.map(j=>j.id)), timer:undefined })
  → { suppressed:true, jobIds: live.map(j=>j.id) }
```

**为什么用 `startedAt >= turn/start 时刻` 而不是「订阅 registered 事件攒集合」**：
`JobView` 已带 `startedAt`，一次 `list` 即可判定，**不引入跨事件的状态漂移**（漏事件、乱序都不影响结论）。
`turn/start` 缺失时的保守取向（不抑制）与 FR-4 的「宁可误报，不可漏报」同向。

## 4. 不落盘 / 不迁移（serves: FR-4, FR-5）

| 数据 | 本需求是否触碰 |
|---|---|
| `targets.json`（含版本号与字段） | ❌ 不动 |
| `bindings.json` | ❌ 不动 |
| Outcome 投影（每个目标最近 N 条） | ❌ 不动 |
| RPC `/state` 与写端点 | ❌ 不动（不新增字段、不新增界面控件） |
| 出站 v1 报文契约 | ❌ 不动（补发与直接投递同形） |
| 客户端半（`client.js`） | ❌ 不动（本需求 `sides: [backend]`） |

**回滚矩阵**：

| 场景 | 行为 |
|---|---|
| 老配置不加 `jobAwareComplete` | 新行为生效（缺陷修复） |
| 配置 `jobAwareComplete:false` | 逐字回到旧行为（热改，不重启） |
| 组合里没有 `ctx.jobs` | 降级为旧行为 + 一条 warn |
| 卸载本版本 | 零残留：没有新文件、没有新落盘键 |

## 5. 内存上界（serves: FR-3）

| 表 | 上界 | 清理时机 |
|---|---|---|
| `turnStarts` | ≤ 收到过 `turn/start` 的会话数（长跑进程里随会话增长） | 仅 `dispose`；每条只有一个 number，量级可忽略 |
| `pending` | ≤ **有被抑制轮次的活跃会话数** | 新轮次 / 宽限到点 / `dispose` |
| `watched` | ≤ 该轮拉起的 job 数 | 结算即摘除 |

> `turnStarts` 不做会话级回收：DSH 未提供「会话销毁」事件给 Host 插件，强行回收需要猜；
> 每条仅一个 number、且与会话数同阶，不构成写放大或泄漏风险（已在 architecture §9 记账）。
