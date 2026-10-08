---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-10, FR-11]
---

# 接口设计（REQ-260930123701-250a）

> 本份是**契约定死**的地方：出站请求体、Host Service 签名、配置项、错误语义。
> 契约定不死不许进拆分——下游实现与接收端都按这里写。

## TL;DR `serves: FR-4`

- 对外只有一个出站接口：`POST <绑定地址或默认地址>`，JSON 体，字段见下表。
- 对**其他插件**只有一个 Host Service：`dshNoticeWebhook` v1（`bind` / `unbind` / `list` / `resolve`）。
- 对**使用者**只有一个入口：`cordis.patch.yml` 的配置项。

## 出站 Webhook 契约 `serves: FR-1, FR-2, FR-3, FR-4, FR-11`

### 请求 `serves: FR-4`

| 项 | 值 |
|---|---|
| 方法 | `POST` |
| 地址 | 该会话的绑定地址，否则默认地址 |
| `Content-Type` | `application/json; charset=utf-8` |
| 自定义头 | `webhookHeaders` 原样带上（鉴权用，如 `Authorization`） |
| 超时 | `timeoutMs`（默认 5000ms），超时即放弃本次投递 |
| 重试 | `retry` 次（默认 0）；仅对网络错误与非 2xx 重试 |
| 重定向 | `redirect: 'manual'`；3xx 视为失败，不跟随 |

### 请求体字段 `serves: FR-1, FR-2, FR-3, FR-11`

| 字段 | 类型 | 必填 | 说明 | 默认值 |
|---|---|---|---|---|
| `version` | number | 是 | 契约版本，当前 `1`（追加式演进，见下） | `1` |
| `event` | string | 是 | `turn/end` / `approval/asked` / `ask_user_question` / `goal/complete` / `goal/blocked` | 无 |
| `message` | string | 是 | 给人看的正文（可直接当通知标题用） | 无 |
| `title` | string \| null | 是 | 会话标题；无标题为 `null` | `null` |
| `toolName` | string \| null | 是 | 授权事件的工具名；其他事件为 `null` | `null` |
| `goal` | object \| null | 是 | goal 终态事件：`{ id, phase, round }`；其他事件为 `null` | `null` |
| `sessionId` | string | 是 | 会话窗口标识（`session.header.id`） | 无 |
| `workspace` | string \| null | 否 | 会话工作目录（`session.header.cwd`，缺失为 `null`） | `null` |
| `at` | string | 是 | ISO-8601 时间戳 | 无 |
| `source` | string | 是 | 固定 `dsh-notice-webhook`，便于接收端识别来源 | `dsh-notice-webhook` |

### 请求体样例 `serves: FR-11`

```json
{
  "version": 1,
  "event": "goal/blocked",
  "message": "修复登录 bug · 目标轮次耗尽（20/20）",
  "title": "修复登录 bug",
  "toolName": null,
  "goal": { "id": "goal-7f3a", "phase": "blocked", "round": 20 },
  "sessionId": "session-b7c52392-9cdf-4162-b1c6-ed768346fbd2",
  "workspace": "/Users/mac/Documents/ai/dsh/dsh-notice-webhook",
  "at": "2026-09-30T04:37:01.901Z",
  "source": "dsh-notice-webhook"
}
```

### 响应与错误语义 `serves: FR-4`

| 接收端行为 | 本插件判定 | 后续 |
|---|---|---|
| 任意 2xx | 成功 | 结束 |
| 3xx | 失败（不跟随） | 按 `retry` 重试；仍失败记 warn |
| 4xx | 失败 | 同上（4xx 不重试**也**可接受，见下） |
| 5xx | 失败 | 按 `retry` 重试 |
| 连接失败 / 超时 | 失败 | 按 `retry` 重试 |

**实现约定**：重试只对"可能瞬时恢复"的失败（网络错误、5xx、超时）；4xx（地址错、鉴权错）**不重试**——重试不会让它变好，只会刷日志。

### 版本兼容 `serves: FR-4`

| 变更类型 | 是否升 `version` | 原因 |
|---|---|---|
| 追加可选字段 | 否 | 接收端应忽略不认识的字段；老接收端行为不变 |
| 追加新的 `event` 取值 | 否 | 接收端应按"未知取值 → 走默认分支"处理 |
| 改字段含义 / 删字段 / 改必填 | **是**（升到 2） | 破坏性变更，需要接收端同步 |

## Host Service 契约 `serves: FR-6, FR-8, FR-10`

### 服务定义 `serves: FR-8, FR-10`

**用途**：把"会话窗口 → webhook 地址"的绑定能力开放给同进程的其他 DSH 插件，避免每个插件各自监听一遍 `session/event`。

**调用方**：其他 Host 插件（在自身 `apply` 中 `inject: ['dshNoticeWebhook']`）。

**接口定义**：

