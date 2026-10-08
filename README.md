# dsh-notice-webhook

把 DeepSeek Harness 会话里**几个"该被叫一声"的时刻**推送到你自己的 webhook，并支持**在界面上管理推到哪里**。

| 场景 | 触发事件 | 推送正文 |
|---|---|---|
| 对话完成 | `turn/end`（`completed`） | 「标题 · 会话已完成」（无标题时只推「会话已完成」） |
| **会话异常中断** | `turn/error`（`error` / `interrupted` / 未知终态） | 「标题 · 会话异常中断（错误码）」 |
| 等待授权 | `approval/asked` | 「需要你允许执行操作（工具名）」 |
| 等待回答 | `ask_user_question` | 「需要你回答一个问题」 |
| 目标完成 | goal 进入 `complete` | 「标题 · 目标已完成」 |
| 目标卡住 | goal 进入 `blocked` | 「标题 · 目标轮次耗尽（N/N）」或「标题 · 目标阻塞（code）」 |

> **「对话完成」只在真的正常结束时才发**。agent 因模型流报错（如 `tool input is invalid JSON`）或崩溃中断而停下时，
> 推的是**「会话异常中断」**；`aborted`（你自己按的 Esc）与 `blocked` / `max-tokens` / `forked` 三种终态既不推送、
> 也**不会**被说成「已完成」。

**一句话看懂怎么用**：

```
设置 → 通知推送
 ┌──────────────┬────────────────────────────────────────────┐
 │ 企微-项目群   │  名称 [企微-项目群]     渠道 企业微信        │
 │ 我的手机      │  地址 [https://qyapi.weixin.qq.com/...]     │
 │ ───────────  │  关心事件 ☑完成 ☑授权 ☐提问 ☐目标终态      │
 │ 按渠道新建→  │  默认目标组 ☑（未绑定的会话发到这里）        │
 │               │  [保存] [发送测试] [停用]        [删除]      │
 └──────────────┴────────────────────────────────────────────┘
```

## 为什么需要它

DSH 的授权与提问是**阻塞式**的——你不点，任务就停在那里。而 DSH 只有浏览器界面，人一离开电脑就会错过。

反过来，看板 / dive 模式让 Agent 连续自动跑几十轮：**这些系统自己唤醒的轮次不该吵人**，只有目标真的跑完或卡住时才值得叫你。本插件默认就是这么做的。

**「谁在说话」判定（2026-10-02 口径收敛）**：只有 **direct human** 的输入才算人——
`user/message` 的 `source` 缺失、或 `source.kind` 缺失 / 为 `'user'`。
其余（`goal` 自动轮、`dive` 自动续跑、`plugin` 注入通知、以及将来新增的来源）**一律视为系统注入**：

| 情形 | 会不会推「对话完成」 | 「任务」字段 |
|---|---|---|
| 你发起的一轮 | 推 | 你输入的话 |
| 自动跑的一轮（goal / Dive 续跑 / 插件注入） | **不推**（整轮静默） | 空白（注入正文不会冒充你的要求） |
| 自动跑的一轮里你插了话 | 推 | 你插的那句话 |
| 自动跑的一轮里 agent 报错 / 崩溃 | **推「会话异常中断」**（静默只挡「完成」） | — |

## 支持的渠道

每个渠道有各自的报文格式与**业务错误码**判定（HTTP 200 不代表送达）：

| 渠道 | `channel` | 报文 | 成功判定 | 加签 |
|---|---|---|---|---|
| 企业微信机器人 | `wecom` | `{"msgtype":"markdown","markdown":{"content":…}}` | 2xx **且** `errcode === 0` | — |
| 飞书自定义机器人 | `feishu` | `{"msg_type":"text","content":{"text":…}}` | 2xx **且**（无 `code` 或 `code === 0`） | `secretRef` → `timestamp`+`sign` 进 body |
| 钉钉自定义机器人 | `dingtalk` | `{"msgtype":"markdown","markdown":{title,text}}` | 2xx **且** `errcode === 0` | `secretRef` → `timestamp`+`sign` 进 query |
| Slack Incoming Webhook | `slack` | `{"text":…}` | 2xx | — |
| Discord Webhook | `discord` | `{"content":…}` | 2xx（204 也算成功） | — |
| 通用自定义（原样 JSON） | `custom` | 见下面「推送契约」 | 2xx | — |

