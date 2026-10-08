---
requirement_refs: [FR-5, FR-6, FR-9, FR-10, FR-11]
---

# 数据模型设计（REQ-260930123701-250a）

> 持久化的只有绑定表；其余都是进程内内存状态，重启即弃。

## TL;DR `serves: FR-9`

- **持久**：一份 `bindings.json`（`$DSH_HOME/state/dsh-notice-webhook/`），原子写（tmp + rename）。
- **内存**：会话标题、goal 状态、终态去重集、冷却时间戳——全部丢弃即安全。

## 持久化数据结构 `serves: FR-6, FR-9, FR-10`

### BindingEntry `serves: FR-6, FR-10`

**用途**：一条"会话窗口 → webhook 地址"的绑定。

**定义**：

```typescript
interface BindingEntry {
  sessionId: string    // 主键，会话窗口标识（session.header.id）
  url: string          // webhook 绝对地址，http:// 或 https:// 开头
  updatedAt: string    // ISO-8601，最后一次变更时间
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 | 约束 |
|---|---|---|---|---|
| `sessionId` | string | 是 | 会话窗口标识 | 非空字符串；作为 Map 的 key |
| `url` | string | 是 | 投递地址 | 必须能被 `new URL()` 解析且 `protocol ∈ {http:, https:}` |
| `updatedAt` | string | 是 | 最后变更时间 | ISO-8601；写入时由 `new Date().toISOString()` 生成 |

**索引设计**：

| 索引名 | 字段 | 类型 | 原因 |
|---|---|---|---|
| `sessionId` | `sessionId` | 主键（Map key） | 路由查询是唯一热路径，需 O(1) |

**关联关系**：

| 关联到 | 类型 | 外键 | 说明 |
|---|---|---|---|
| DSH Session | 1:1 | `sessionId` → `session.header.id` | 不校验存在性（见"孤儿绑定"） |

### BindingsFile `serves: FR-9`

**用途**：磁盘上的绑定表快照。

**定义**：

```typescript
interface BindingsFile {
  version: 1                                   // 文件格式版本
  bindings: Record<string, Omit<BindingEntry, 'sessionId'>>  // sessionId → { url, updatedAt }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 | 约束 |
|---|---|---|---|---|
| `version` | number | 是 | 文件格式版本 | 当前仅 `1`；读到其他值按空表处理并 warn |
| `bindings` | object | 是 | 绑定映射 | key 为 `sessionId`；value 为 `{ url, updatedAt }` |

**持久化位置**：`$DSH_HOME/state/dsh-notice-webhook/bindings.json`；`DSH_HOME` 未设置时回落 `~/.dsh`。

**写盘方式**：写 `<file>.tmp` → `rename()` 覆盖。**原子性靠 rename**——进程被杀不会留下半个 JSON。

**文件样例**：

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

**读取容错**（优先级从高到低）：

| 情况 | 行为 |
|---|---|
| 文件不存在 | 空表启动，**不创建文件**（写操作发生时才创建） |
| 非法 JSON | warn，空表启动，**不覆盖原文件**（避免把可抢救的数据冲掉） |
| `version` 不认识 | warn，空表启动，不覆盖 |
| 单条记录字段非法（缺 `url` / `url` 非 http(s)） | 跳过该条并 warn，其余照常加载 |
| 目录不可写 | warn；绑定仍在内存生效，重启即丢 |

## 内存状态 `serves: FR-5, FR-11`

> 全部为进程内状态，**不持久化**；重启后从零重建（丢一条通知可接受，丢绑定不可接受）。

| 状态 | 结构 | 生命周期 | 服务于 |
|---|---|---|---|
| 会话标题 | `WeakMap<Session, string>` | 随 Session 对象回收 | FR-1（标题拼接） |
| 最近一次推送时间 | `WeakMap<Session, number>` | 同上 | FR-5（冷却） |
| 当前 turn 的人工输入标记 | `WeakMap<Session, { sawHuman: boolean }>` | 每 turn 重置 | FR-11（自动轮静默） |
| 当前 goal 状态 | `WeakMap<Session, { id, revision, phase, maxGoalRounds }>` | 随 `goal/change` 更新 | FR-11（终态判定） |
| 已推送的终态集合 | `Set<string>`（key = `goalId:revision:phase`） | 进程存活期 | FR-11（终态去重） |
| 绑定表 | `Map<string, BindingEntry>` | 随插件卸载回收 | FR-6 / FR-9 |

**为什么标题与冷却用 `WeakMap`**：key 是 Session 对象本身，会话被回收后状态自动消失，不需要任何清理逻辑，也不会把已归档会话永久钉在内存里。

**为什么终态去重用 `Set<string>` 而不是 `WeakMap`**：goal 的去重键来自事件负载（`goalId`），不是对象引用；进程内 Set 足够（跨重启重复推送的概率极低，且多推一条不致命）。

## 迁移与兼容 `serves: FR-9`

| 变更项 | 旧版本行为 | 新版本行为 | 迁移方案 |
|---|---|---|---|
| 新增绑定表 | 无此文件 | 首次 `bind` 时创建 | 无历史数据，零迁移 |
| 文件 `version` 演进 | 仅 `1` | 未来升到 `2` 时按版本分支读 | 读到未知版本 → 空表 + warn（宁可丢绑定，不可猜格式） |
| 与 dsh-notice 共存 | dsh-notice 不落任何状态文件 | 本插件只写自己的目录 | 互不读写；卸载后残留一个文件，可手工删 |

**回滚路径**：卸载插件 + 删除 `$DSH_HOME/state/dsh-notice-webhook/`。不存在对 DSH 会话数据的写入，因此**回滚不可能损坏会话**。

## 孤儿绑定 `serves: FR-6, FR-9`

| 情况 | 行为 | 理由 |
|---|---|---|
| 绑定表里的 `sessionId` 已不在任何会话列表 | **保留**，`list()` 中可见 | 会话可能只是被归档/暂不可见；自动删会造成"绑定莫名消失" |
| 使用者想清理 | 调 `unbind(sessionId)` | 显式操作，可审计 |
| 文件无限增长 | 本期不治 | 每条记录 < 200 字节，量级到不了问题门槛（见 architecture.md 遗留问题） |
