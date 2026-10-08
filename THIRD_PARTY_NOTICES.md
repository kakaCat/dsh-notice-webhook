---
title: 第三方来源与授权说明
slug: third-party-notices
updated: 2026-09-30
---

# 第三方来源与授权说明

> **TL;DR**：本插件唯一借用的第三方资源是**渠道品牌图标**（内联 SVG），逐字取自 dsh-im；
> 除此之外无第三方运行时代码依赖（除 `@deepseek-ai/schemastery` 用于声明插件 Config schema）。

## 1. 渠道品牌图标

| 项 | 说明 |
|---|---|
| 来源 | [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) → `plugin-src/client/channel-logos.js` |
| 取用方式 | **逐字复制**其中的 SVG `path` 数据、`viewBox` 与 `fill`（未改形状与配色） |
| 用到的组件 | `WecomLogoGlyph` · `FeishuLogoGlyph` · `DingtalkLogoGlyph` · `SlackLogoGlyph` · `DiscordLogoGlyph` |
| 落点 | `client.js` 的图标段；每个 glyph 上方注释标明 `取自 dsh-im <GlyphName>` |
| 通用自定义图标 | 自有中性图标（dsh-im 无对应项），不涉第三方 |
| 商标说明 | 上述图标为各平台商标/标识，仅用于**指示通知将发往哪个平台**；本插件与各平台无隶属关系 |

**为什么抄而不引**：本插件的客户端半是手写单文件（loader 契约只允许 `require('react')`），
引第三方包会破坏装载契约；引远程图片会带来离线与 CSP 问题。

## 2. 运行时依赖

| 包 | 用途 | 许可 |
|---|---|---|
| `@deepseek-ai/schemastery` | 声明插件 Config schema（Loader 校验 + 表单投影） | MIT（随包发布） |

其余全部使用 Node 内置模块（`node:crypto` / `node:fs` / `node:http` 等），无其他第三方运行时依赖。
