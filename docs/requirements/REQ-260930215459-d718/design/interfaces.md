---
title: 接口设计 · 通知设置页按原型重做并借鉴 dsh-im 图标
requirement_refs: [REQ-260930215459-d718]
updated: 2026-09-30
---

# 接口设计

> **TL;DR**：新增两个纯函数接口（`composeUrl` / `parseKey`）与一张渠道元数据表；
> RPC 只做**追加式**变化（多收 `key`、多回 `help`）；客户端新增图标表与说明浮层两个组件面。
> 出站报文接口**不在本次改动范围**。

## 1. 渠道元数据（单点真相）（serves: FR-2, FR-3）

```js
// src/channels/meta.js —— 界面与 Host 都读这里，禁止各自硬编码前缀
export const CHANNEL_META = {
  wecom: {
    label: '企业微信',              // rail 与渠道选择器显示名
    input: 'key',                   // 'key' = 只填 key；'url' = 填完整地址
    keyLabel: '机器人 key',         // 输入框 label
    urlPrefix: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=',
    keyPattern: /^[A-Za-z0-9-]{8,64}$/,
    secret: false,                  // 是否需要加签密钥
    help: {
      title: '怎么拿企微机器人 key',
      steps: ['在企微群里点「…」→ 群机器人 → 添加', '复制 Webhook 地址里 key= 之后的部分', '粘贴到左侧输入框并保存'],
      docUrl: 'https://developer.work.weixin.qq.com/document/path/91770',
    },
  },
  dingtalk: { label: '钉钉', input: 'key', keyLabel: 'access_token', urlPrefix: 'https://oapi.dingtalk.com/robot/send?access_token=', keyPattern: /^[A-Za-z0-9]{16,80}$/, secret: true, help: { /* … */ } },
  feishu:   { label: '飞书', input: 'key', keyLabel: 'hook token', urlPrefix: 'https://open.feishu.cn/open-apis/bot/v2/hook/', keyPattern: /^[A-Za-z0-9-]{16,80}$/, secret: true, help: { /* … */ } },
  slack:    { label: 'Slack', input: 'url', secret: false, help: { /* … */ } },
  discord:  { label: 'Discord', input: 'url', secret: false, help: { /* … */ } },
  custom:   { label: '通用自定义', input: 'url', secret: false, help: { /* … */ } },
}
```

| 约定 | 说明 |
|---|---|
| `input: 'key'` | 界面只渲染一个 key 输入框（+ 可选 secret）；不算 URL |
| `input: 'url'` | 界面渲染完整地址输入框（行为同现状） |
| `help` | 随元数据走，经 RPC 投影给界面；**界面不硬编码步骤文案** |
| `keyPattern` | Host 侧权威校验用；界面用同一份做即时反馈 |

## 2. 渠道适配器扩展（serves: FR-2, FR-6）

在既有适配器契约上**只加两个纯函数**，出站接口（`buildRequest` / `isSuccess`）签名与行为不变：

```js
/** 由元数据 + key 拼出完整地址；input==='url' 的渠道直接返回 target.url */
export function composeUrl(target) → string

/** 从完整地址反解 key；反解不出返回 undefined（不抛异常） */
export function parseKey(url) → string | undefined
```

| 契约点 | 规定 |
|---|---|
| 纯函数 | 无状态、无网络、不读环境；同输入同输出 |
| 不抛异常 | 反解失败返回 `undefined`，由调用方决定"保留 url 直投" |
| 幂等 | `composeUrl({channel, key})` 与 `parseKey(composeUrl(...))` 互为逆（除大小写不变的前缀） |
| 不与报文耦合 | 拼 URL 不改报文；报文仍由 `buildRequest(target, input)` 产出 |

## 3. RPC 变化（追加式）（serves: FR-2）

**读**：`GET /state` 的 `targets[]` 增两个字段、`help` 随每渠道给一份：

```json
{
  "revision": 7,
  "targets": [{
    "id": "企微-项目群-a1b2", "name": "项目群-企微", "channel": "wecom",
    "key": "693a91f6-…", "secretRef": "DINGTALK_SECRET", "secretConfigured": true,
    "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-…",
    "enabled": true, "events": ["turn/end"], "isDefault": true
  }],
  "channelMeta": {
    "wecom": { "label": "企业微信", "input": "key", "keyLabel": "机器人 key", "secret": false,
               "help": { "title": "怎么拿企微机器人 key", "steps": ["…"], "docUrl": "https://…" } }
  }
}
```

**写**：`POST /targets` 的 `target` 体增 `key`：

```json
{ "revision": 7, "target": { "name": "项目群-企微", "channel": "wecom",
  "key": "693a91f6-…", "enabled": true, "events": ["turn/end"], "isDefault": true } }
```

| 情况 | 返回 |
|---|---|
| key 形状不合法 | `400 { ok:false, errors:["机器人 key 格式不对…"] }`，**不落盘**，revision 不动 |
| key 合法 | `200 { ok:true, revision+1, targets:[…], channelMeta:{…} }` |
| revision 过期 | `409` + 最新状态（语义不变） |
| 同传 key 与 url 且不一致 | 以 key 为准、`200`，日志记一条 warn（不把它变成 400，避免旧页面被打断） |
| `input:'url'` 渠道沿用旧体（只传 url） | `200`，行为同现状 |

## 4. 客户端组件面（serves: FR-1, FR-3, FR-4, FR-5）

```js
// 图标：五个品牌 glyph 逐字取自 dsh-im 的 channel-logos.js，通用渠道用自有中性图标
ChannelIcon({ channel, size }) → element        // 保留品牌色与 viewBox 24×24
// 左栏
ChannelRail({ targets, selectedKey, onSelect, onAdd, defaultIds }) → element
// 表单：按 channelMeta.input 决定渲染 key 还是 url
ConnectionField({ channel, key, url, onChange, meta }) → element
// 说明：点 ? 就地展开
HelpPopover({ help }) → element                  // 展开 steps + docUrl；不跳页
```

| 契约点 | 规定 |
|---|---|
| 图标来源可追溯 | 每个品牌 glyph 的注释标明取自 dsh-im 的文件与组件名（便于日后核对与署名） |
| 可嵌入选择器 | `renderTargetPicker` 复用 `ChannelIcon` 与元数据的 `label`，**契约（v1）与返回值不变** |
| 说明浮层 | 纯前端展开；`help` 缺失时隐藏入口（不渲染空面板） |
| 不新增 client 依赖 | 仍只 `require('react')`；图标是内联 SVG，不加图片与第三方包 |

## 5. 错误语义（serves: FR-2）

| 码 | 触发 | 界面表现 |
|---|---|---|
| `400` | key 形状不合法 / 缺 key / 渠道×字段交叉约束 | 行内错误（贴在对应输入框下），保留已填内容 |
| `409` | revision 过期 | 顶部提示"已被其他页面修改"并刷新，保留输入 |
| `404` | 目标不存在（删除/解绑） | 提示后刷新列表 |
| 网络失败 | fetch 抛错 | 行内错误 + 不改变本地状态（乐观更新回滚） |
