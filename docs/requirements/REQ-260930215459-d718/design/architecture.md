---
title: 架构设计 · 通知设置页按原型重做并借鉴 dsh-im 图标
requirement_refs: [REQ-260930215459-d718]
updated: 2026-09-30
---

# 架构设计

> **TL;DR**：本需求把「URL 由用户拼」改成「URL 由 Host 按**渠道元数据**拼」——新增一层渠道元数据（前缀 + key 字段名 + 官方说明），
> 目标里只存 key；界面按原型重排并换品牌图标。改的是**输入形态与渲染**，出站报文与加签口径一字不动。

## 1. 组装点迁移（serves: FR-2, FR-6）

```
   现状（A 形态）                          本需求（B 形态，已裁定）
   ────────────────                        ──────────────────────
   用户在界面粘贴整条 URL                    用户在界面只填 key
        │                                        │
        ▼                                        ▼
   targets.json: { url }                    targets.json v2: { channel, key, secret?, url(派生) }
        │                                        │
        ▼                                        ▼
   channel.buildRequest(target)             channel.composeUrl(target) ──▶ 完整 URL
        │                                        │
        └──────────▶ 出站 HTTP ◀─────────────────┘
                  （报文与加签口径不变）
```

| 关注点 | 归谁 | 说明 |
|---|---|---|
| key 的**合法性** | 界面（即时校验：非空、无空格、长度上界） | 只做形状校验，不调平台接口 |
| URL 的**拼装** | Host（渠道适配器 `composeUrl`） | 界面不算 URL，避免两处实现分叉 |
| URL 的**派生落盘** | Host（保存时一并写入 `url`） | 为了回滚：旧版本读 v2 文件仍能拿到可投递的 url |
| 出站**报文与签名** | 渠道适配器（不变） | 硬边界，见 §5 |

## 2. 渠道元数据（serves: FR-2, FR-3）

新增 `src/channels/meta.js`：一处定义「每个渠道要用户填什么、填完拼成什么、去哪拿」。

| 渠道 | 用户填 | URL 前缀 | 是否加签 | 官方说明 |
|---|---|---|---|---|
| `wecom` | `key`（机器人 key） | `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=` | 否 | 企微群机器人配置步骤 |
| `dingtalk` | `key`（access_token）+ 可选 `secret` | `https://oapi.dingtalk.com/robot/send?access_token=` | 是（secret） | 钉钉自定义机器人配置步骤 |
| `feishu` | `key`（hook token）+ 可选 `secret` | `https://open.feishu.cn/open-apis/bot/v2/hook/` | 是（secret） | 飞书自定义机器人配置步骤 |
| `slack` | **完整 URL** | —（用户给全量） | 否 | Slack Incoming Webhook 步骤 |
| `discord` | **完整 URL** | —（用户给全量） | 否 | Discord Webhook 步骤 |
| `custom` | **完整 URL** + 自定义头 | —（用户给全量） | 否 | 通用说明（v1 契约） |

元数据形状（单点真相，界面与 Host 都读它）：

```js
// src/channels/meta.js
export const CHANNEL_META = {
  wecom: {
    label: '企业微信',
    input: 'key',                       // 'key' | 'url'
    keyLabel: '机器人 key',
    urlPrefix: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=',
    keyPattern: /^[A-Za-z0-9-]{8,64}$/,
    secret: false,
    help: { title: '怎么拿企微机器人 key', steps: [...], docUrl: 'https://developer.work.weixin.qq.com/…' },
  },
  // …dingtalk / feishu / slack / discord / custom
}
```

**说明浮层的归属**：文案（`help`）随元数据走，Host 经 RPC 投影给界面；界面只负责渲染成可展开面板，**不在前端硬编码步骤**。

## 3. 迁移与回滚（serves: FR-6）

```
读 targets.json
  ├─ version === 2 → 直接用（key + 派生 url）
  ├─ version === 1 → 逐条按前缀反解 key
  │     ├─ 命中前缀 → 升 v2（key 落库，url 重算一致）
  │     └─ 不命中（自定义渠道/用户手改过）→ 保留 url 直投，记 warn，不丢目标
  ├─ 未知版本 / 坏 JSON → 空清单且不覆盖原文件（沿用既有口径）
  └─ 写盘时机：任何一次成功写入即整表落 v2（含派生 url）
```

回滚路径：v2 文件**同时保留 `url`**，旧版本读它只取 `url` 即可继续投递 → 卸载/回滚不丢能力（AC-9）。

## 4. 客户端渲染（serves: FR-1, FR-4, FR-5）

| 关注点 | 做法 |
|---|---|
| 图标 | `client.js` 内联 SVG 常量表；五个品牌 glyph **逐字取自 dsh-im** `channel-logos.js`（品牌色保留），通用渠道用自己的中性图标 |
| rail 结构 | 三段：`全部目标` / `按渠道`（分组 + 数量徽标） / `默认组`（默认目标 + 「默认」徽标） |
| 表单 | 按 `meta.input` 决定渲染「只填 key」还是「填完整 URL」；key 输入框旁挂 `?` 说明按钮 |
| 说明浮层 | 点 `?` 就地展开（不跳页、不弹新窗）：步骤列表 + 官方文档链接 |
| 绑定页 | 表格列与会话/目标 chips 的对齐 `prototype.html` 帧 3，复用同一图标表 |

## 5. 不变量与边界（serves: FR-6）

| 不变量 | 为什么 |
|---|---|
| 出站报文形状、业务码判定、加签串算法一律不变 | 已验收的六渠道行为不能被 UI 需求带歪（回归靠既有渠道测试） |
| `bindings.json` 结构不变 | 绑定语义（替代默认组）与回滚安全已验收 |
| Host Service 方法签名与版本（v2）不变 | 其他插件在用；本需求不碰它 |
| `targets.json` 读容错三口径不变（空表/不覆盖/跳过坏条目） | 既有验收项 |
| RPC 的 revision 栅栏语义不变 | 多页面并发写保护 |
