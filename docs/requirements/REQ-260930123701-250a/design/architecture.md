---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11]
---

# 架构设计（REQ-260930123701-250a）

> 本份讲"怎么搭"：包形态、模块地图、关键流程、依赖、错误处理。
> 接口签名与 JSON 契约见 [interfaces.md](interfaces.md)；数据结构与持久化见 [data-model.md](data-model.md)；测试见 [test-cases.md](test-cases.md)。

## TL;DR `serves: FR-1, FR-4`

- **形态**：Host-only Cordis 插件包，无客户端半、无构建步骤、**零第三方依赖**（投递只用 Node 内置 `fetch`）。
- **主链路**：`session/event` → 分类 → 路由 → 异步 POST；失败只记日志，**绝不回灌会话**。
- **新增的持久状态只有一份**：`bindings.json`（会话窗口 → webhook 地址）。

## 目标与总体方案 `serves: FR-1, FR-2, FR-3, FR-11`

**问题**：DSH 的授权与提问是阻塞式的，人一离开浏览器就错过。反过来，goal 自动续轮又会把"系统自己唤醒"的轮次混进 `turn/end`——逐轮提醒等于噪音，使用者会直接关掉插件。

**当前状况**：[dsh-notice](https://github.com/Tenold-a/dsh-notice) 已经用 `ctx.on('session/event')` 把三个时刻映射成托盘气泡，事件口径经过验证，但出口是本机桌面，且没有"按会话窗口分流"的能力。

**设计方案**：沿用 dsh-notice 已验证的事件口径（顶层会话、跳过 interrupted/aborted、标题拼接），把出口换成 HTTP；在此之上加两层：

| 层 | 职责 | 服务的 FR |
|---|---|---|
| 分类层 | 判断"这条事件要不要发、发什么正文" | FR-1 / FR-2 / FR-3 / FR-5 / FR-11 |
| 路由层 | 判断"发到哪个地址"（绑定 > 默认 > 丢弃） | FR-6 / FR-7 |
| 投递层 | POST、超时、重试、脱敏日志 | FR-4 |

**不这么做的后果**：

- 不加 goal 过滤 → 看板 dive 模式跑 20 轮发 20 条，等于没通知；
- 不加路由层 → 多会话共用一条默认地址，"是哪个会话在等我"无从分辨；
- 把投递做成同步 → 接收端卡 10 秒就会拖住会话收尾，违反 FR-4。

## 模块改动地图 `serves: FR-1`

```
  session/event ──▶ classify.js ──▶ 意图 { event, message, goal? } | null(丢弃)
                        │                        │
                        │                        ▼
                        │                  router.js ◀── bindings.js ◀── service.js
                        │                  (绑定>默认)   (持久状态)      (ctx.provide)
                        │                        │                          ▲
                        │                        ▼                          │
                        └── goal.js        deliver.js ──POST──▶ webhook     │
                            (自动轮静默      (超时/重试/脱敏日志)             │
                             + 终态兜底)                                     │
                                                                   其他插件 inject
```

**改动清单**（全部为新增文件；本插件是新包，无存量改动）：

| 模块/文件 | 类型 | 改动内容 | 原因（serves 哪条 FR） | 影响范围 |
|---|---|---|---|---|
| `index.js` | 新增 | `apply(ctx, config)`，只做接线，无业务判定 | FR-1 | 插件激活入口 |
| `src/config.js` | 新增 | 默认值与入参规整、非法值告警 | FR-4 / FR-5 / FR-6 / FR-7 | 全链路读它 |
| `src/classify.js` | 新增 | 事件 → 通知意图；类型开关；顶层/中断/冷却过滤 | FR-1 / FR-2 / FR-3 / FR-5 | 主链路 |
| `src/goal.js` | 新增 | 自动轮识别（静默）+ 终态识别（补发） | FR-11 | 主链路 |
| `src/router.js` | 新增 | 地址解析：绑定 > 默认 > 丢弃；总开关旁路 | FR-6 / FR-7 | 主链路 |
| `src/deliver.js` | 新增 | POST JSON、超时、重试、脱敏日志 | FR-4 | 唯一出口 |
| `src/bindings.js` | 新增 | 绑定表 + 原子持久化 | FR-9 | 路由层数据源 |
| `src/service.js` | 新增 | `ctx.provide('dshNoticeWebhook', …)` | FR-8 / FR-10 | 其他插件 |
| `cordis.patch.yml` | 新增 | 装载行（`insert`） | FR-1 | profile 装载 |
| `test/*.test.js` | 新增 | `node:test` 单测 + 本地接收端联调 | 全部 | 质量 |

## 关键流程 `serves: FR-5, FR-6, FR-7, FR-11`

### 一次 `session/event` 的完整判定 `serves: FR-1, FR-5, FR-11`

```
session/event
      │
      ▼
  ┌─────────────────────────┐
  │ 是 goal 生命周期事件？  │──是──▶ 更新该会话 goal 状态
  └───────────┬─────────────┘        （记 phase / id / revision / maxGoalRounds）
              │否                              │
              ▼                                │ phase 变 complete/blocked？
  ┌─────────────────────────┐                  └──是──▶ 生成终态意图（FR-11）
  │ 是 user/message？       │──是──▶ 记录该会话"本轮是否含人工输入"
  └───────────┬─────────────┘        （source.kind === 'goal' 视为自动）
              │否
              ▼
  ┌─────────────────────────┐
  │ 是三类事件之一？        │──否──▶ 丢弃
  └───────────┬─────────────┘
              │是
              ▼
  ┌─────────────────────────┐
  │ 类型开关开着吗？        │──否──▶ 丢弃（内容级过滤，绑定也不豁免）
  └───────────┬─────────────┘
              │是
              ▼
  ┌─────────────────────────┐
  │ goal 自动轮？           │──是──▶ 丢弃（FR-11 静默）
  └───────────┬─────────────┘
              │否
              ▼
  ┌─────────────────────────┐
  │ 顶层会话 / 冷却通过？   │──否──▶ 丢弃
  └───────────┬─────────────┘
              │是
              ▼
         router.js ──▶ deliver.js（异步，不 await 回会话）
```

### 事件分类表 `serves: FR-1, FR-2, FR-3`

| 源事件 | 触发条件 | 产物 `event` | 正文 |
|---|---|---|---|
| `turn/end` | `reason.kind` 不在 `skipReasons` | `turn/end` | 有标题：`标题 · 会话已完成`；无标题：`会话已完成` |
| `approval/asked` | 总是 | `approval/asked` | `需要你允许执行操作（工具名）`；无工具名时不带括号 |
| `tool/call` | `data.name === 'ask_user_question'` | `ask_user_question` | `需要你回答一个问题` |
| `goal/change` | `phase` 变为 `complete` | `goal/complete` | `标题 · 目标已完成` |
| `goal/change` | `phase` 变为 `blocked`（`code === 'round-limit'`） | `goal/blocked` | `标题 · 目标轮次耗尽（N/N）`，N = `maxGoalRounds` |
| `goal/change` | `phase` 变为 `blocked`（其他 code） | `goal/blocked` | `标题 · 目标阻塞（code）` |
| 其他 | — | — | 丢弃（不产生请求） |

### goal 自动轮判定 `serves: FR-11`

判定口径（可证伪、不依赖模型自述）：

| 事实来源 | 取法 |
|---|---|
| 自动轮的标记 | `dsh-goal-round-driver` 注入的 user message 带 `source.kind === 'goal'`（含 `goalId` / `revision` / `round`） |
| 本轮是否人工参与 | 该 turn 内是否出现过**非 goal** 的 `user/message` |
| 结论 | turn 内全部 user message 都是 goal 注入 → 静默；只要有一条人工输入 → 照常推送 |

**为什么以"turn 内是否有人工输入"为准**：使用者在 goal 跑到一半用 `/steer` 插话，说明他就在旁边，这一轮应当被当成人工轮通知——否则会出现"人在旁边却收不到响应"的反直觉。

### 终态去重 `serves: FR-11`

| 场景 | 行为 |
|---|---|
| 同一 goal 多次进入 `blocked`（人 resume 后又耗尽） | `revision` 变化 → 视为新终态，**推一条**（合理：又卡了一次） |
| 同一 `(goalId, revision, phase)` 重复上报 | 只推一次（内存 Set 去重，进程内有效） |
| `paused` / 清除（clear） | **不推**（人的主动操作，不需要被通知） |

### 关键决策点 `serves: FR-4, FR-6, FR-11`

| 决策 | 选项 A | 选项 B | 选了哪个 | 为什么 |
|---|---|---|---|---|
| 投递时机 | 同步 await（拿得到结果） | 异步 fire-and-forget | **B** | 接收端不可控；同步会把网络延迟注入会话收尾（FR-4） |
| 重定向处理 | 跟随 3xx | `redirect: 'manual'`，3xx 视为失败 | **B** | 跟随重定向会把 `Authorization` 带到非预期主机 |
| goal 判定依据 | 读模型输出的自然语言 | 读 `source.kind` 结构化标记 | **B** | 自然语言判定不可证伪；结构化标记来自 driver 源码 |
| 绑定与总开关 | 总开关一关全停 | 总开关只管默认通道 | **B** | 使用者要"关掉公共群、留下关键会话"（FR-7） |

## 依赖关系 `serves: FR-4`

**新增依赖**：

| 依赖项 | 版本 | 用途 | 不引入的后果 |
|---|---|---|---|
| （无） | — | 投递用 Node 内置 `fetch`；测试用内置 `node:test` | 无 |

**删除依赖**：无（新包）。

**对 DSH 的依赖**（非包依赖，是运行时契约）：`session/event` 事件流需提供 `turn/end`、`approval/asked`、`tool/call`、`user/message`、`session/title`、`goal/change`。

## 错误处理 `serves: FR-4, FR-8`

| 错误码/异常 | 触发条件 | 使用者看到什么 | 如何恢复 |
|---|---|---|---|
| `deliver/network` | DNS 失败 / 连接被拒 / 超时 | 日志 warn（只记 host + 错误类名），会话**无异常** | 检查地址与网络；按需提高 `retry` |
| `deliver/http-status` | 接收端返回非 2xx | 日志 warn（记状态码） | 检查接收端 |
| `bindings/persist-failed` | 数据文件不可写 | 日志 warn；绑定**进程内仍生效** | 修权限；重启后该绑定丢失 |
| `bindings/corrupt` | 文件非法 JSON / 版本不认识 | 日志 warn；按空表启动 | 删除文件重建 |
| `bind/invalid-arg` | `sessionId` 空、`url` 非 http(s) | `bind()` 返回 `false`（不抛异常） | 调用方修正参数 |

**总原则**：本插件不得让任何通知失败演变成会话错误。所有外部调用都包在 try/catch 里，异常降级为一条日志。

## 安全与性能 `serves: FR-4`

**安全风险**：

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| webhook URL 含 token，被写进日志 | 凭据泄漏到日志文件 | 日志只输出 `new URL(url).host`；headers 永不入日志 |
| 恶意/错配 URL 造成 SSRF | 本机向内网发起请求 | 地址只能由 profile 配置或同进程插件注入（无外部输入面）；不做用户输入转发 |
| 跟随重定向泄漏鉴权头 | 凭据发往第三方 | `redirect: 'manual'`，3xx 视为失败 |
| 接收端慢导致请求堆积 | 内存增长 | `timeoutMs` 默认 5s；每次投递独立、不排队、不重试超限 |

**性能影响**：

| 指标 | 改前 | 改后 | 可接受吗 |
|---|---|---|---|
| `turn/end` 后的会话收尾 | 无额外开销 | 不 await 网络，仅 1 次 `queueMicrotask` 级开销 | 是 |
| 内存 | — | 每会话保留标题 + goal 状态（每项 < 200 字节） | 是 |
| 网络 | — | 每条通知 1 次 POST（可配重试） | 是，这正是功能本身 |

## 测试策略 `serves: FR-1`

| 场景 | 输入 | 预期输出 | 测试用例编号 |
|---|---|---|---|
| 三类事件各自推送 | 合成 `session/event` | 3 条意图，正文符合表 | TC-1 / TC-2 / TC-3 |
| 非目标事件不推送 | 普通 `tool/call` | 无请求 | TC-4 |
| 子代理 / 中断过滤 | `parentSession` 存在；`reason.kind='interrupted'` | 无请求 | TC-5 |
| 绑定优先级 | 绑定 + 默认同时存在 | 只发绑定地址 | TC-6 |
| 总开关旁路 | `enabled: false` + 已绑定 | 仍发绑定地址 | TC-7 |
| 分类开关不豁免 | `notifyApproval: false` + 已绑定 | 不发 | TC-8 |
| goal 自动轮静默 | 3 轮 goal | 0 条推送 | TC-9 |
| goal 终态补发 | `complete` / `round-limit` | 各 1 条 | TC-10 / TC-11 |
| 投递失败隔离 | 指向 `127.0.0.1:1` | 会话正常、日志 warn | TC-12 |
| 持久化往返 | 绑定 → 重启 → 解析 | 绑定仍生效 | TC-13 |

## 遗留问题 `serves: FR-9, FR-11`

| 问题 | 影响 | 计划何时解决 |
|---|---|---|
| 插件在 goal **已经 blocked 之后**才加载时，不会补发终态通知（只在状态**变化**时触发） | 冷启动窗口内漏一条 | 用户提出后再做：启动时扫一遍活动 goal 的当前 phase |
| 绑定表按 sessionId 存，孤儿记录不自动清理 | 文件缓慢增长 | 数据量可见时再做 GC（`unbind` 已可手工清理） |
| 未声明 `Config` schema，设置页看不到配置表单 | 只能改 `cordis.patch.yml` | 若出现真实表单诉求，再引入 schema（见 requirement.md 边界：本期不做管理 UI） |
