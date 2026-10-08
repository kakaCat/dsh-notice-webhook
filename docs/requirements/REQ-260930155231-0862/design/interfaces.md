---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-7, FR-8, FR-9, FR-10]
---

# 接口设计（REQ-260930155231-0862）

> 契约定死的地方：渠道报文、渠道适配器签名、Host RPC、Host Service、插件 Config。

## TL;DR `serves: FR-1`

- 渠道适配器 = 两个纯函数：`buildRequest` + `isSuccess`。
- 设置页 → Host：一份自带版本栅栏的 RPC（CRUD + 测试投递）。
- 其他插件 → Host：既有 `dshNoticeWebhook` **只增不减**。

## 渠道适配器契约 `serves: FR-1`

每个渠道模块导出同一形状（纯函数、无状态、无网络）：

```typescript
interface ChannelAdapter {
  /** 渠道 id，与目标记录的 channel 字段取值一致。 */
  readonly id: 'wecom' | 'feishu' | 'dingtalk' | 'slack' | 'discord' | 'custom'

  /**
   * 组装最终请求。
   * @returns 成功：{ url, headers, body }；失败：{ error }（不抛异常）
   */
  buildRequest(input: {
    target: TargetRecord
    /** 通知意图（已含正文与 goal 信息） */
    intent: { event: string; message: string; title: string | null; toolName: string | null; goal: unknown }
    /** 会话上下文（custom 渠道的 v1 契约要用） */
    session: { id: string | null; workspace: string | null }
    /** 取 secret 的函数（由 Host 注入，渠道不接触存储） */
    secret: (ref: string) => string | undefined
    /** 当前时间（单测注入） */
    now: number
  }): { url: string; headers: Record<string, string>; body: string } | { error: string }

  /**
   * 判定业务成功。
   * @param status HTTP 状态码
   * @param parsed 已解析的响应体（解析失败时为 undefined）
   */
  isSuccess(status: number, parsed: unknown): { ok: boolean; reason?: string }
}
```

**取值与必填**：

| 渠道 | `channel` 取值 | 必需字段 | 可选字段 |
|---|---|---|---|
| 企业微信机器人 | `wecom` | `url` | — |
| 飞书自定义机器人 | `feishu` | `url` | `secretRef`（加签） |
| 钉钉机器人 | `dingtalk` | `url` | `secretRef`（加签） |
| Slack | `slack` | `url` | — |
| Discord | `discord` | `url` | — |
| 通用自定义 | `custom` | `url` | `headers` |

## 渠道报文契约 `serves: FR-1`

| 渠道 | 方法/头 | 请求体 | 成功判定 |
|---|---|---|---|
| 企业微信机器人 | `POST`，`application/json` | `{"msgtype":"markdown","markdown":{"content":"<正文>"}}` | `2xx && errcode === 0` |
| 飞书自定义机器人 | `POST`，`application/json` | `{"msg_type":"text","content":{"text":"<正文>"}}` | `2xx && (code === undefined \|\| code === 0)` |
| 钉钉机器人 | `POST`，`application/json` | `{"msgtype":"markdown","markdown":{"title":"<标题>","text":"<正文>"}}` | `2xx && errcode === 0` |
| Slack | `POST`，`application/json` | `{"text":"<正文>"}` | `2xx` |
| Discord | `POST`，`application/json` | `{"content":"<正文>"}` | `2xx`（含 204） |
| 通用自定义 | `POST`，`application/json` + `target.headers` | **既有 v1 契约原样 JSON**：`version/event/message/title/toolName/goal/sessionId/workspace/at/source` | `2xx` |

**加签口径**：

| 渠道 | 算法 | 参数位置 |
|---|---|---|
| 钉钉 | `sign = base64(hmacSHA256(secret, `${timestamp}\n${secret}`))` | 追加到 URL query：`&timestamp=…&sign=…` |
| 飞书 | `sign = base64(hmacSHA256(`${timestamp}\n${secret}`, ''))` | 请求体顶层：`{"timestamp":"…","sign":"…"}` |

`secretRef` 为空时**不加签**（视为该机器人未开启加签）。

## Host RPC（设置页 → Host）`serves: FR-2, FR-8, FR-10`

设置页只能通过 RPC 读写；RPC 继承 Host 既有认证与信任域（不新开鉴权面）。

| 端点 | 入参 | 返回 | 错误语义 |
|---|---|---|---|
| `GET /api/dsh-notice-webhook/state` | — | `{ revision, targets: TargetView[], bindings: BindingView[], defaults: { enabled, timeoutMs, retry, cooldownMs }, outcomes: Record<targetId, Outcome[]>, secrets: Record<secretRef, boolean> }` | 不可达 → 客户端显示错误态 |
| `POST /api/dsh-notice-webhook/targets` | `{ revision, target }` | `{ ok: true, revision, targets }` | `409` 版本不符；`400` 校验失败（含原因） |
| `POST /api/dsh-notice-webhook/targets/delete` | `{ revision, id }` | `{ ok: true, revision, targets }` | `409` / `404` |
| `POST /api/dsh-notice-webhook/test` | `{ id }` | `{ ok, status?, reason? }` | 不改变清单；投递一条固定测试通知 |
| `POST /api/dsh-notice-webhook/bind` | `{ revision, sessionId, targetIds }` | `{ ok: true, revision }` | `400` 目标不存在（整笔不生效） |
| `POST /api/dsh-notice-webhook/bindings/delete` | `{ revision, sessionId }` | `{ ok: true, revision, bindings }` | `409` 版本不符；`404` 该会话本无绑定 |