```typescript
interface DshNoticeWebhook {
  /** 接口版本，不是软件版本。消费方必须先校验 === 1。 */
  readonly version: 1

  /** 绑定：该会话窗口的推送改走 url。返回 false = 参数非法被拒（不写绑定表）。 */
  bind(sessionId: string, url: string): boolean

  /** 解绑：返回是否真的删掉了一条绑定（不存在返回 false）。 */
  unbind(sessionId: string): boolean

  /** 列出全部绑定（按 sessionId 升序，便于人读与 diff）。 */
  list(): Array<{ sessionId: string; url: string; updatedAt: string }>

  /** 解析某会话将使用的目标；无绑定且无默认地址时返回 null。 */
  resolve(sessionId: string): { url: string; source: 'binding' | 'default' } | null
}
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|---|---|---|---|---|
| `sessionId` | string | 是 | 会话窗口标识，非空字符串 | 无 |
| `url` | string | 是 | `http://` 或 `https://` 开头的绝对地址 | 无 |

**返回值说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | `1` | 消费方校验用；不匹配就不调用 |
| `bind` 返回 | boolean | `true` = 已写入（含覆盖旧绑定）；`false` = 参数非法 |
| `unbind` 返回 | boolean | 是否删除了既有绑定 |
| `list()` 返回 | array | 每项 `sessionId` / `url` / `updatedAt`（ISO-8601） |
| `resolve()` 返回 | object \| null | `{ url, source }`；`source` 为 `binding` 或 `default` |

**异常情况**：

| 错误码 | 触发条件 | 返回内容 |
|---|---|---|
| （不抛异常） | `sessionId` 非字符串 / 空串 | `bind` 返回 `false` |
| （不抛异常） | `url` 非字符串 / 非 http(s) 绝对地址 | `bind` 返回 `false` |
| （不抛异常） | 持久化失败 | 仍返回 `true`（进程内生效），日志 warn |

**使用示例**（消费方插件）：

```typescript
export const inject = ['dshNoticeWebhook']

export function apply(ctx) {
  const svc = ctx.dshNoticeWebhook
  if (svc === undefined || svc.version !== 1) return   // 未安装 / 版本不符 → 静默降级

  // 把自己管理的会话窗口绑到自己的通道
  svc.bind('session-b7c52392-9cdf-4162-b1c6-ed768346fbd2', 'https://example.com/hook')

  // 排查用：确认某会话当前会打到哪
  ctx.logger.info(String(JSON.stringify(svc.resolve('session-...'))))
}
```

**降级语义**：本插件未安装或已卸载时，`ctx.dshNoticeWebhook` 为 `undefined`；消费方插件必须能在这种状态下正常加载（不得写成强依赖）。

## 配置项契约 `serves: FR-4, FR-5, FR-6, FR-7`

装载行与配置写在 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-notice-webhook
      name: dsh-notice-webhook
      config:
        webhookUrl: 'https://example.com/hook'
```

| 配置项 | 类型 | 默认值 | 作用 | 改了会怎样 |
|---|---|---|---|---|
| `enabled` | boolean | `true` | **总开关，只管默认通道** | 关掉后：未绑定窗口不推；**已绑定窗口照旧推**（FR-7） |
| `webhookUrl` | string | `""` | 默认地址 | 空 = 未绑定会话没有目标，静默丢弃 |
| `webhookHeaders` | object | `{}` | 附加请求头（鉴权） | 每次投递原样带上 |
| `timeoutMs` | number | `5000` | 单次投递超时 | 调小→更快放弃；调大→慢接收端也能收到 |
| `retry` | number | `0` | 失败重试次数 | 调大→瞬时故障更稳，但慢接收端会放大延迟 |
| `cooldownMs` | number | `0` | 同会话两次推送最小间隔 | 调大可抑制短时间连发 |
| `onlyTopLevel` | boolean | `true` | 只提示顶层会话 | 关掉后子代理完成也会推 |
| `notifyComplete` | boolean | `true` | 对话完成推送开关 | 关掉后该类一律不推（**绑定也不豁免**） |
| `notifyApproval` | boolean | `true` | 等待授权推送开关 | 同上 |
| `notifyQuestion` | boolean | `true` | 等待回答推送开关 | 同上 |
| `completeMessage` | string | `"会话已完成"` | 完成正文 | 自定义文案 |
| `approvalMessage` | string | `"需要你允许执行操作"` | 授权正文 | 自定义文案 |
| `questionMessage` | string | `"需要你回答一个问题"` | 提问正文 | 自定义文案 |
| `goalCompleteMessage` | string | `"目标已完成"` | goal 完成正文 | 自定义文案 |
| `goalBlockedMessage` | string | `"目标阻塞"` | goal 阻塞正文（`round-limit` 时改用「目标轮次耗尽」） | 自定义文案 |
| `includeTitle` | boolean | `true` | 正文是否拼会话标题 | 关掉后正文只有文案本身 |
| `skipReasons` | string[] | `["interrupted","aborted"]` | 视为"非完成"的 `turn/end` 原因 | 加入更多原因可进一步静音 |
| `bindings` | object | `{}` | 配置期初始绑定 `{ sessionId: url }` | 启动时灌入绑定表（不覆盖运行时已有的同 key 绑定，除非后者不存在） |

**取值规整**：类型不符或明显越界（`timeoutMs <= 0`、`retry < 0`）时，**回落到默认值并记一条 warn**——不静默接受坏配置，也不因配置错导致插件不加载。
