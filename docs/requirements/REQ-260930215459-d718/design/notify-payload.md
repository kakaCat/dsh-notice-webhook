---
title: 通知报文与飞书卡片设计
requirement_refs: [REQ-260930215459-d718]
updated: 2026-09-30
---

# 通知报文与飞书卡片设计

> **TL;DR**：把「一行文案」的通知升级成**带上下文的报文**（谁的会话 / 在哪 / 说了什么 / 怎么结束 / 什么时候），
> 每一项都可在插件 config 里**开关与调参**；**飞书**改为发**交互式卡片**并带一枚「打开 DSH」跳转按钮。
> 只做出站：**不做回调、不做在聊天里审批/回答**（自定义机器人不支持回调，需自建应用 + 公网地址，本轮不做）。

## 0. 报文长什么样（目标形态）（serves: FR-7, FR-9）

```
┌─ 飞书：interactive 卡片 ─────────────────────────────┐
│ ✅ 对话完成                              [绿]        │   ← 标题 = 事件名 + 颜色
│ ─────────────────────────────────────────────────── │
│ 会话    通知设置页按原型重做（#c9f1a2）              │   ← 分栏字段
│ 工作区  dsh-notice-webhook                           │
│ 任务    把弹框的字段都改成一行，60 字内放到输入框里… │
│ 时间    09-30 14:32                                  │
│ ─────────────────────────────────────────────────── │
│           [ 打开 DSH ]  →  dsh://open                │   ← 跳转按钮（唯一交互）
└──────────────────────────────────────────────────────┘
```

其余五个渠道本轮**保持既有 markdown 形状**，只是文本里同样带上这些行（纯文本拼接）。

## 1. 报文字段与来源（serves: FR-7）

| 字段 | 取自 | 缺失时 |
|---|---|---|
| 事件 | intent.event（`turn/end` / `ask_user_question` / `approval/asked` / `goal/*`） | 必有 |
| 时间 | 投递时刻（本地时区） | 必有 |
| 会话标题 | 标题注册表 `classifier.titleOf(session)` | 省略该行 |
| 会话短 id | `session.header.id` 后 6 位 | 省略该行 |
| 工作区 | `session.header.cwd` | 省略该行 |
| 任务（摘要） | 本轮最后一条**非 goal 注入**的 `user/message` 的 `event.data.message.content` | 省略该行 |
| 详情 | 按事件：问题文本 / 工具名 / 目标描述 + 状态 + 轮次 | 省略该行 |
| 链接 | `dsh://open`（可配置模板） | 省略该行 |

```
session/event ──▶ 会话级跟踪器（记：本轮最后一条人工 user/message）
                        │
turn/end 等事件 ──▶ 意图(intent) ──▶ 报文装配(context) ──▶ 渠道适配器 ──▶ 平台
                                          ▲
                              配置(payload.*) 决定要哪些行
```

## 2. 配置模式（serves: FR-8）

```yaml
dsh-notice-webhook:
  payload:
    fields: [event, time, session, workspace, prompt, detail, link]  # 要哪几行、按此顺序
    promptChars: 60      # 「你说」摘要长度；0 = 不带
    workspaceStyle: basename   # basename | full
    timeFormat: 'YYYY-MM-DD HH:mm'  # 本地时间格式（默认带年月日）
    linkUrl: 'dsh://open'      # 跳转目标（模板，可含 {session} / {workspace} 占位符）
    template: ''         # 非空则整段覆盖默认拼装，支持 {event} {session} {id} {workspace} {prompt} {detail} {time} {link}
```

**默认值即 FR-7 的全量形态**：不配置时与配置齐全时输出一致（避免"默认残缺"）。

## 3. 飞书卡片（serves: FR-9）

报文由 markdown 换成 `interactive` 卡片；**成功判定与加签算法不变**（仍看 `code === 0`，仍按既有规则签名）。

```jsonc
{
  "msg_type": "interactive",
  "card": {
    "config": { "wide_screen_mode": true },
    "header": { "template": "green", "title": { "tag": "plain_text", "content": "✅ 对话完成" } },
    "elements": [
      { "tag": "div", "fields": [
        { "is_short": false, "text": { "tag": "lark_md", "content": "**会话** 通知设置页按原型重做（#c9f1a2）" } },
        { "is_short": false, "text": { "tag": "lark_md", "content": "**你说** 把弹框的字段都改成一行…" } }
      ] },
      { "tag": "action", "actions": [
        { "tag": "button", "text": { "tag": "plain_text", "content": "打开 DSH" }, "type": "primary", "url": "dsh://open" }
      ] }
    ]
  }
}
```

| 事件 | 标题色 |
|---|---|
| 对话完成 | green |
| 等待回答 / 等待授权 | orange |
| 目标终态 · 完成 | green |
| 目标终态 · 阻塞 / 轮次耗尽 | red |

**不做**（写进边界，避免误期待）：卡片按钮**只跳转**，不回调；「在聊天里批准/回答」需自建应用 + 公网可达地址，本轮不做。

## 4. 兼容与回滚（serves: FR-9）

| 场景 | 行为 |
|---|---|
| 未配置 `payload` | 走默认全量字段（= FR-7 形态） |
| 只想保留旧观感 | `payload.fields: [event]` + 飞书仍会发卡片（形状变化不可关） |
| 回滚到旧版本插件 | 目标数据格式未变（v2 不变）；飞书收不到卡片，回到 markdown |

**硬边界**：其余五渠道报文一字不动；加签算法、业务码判定、bindings、Host Service 签名均不变。

## 4.5 范围变更（2026-10-01 用户裁定，serves: FR-8, FR-9）

| 变更 | 原因 | 落地 |
|---|---|---|
| **删除「全局文案」页与其存储** | 「每个渠道支持的不一样，全局没必要」——飞书是卡片+标签、企微/钉钉是 markdown、Slack/Discord 又是另一套，一套全局配置不可能同时对五种渠道正确 | 配置**只落在目标上**（一个目标 = 一个渠道）；`targets.json` 顶层 `payload` 字段与 `POST /payload` 端点删除；投递优先级降为**两级**：`目标自己的文案 ?? 插件配置里的默认` |
| 飞书卡片按钮**仅 http(s) 才生成** | 飞书卡片按钮不跟随自定义 scheme，`dsh://open` 点了没反应 | `dsh://` 时省略按钮（不留死按钮）；将来换成 https 中转页按钮自动回来 |
| 会话 id 用**飞书文本标签** | 纯文本 `（#id）` 在卡片里不显眼 | `**会话** x <text_tag color='blue'>#id</text_tag>` |
| 正文新增**「类型」**行 | 用户要求能直接看到事件类型 | 卡片与文本渠道都加；可在目标内文案里关掉 |
| **弹框类提问**改从 `ctx` 的 waterfall 事件旁听 | `user-questions/request` 是 **ctx 事件、不在 session/event 流**，只订阅会话事件**收不到插件弹框** | 根 ctx 订阅该 waterfall，旁听后**必须 `next()` 放行**，失败兜住不影响提问 |

## 5. 测试口径（serves: FR-7, FR-8, FR-9）

| 用例 | 断言 |
|---|---|
| `test/payload.test.js` | 字段开关/顺序、摘要截断与跳过 goal 轮、workspaceStyle、timeFormat、模板占位符、缺字段降级 |
| `test/channels.feishu.test.js` | 报文是 `interactive` 卡片；标题色按事件；分栏字段含会话/摘要；按钮 `url === 'dsh://open'`；`code===0` 判定不变 |
| 既有五渠道用例 | **一字未改**（本次只动飞书） |