**`BindingView`**（对客户端的投影）：`{ sessionId, sessionTitle: string | null, targetIds: string[], updatedAt: string, targets: Array<{ id, name, channel, enabled }> }`——`targets` 是展开后的当前状态，便于页面直接渲染"会话 → 哪些目标（含已停用标记）"，不必客户端再 JOIN。

**`TargetView`**（对客户端的投影）：目标记录去掉任何密钥值，`secretRef` 只给"是否存在"标记。

**`revision` 栅栏**：每次写返回新 `revision`；客户端提交过旧 revision → `409` 并返回最新状态（防两个页面互相覆盖）。

## Host Service（其他插件 → Host）`serves: FR-5, FR-9`

服务名不变：`dshNoticeWebhook`，`version` 提升为 `2`（新增能力），**旧方法一个不删**。

```typescript
interface DshNoticeWebhook {
  /** 接口版本：2（新增多目标能力；旧字段语义不变）。 */
  readonly version: 2

  /* ── 旧签名（FR-9：必须继续可用，行为不变） ── */
  bind(sessionId: string, url: string): boolean
  unbind(sessionId: string): boolean
  list(): Array<{ sessionId: string; url: string; updatedAt: string }>
  resolve(sessionId: string): { url: string; source: 'binding' | 'default' } | null

  /* ── 新增 ── */
  /**
   * 把窗口绑定到若干目标 id。
   * **语义：绑定即替代默认组（不叠加）**——被绑定的窗口只发这些目标，不再发默认组。
   * @returns false = 任一 id 不存在（整笔不生效，不做部分绑定）
   */
  bindTargets(sessionId: string, targetIds: readonly string[]): boolean

  /**
   * 解绑（三方解除专用，与 bindTargets(sid, []) 等价但语义更直白）。
   * 解绑后该窗口**回落默认组**。
   * @returns 是否真的删掉了一条既有多目标绑定
   */
  unbindTargets(sessionId: string): boolean

  /** 全部窗口绑定（供宿主做"这个会话绑了谁"的展示/排查）。 */
  listBindings(): Array<{ sessionId: string; targetIds: string[]; updatedAt: string }>

  /** 该会话将投递的全部目标（已按类开关/总开关/目标过滤算完）。 */
  resolveAll(sessionId: string, intent: { event: string }): Array<{ id: string; name: string; channel: string; url: string }>

  /** 目标清单（不含密钥明文；secretRef 只回是否已配置）。 */
  listTargets(): Array<Omit<TargetRecord, 'secretRef'> & { secretRef: string | null; secretConfigured: boolean }>
}
```

**绑定语义（三方最常问的一条，单独说清）**：

| 问题 | 答案 |
|---|---|
| 绑定了还发默认组吗？ | **不发**。绑定是**替代**不是叠加——否则同一条通知会被发两遍到同一个群 |
| 只绑 1 个目标呢？ | 也只发那 1 个，默认组不参与 |
| 解绑后呢？ | 立刻**回落默认组**（`unbindTargets` 或 `bindTargets(sid, [])`，两者等价） |
| 目标被删/停用呢？ | 该目标从集合里消失；若因此集合为空 → 视为未绑定 → 回落默认组（不报错） |
| 旧的 `unbind(sessionId)` 呢？ | 保留：清掉**旧版 url 绑定**；若该窗口还有多目标绑定，需用 `unbindTargets` 一并清（设计上 `unbind` 优先清多目标，再清 url 绑定，保证"解绑"符合直觉） |

**版本兼容**：消费方按 `version >= 2` 判断是否可用新方法；`version === 1` 的旧消费方（写死等 1 的）需要放宽为 `>= 1`——这正是为什么提升版本号而不是静默加方法：让旧消费方的假设显式暴露。

## 客户端服务（供其他插件的界面复用）`serves: FR-5, FR-2`

**为什么要这个服务**：pmboard 这类宿主自己就能查目标清单（`listTargets()`），但"选哪个 webhook"的界面不该每个宿主各写一套——重复实现必然导致语义分叉（选中态、默认组含义、凭据脱敏、"没目标时怎么办"）。所以由本插件的**客户端半**提供可嵌入的**选择器**，弹框外壳仍归宿主。

### 服务定义 `serves: FR-5`