**加签密钥不回显**：页面与 RPC 只回"是否已配置"，密钥值只在 Host 侧由环境变量解析（`secretRef` 填环境变量名，如 `DINGTALK_SECRET`）。

### 只填 key：地址前缀内置

用户只需要把机器人的 **key / access_token / hook token** 粘进来，地址由插件按渠道前缀在 Host 侧拼好：

| 渠道 | 你填什么 | 插件拼出的地址 |
|---|---|---|
| 企业微信 | `key` | `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=` + key |
| 钉钉 | `access_token`（+ 可选加签密钥的环境变量名） | `https://oapi.dingtalk.com/robot/send?access_token=` + token |
| 飞书 | hook `token`（+ 可选加签密钥的环境变量名） | `https://open.feishu.cn/open-apis/bot/v2/hook/` + token |
| Slack / Discord / 通用自定义 | 完整地址 | —（用户给全量） |

每个渠道的字段旁都有一个 `?`：**点开就地展开「去哪建机器人、复制哪个字段、加签怎么开」**，
不用离开当前页面去翻官方文档（步骤随渠道元数据走，不是前端写死的）。

> 渠道图标（企微 / 飞书 / 钉钉 / Slack / Discord）**逐字取自
> [dsh-im](https://github.com/xmanrui/dsh-im) 的 `plugin-src/client/channel-logos.js`**（未改形状与配色）；
> 通用自定义用自有中性图标。来源与授权记录见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 安装

需要 `@deepseek-ai/schemastery`（声明插件 Config schema 用，已随包声明依赖）。本包**无构建步骤**：Host 半是 ESM，客户端半是手写的单文件 `client.js`。

```sh
dsh plugin --profile web add -w dsh-notice-webhook   # 从已发布包安装
```

或把本目录作为本地包装进 profile（开发用）：

```yaml
# profile 的 cordis.patch.yml
- insert:
    - id: dsh-notice-webhook
      name: dsh-notice-webhook
      config:
        webhookUrl: 'https://example.com/hook'   # 老配置照旧可用，会被映射成一条默认目标
```

装好后重启 Host（Host 半只在启动时加载；客户端半改完刷新页面即可）。

## 在界面上配置

打开 **设置 → 通知推送**（`settings.section` 插槽，`order: 21`）。页面有两个标签：

| 标签 | 能做什么 |
|---|---|
| **目标** | 左侧列出所有目标（按渠道带图标），右侧详情卡可改名称/地址/加签/自定义头/关心事件/是否默认组，并可保存、停用、删除、**发送测试** |
| **会话绑定** | 按会话列出"它绑到了哪些 webhook"，可解绑；目标被删的悬空引用会标红提示，解绑后该会话回落默认目标组 |

几个已经定死的语义（不是默认值，是行为）：

- **绑定是替代不是叠加**：会话绑定了目标 → **只发这些目标**，默认组不参与（否则同一条通知会发两遍到同一个群）；
- 绑定的目标被删或停用 → 视为未绑定，**回落默认组**，不报错；
- **总开关只管默认组**：关掉后，已绑定的会话照旧发送；
- **类型开关是内容级**：`notifyComplete` 等关掉后，命中绑定也不豁免；
- **同渠道 + 同地址去重**：配了两条一样的也只发一次；
- **关心事件留空 = 全收**；勾了之后只收勾中的（`goal/*` 覆盖 goal 的所有终态）；
- 多页面同时改配置：写入带 `revision` 栅栏，过期写入返回 409 并提示刷新（不会互相覆盖）。

## 配置项

`Config` 由插件入口导出（schemastery schema，Loader 激活时校验，`Config.listConfigs` 可查）。标 **volatile** 的字段改动**不需要重启**；其余改动走 Loader 正常生命周期。

| 配置项 | 类型 | 默认值 | volatile | 说明 |
|---|---|---|---|---|
| `enabled` | boolean | `true` | ✅ | **总开关，只管默认目标组**；已绑定的会话不受它影响 |
| `webhookUrl` | string | `""` | — | 老配置的默认地址：启动时映射为一条 `custom` 默认目标 |
| `webhookHeaders` | object | `{}` | — | 附加请求头（`custom` 目标用），鉴权用 |
| `timeoutMs` | number | `5000` | ✅ | 单次投递超时 |
| `retry` | number | `0` | ✅ | 失败重试次数（只对网络错误 / 5xx / 超时；4xx 不重试） |
| `cooldownMs` | number | `0` | ✅ | 同一会话两次推送的最小间隔 |
| `onlyTopLevel` | boolean | `true` | ✅ | 只提示顶层会话（跳过子代理 / fork） |
| `notifyComplete` | boolean | `true` | ✅ | 对话完成推送开关（内容级） |
| `notifyInterrupt` | boolean | `true` | ✅ | **会话异常中断**推送开关（关掉 = 中断静默；**不会**回落成「已完成」） |
| `notifyApproval` | boolean | `true` | ✅ | 等待授权推送开关 |
| `notifyQuestion` | boolean | `true` | ✅ | 等待回答推送开关 |
| `completeMessage` | string | `"会话已完成"` | — | 完成正文 |
| `interruptMessage` | string | `"会话异常中断"` | — | 中断正文骨架（后接 `（错误码）`；崩溃中断不带后缀） |
| `approvalMessage` | string | `"需要你允许执行操作"` | — | 授权正文 |
| `questionMessage` | string | `"需要你回答一个问题"` | — | 提问正文 |
| `goalCompleteMessage` | string | `"目标已完成"` | — | goal 完成正文 |
| `goalBlockedMessage` | string | `"目标阻塞"` | — | goal 阻塞正文（轮次耗尽时改用「目标轮次耗尽（N/N）」） |
| `includeTitle` | boolean | `true` | ✅ | 正文是否拼接会话标题 |
| `skipReasons` | string[] | `["aborted"]` | — | **静默名单**：命中的 `turn/end` 终态完全不推（优先于 `notifyInterrupt`）。把 `error` 写进来 = 中断也彻底安静；`aborted` 无论是否在名单里都静默 |
| `bindings` | object | `{}` | — | 配置期初始绑定 `{ sessionId: url }`（不覆盖运行时已有绑定） |

写错类型或数值越界不会让插件加载失败：一律回落到默认值并在 Host 日志留一条 warn（`normalizeConfig` 兜底，schema 只负责校验与表单投影）。

## 推送契约

### 通用自定义渠道（`custom`）—— 稳定契约

`POST` 到目标地址，`Content-Type: application/json; charset=utf-8`：

```json
{
  "version": 1,
  "event": "approval/asked",
  "message": "需要你允许执行操作（Bash）",
  "title": "修复登录 bug",
  "toolName": "Bash",
  "goal": null,
  "sessionId": "session-b7c52392-...",
  "workspace": "/Users/me/project",
  "at": "2026-09-30T04:37:01.901Z",
  "source": "dsh-notice-webhook"
}
```

- `event` 取值：`turn/end` / `turn/error` / `approval/asked` / `ask_user_question` / `goal/complete` / `goal/blocked`
- **中断事件专属字段**（只有 `turn/error` 带，其它事件的键集合一字不变）：

  ```json
  { "event": "turn/error", "reason": "error",
    "error": { "code": "MALFORMED_RESPONSE", "message": "DeepSeek Messages stream: tool input is invalid JSON" } }
  ```

  - `reason`：终态名（`error` / `interrupted` / DSH 未来新增的终态原文 / `unknown`）；
  - `error`：错误事实（`code` + 单行化且 ≤200 字符的 `message`）；`interrupted` 等无错误码的终态为 `null`。
- **接收端兼容性（如实告知）**：只认 `turn/end` 的老接收端**收不到**中断通知——请按 `turn/error` 分流，或忽略不认识的取值。
  新增取值与新增字段都是追加式的，`version` 保持 `1`。
- `goal` 仅在 goal 终态事件上非空：`{ id, phase, round }`
- 新增字段与新增 `event` 取值都是追加式的，`version` 保持 `1`；接收端请忽略不认识的字段与取值
- **不跟随重定向**（3xx 视为失败）；**日志只记 host**，不记 URL 里的 query 与 headers

其他五个渠道按上表各自的报文发送（平台要求什么就发什么），业务码判定结果与失败原因会进「最近投递」。

## 状态与存储

| 文件（`$DSH_HOME/state/dsh-notice-webhook/`） | 内容 |
|---|---|
| `targets.json` | 目标清单（`{version:1, targets:[…]}`），原子写（tmp → rename） |
| `bindings.json` | 会话绑定（`bindings` 老段 + `targetBindings` 新段），原子写 |

- 文件损坏 / 版本不认识 → **按空表启动且绝不覆盖原文件**（留人工抢救的余地）；
- 单条记录非法 → 只跳过该条，其余照常加载；
- 卸载 = 删掉这个目录即完全回滚（不碰任何会话数据）；
- **回滚安全**：新版本写入的 `targetBindings` 段只是**新增的顶层键**，旧版本读它时忽略未知键、不报错，`bindings` 老段也一直被维护；
- 投递结果只留在内存（每目标最近 5 条），重启清空。

### 老配置升级与回滚（`targets.json` v1 → v2）

本轮把「用户填整条 URL」改成「用户填 key、Host 组装」，数据模型随之升到 v2：

| 场景 | 行为 |
|---|---|
| 老文件（只有整条 `url`） | 按渠道前缀**反解出 key** 并升 v2；派生出的 `url` 与原值一致 |
| 反解不出（用户手改过地址 / 前缀不匹配） | 保留原 `url` **直投**并记 warn——**不丢目标、不猜 key** |
| 回滚到旧版本插件 | v2 文件里**同时保留了派生 `url`**，旧版本只读 `url` 照样投递 |
| 坏文件 / 未知版本 | 空清单且**不覆盖原文件**（沿用既有口径） |

## 给其他插件用（Host 半）：Service `dshNoticeWebhook`

```typescript
export const inject = ['dshNoticeWebhook']

export function apply(ctx) {
  const svc = ctx.dshNoticeWebhook
  if (svc === undefined || svc.version < 1) return        // 未安装 → 静默降级

  // v1 方法（语义不变，仍可用）：把该会话改道到一条地址
  svc.bind('session-b7c52392-...', 'https://example.com/project-hook')

  // v2 新增：绑定到多个**目标 id**（绑定即替代默认组，不叠加）
  svc.bindTargets('session-b7c52392-...', ['wecom-project', 'slack-phone'])
  svc.unbindTargets('session-b7c52392-...')               // 显式解绑 → 回落默认组

  svc.listBindings()                                      // 谁绑了谁（含展开的目标名/渠道）
  svc.listTargets()                                       // 目标清单（密钥只回"是否已配置"）
  svc.resolveAll('session-...', { event: 'turn/end' })    // 这条意图最终会发到哪些目标
}
```

- 版本：`version === 2`。旧消费方若写死等 `1`，请放宽为 `>= 1`（v1 四方法一个没删、行为不变）；
- 参数非法（空 `sessionId`、不存在的目标 id、非 http/https 地址）一律返回 `false`，**不抛异常**——调用方不会被别人的插件搞挂；
- `bindTargets` 里只要有一个 id 不存在就**整笔不生效**（不做部分绑定）。

## 给其他插件用（客户端半）：`dshNoticeWebhookClient`

宿主插件想在自己界面里让用户"选一个 webhook"，不用自己画列表——取客户端服务即可（**弹框由宿主拥有**，我们只给可嵌入的选择器）：

```javascript
// 宿主客户端插件里
const picker = ctx.get?.('dshNoticeWebhookClient')
if (picker?.version === 1) {
  const element = picker.renderTargetPicker({
    sessionId: 'session-b7c52392-...',   // 宿主自己知道绑定哪个会话
    selected: ['wecom-project'],         // 已选目标 id
    onConfirm: (targetIds) => { /* 调 Host Service bindTargets 落库 */ },
    onCancel: () => closeDialog(),
    // readOnly: true,                  // 只读展示
  })
  // element 是 React 元素；为 null 说明插件已卸载/不可用 → 宿主回落自己的界面
}
```

契约：

- `version === 1`；`renderTargetPicker(options) → React 元素 | null`；
- 每次调用返回**新元素**（不往宿主 DOM 里塞东西，不自己开弹框）；
- 服务在插件卸载后返回 `null`（宿主必须处理这个分支，别硬渲染）；
- 目标清单为空时，选择器内部显示引导文案（指向「设置 → 通知推送」），**不是白板**；
- 组件内部的读取失败在组件内展示（不把异常抛给宿主）。

## 验证：本地接收端

```sh
# 起一个只打印收到的 JSON 的接收端（Python 3 自带，无需安装依赖）
python3 - <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0))
        print(self.rfile.read(n).decode(), flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"errcode":0,"errmsg":"ok"}')   # 企微/钉钉渠道要这个业务码
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', 8899), H).serve_forever()
PY
```

把某个目标地址指到 `http://127.0.0.1:8899/hook`，点详情卡上的 **发送测试**，终端就会打印出对应渠道的报文。

失败隔离验证（接收端不可用时，会话必须照常完成，只留一条 warn）：

```sh
curl -sS -X POST http://127.0.0.1:1/ ; echo "exit=$?"
```

## 测试

```sh
npm test        # = node --test "test/*.test.js"
```

| 测试文件 | 覆盖 |
|---|---|
| `test/config.test.js` | Config schema：默认值与 DEFAULTS 一致、volatile 集合、越界回落 |
| `test/channels.cn.test.js` | 企微/飞书/钉钉报文、加签串、业务码判定（TC-1…TC-3、TC-6） |
| `test/channels.global.test.js` | Slack/Discord/custom 报文与 v1 契约（TC-4、TC-5） |
| `test/targets.test.js` | 目标清单 CRUD、字段交叉约束、坏文件不覆盖、落盘失败回滚 |
| `test/outcomes.test.js` | 投递结果保留最近 5 条、无明文 |
| `test/bindings.test.js` | v1 绑定表与原子持久化容错 |
| `test/bindings.v2.test.js` | `targetBindings` 段、空数组解绑、双清、回滚安全、老文件兼容 |
| `test/service.v2.test.js` | Service v2 方法、整笔不生效、解绑等价、展开不带密钥 |
| `test/rpc.read.test.js` | `GET /state` 状态投影与凭据脱敏 |
| `test/rpc.write.test.js` | 写入端点、revision 栅栏 409、校验 400 不落盘、404 语义 |
| `test/router.resolve.test.js` | 绑定替代默认组、失效回落、总开关旁路、类开关不豁免（TC-19） |
| `test/router.filter.test.js` | 逐目标事件过滤、`goal/*` 覆盖、去重、冷却（TC-9、TC-12） |
| `test/router.test.js` | v1 路由回归（绑定优先级、总开关、冷却） |
| `test/classify.test.js` | 三类事件翻译、顶层过滤、文案与开关 |
| `test/goal.auto.test.js` | goal 自动轮静默、人工插话放行 |
| `test/goal.terminal.test.js` | goal 终态推送与去重 |
| `test/deliver.test.js` | 投递契约：超时 / 重试 / 不跟随重定向 / 脱敏日志 |
| `test/client-service.test.js` | 客户端半（真实产物求值）：插槽注册、服务 v1、选择器返回值与卸载降级 |
| `test/e2e.multi.test.js` | 多目标端到端：五类事件、扇出隔离、业务码失败、legacy 兼容、绑定替代 |
| `test/e2e.local.test.js` | 单目标端到端 + 接收端不可达隔离 |
| `test/compat.test.js` | 旧数据降级、共存边界、回滚残留 |
| `test/compat.v2.test.js` | legacy 等价映射、同 url 只保留一条、坏文件、卸载无残留、零迁移 |

测试一律写到临时目录：**不会碰你的 `$DSH_HOME/state/dsh-notice-webhook/`**。

## 边界（本期不做）

- **不做双向通道**：webhook 回消息不会注入会话继续跑（需要接注入链路，属独立子系统）；
- **不做桌面托盘通知**：Windows 场景交给 [dsh-notice](https://github.com/Tenold-a/dsh-notice)；
- **页面内不改全局参数**（超时 / 重试 / 冷却 / 总开关）：它们在详情卡右侧只读展示，改动写在插件配置里（volatile 字段改完不需重启）。日志 / 历史投递不做持久化；
- **不做绑定管理的新建入口**：会话绑定页只做"看 + 解绑"，"绑哪个会话"的上下文属于宿主界面（用可嵌入选择器）；
- **不做消息聚合 / 静默时段 / 消息模板自定义**。

## 需求与设计文档

- REQ-260930123701-250a（基础推送 + 窗口绑定 + goal 终态）：
  [requirement.md](docs/requirements/REQ-260930123701-250a/requirement.md) ·
  [design/](docs/requirements/REQ-260930123701-250a/design) ·
  [decomposition.md](docs/requirements/REQ-260930123701-250a/decomposition.md)
- REQ-260930155231-0862（多渠道 + 界面配置 + 多目标绑定 + 可嵌入选择器）：
  [requirement.md](docs/requirements/REQ-260930155231-0862/requirement.md) ·
  [design/](docs/requirements/REQ-260930155231-0862/design) ·
  [decomposition.md](docs/requirements/REQ-260930155231-0862/decomposition.md) ·
  [原型 prototype.html](docs/requirements/REQ-260930155231-0862/design/prototype.html)