```typescript
/** 由本插件客户端半以 ctx.provide('dshNoticeWebhookClient', …) 注册。 */
interface DshNoticeWebhookClient {
  /** 接口版本，当前 1；消费方必须先校验 === 1。 */
  readonly version: 1

  /**
   * 渲染"选择目标"控件。
   * - 每次调用返回**新的** React element；不挂载 DOM、不开弹框、不动宿主任何 UI；
   * - 弹框/抽屉的开关、标题、确认与取消按钮由**宿主**负责；
   * - 服务失效时返回 null（消费方据此隐藏入口）。
   */
  renderTargetPicker(props: {
    /** 绑定对象；仅用于展示"会话 X"与默认选中，不传则纯选择 */
    sessionId?: string
    /** 当前已绑定的目标 id（复选框初始态） */
    selected?: readonly string[]
    /** 用户点确定时回调：已去重；空数组 = 解绑全部（回落默认组） */
    onConfirm: (targetIds: readonly string[]) => void
    /** 可选：宿主在取消时清理用 */
    onCancel?: () => void
    /** 只读模式：展示当前绑定但不允许改 */
    readOnly?: boolean
  }): unknown | null
}
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|---|---|---|---|---|
| `sessionId` | string | 否 | 仅用于展示与默认选中 | 无 |
| `selected` | string[] | 否 | 初始勾选的目标 id | `[]` |
| `onConfirm` | function | 是 | 确定回调；空数组 = 解绑全部 | 无 |
| `onCancel` | function | 否 | 取消回调（宿主清理用） | 无 |
| `readOnly` | boolean | 否 | 只读展示 | `false` |

### 渲染语义与生命周期 `serves: FR-5, FR-8`

| 语义 | 约定（与 dsh-im 的 `dshImClient` 同口径，避免各插件各理解） |
|---|---|
| 返回新 element | 每次调用都返回**新的** element；宿主**不得**缓存首次返回值 |
| 不挂载 DOM | 我们只返回 element；挂在哪、何时挂由宿主决定 |
| React 实例 | 用宿主（同一客户端）的 React；**不另打包 React** |
| 数据新鲜度 | 控件自己经 RPC 拉 `GET /state`——与设置页同一份数据，不缓存两份 |
| 服务失效 | 本插件卸载后：`renderTargetPicker()` 返回 `null` |
| 失败可见 | RPC 不可达时控件内显示错误态 + 重试，**不渲染成空清单** |

### 降级与错误语义 `serves: FR-5`

| 情况 | 行为 |
|---|---|
| 本插件未安装 / 已卸载 | 宿主 `ctx.dshNoticeWebhookClient` 为 `undefined`，或 `renderTargetPicker()` 返回 `null` → 宿主隐藏"绑定"入口 |
| `version !== 1` | 宿主不得调用（自行降级，不猜语义） |
| 目标清单为空 | 控件显示引导「还没有 webhook 目标，先去设置里加一个」，不显示空白 |
| 用户清空后确定 | `onConfirm([])` → 宿主调 `bindTargets(sessionId, [])`：解绑全部，回落默认组 |
| 目标在别处被删 | 控件按最新 `GET /state` 渲染，已消失的目标自然不再出现 |

**使用示例**（宿主插件，例如看板）：

```typescript
export const inject = ['dshNoticeWebhookClient']   // 可选依赖：缺失时静默降级

export function apply(ctx) {
  const picker = ctx.dshNoticeWebhookClient
  if (picker === undefined || picker.version !== 1) return   // 不显示绑定入口
  // 宿主在自己的弹框里挂 picker.renderTargetPicker({ sessionId, selected, onConfirm })
}
```

## 插件 Config `serves: FR-8, FR-9`

只放**全局**字段；目标清单不进 Config（见 architecture.md「遗留问题」与数据契约）。

```typescript
export const Config = z.object({
  /** 总开关：只管默认目标组（FR-6）。 */
  enabled: z.boolean().default(true).volatile(),
  /** 老配置的默认地址：映射为一条 custom 默认目标（FR-9）。 */
  webhookUrl: z.string().default(''),
  /** 投递参数。 */
  timeoutMs: z.number().default(5000).volatile(),
  retry: z.number().default(0).volatile(),
  cooldownMs: z.number().default(0).volatile(),
  /** 三类通知开关（内容级过滤）。 */
  notifyComplete: z.boolean().default(true).volatile(),
  notifyApproval: z.boolean().default(true).volatile(),
  notifyQuestion: z.boolean().default(true).volatile(),
  /** 正文文案与过滤参数（沿用既有）。 */
  completeMessage: z.string().default('会话已完成'),
  approvalMessage: z.string().default('需要你允许执行操作'),
  questionMessage: z.string().default('需要你回答一个问题'),
  onlyTopLevel: z.boolean().default(true).volatile(),
  skipReasons: z.array(z.string()).default(['interrupted', 'aborted']),
  includeTitle: z.boolean().default(true).volatile(),
})
```

**为什么有的字段标 `.volatile()`**：`dsh-settings` 的表单只投影"最近 volatile 祖先"下的字段；不标的字段改不了（要重挂载）。标了即"可在不重挂载的情况下改"。
**为什么目标清单不进 Config**：它是**运行时集合**（频繁增删），写进 profile patch 会让 YAML 膨胀且难以并发编辑；且 shipped client 不会从 schema 自动生成页面。
