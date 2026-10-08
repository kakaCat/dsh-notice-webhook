---
title: 测试用例 · 通知设置页按原型重做并借鉴 dsh-im 图标
requirement_refs: [REQ-260930215459-d718]
updated: 2026-09-30
---

# 测试用例

> **TL;DR**：21 条用例，重心在三处——**渠道元数据与 URL 互逆**（FR-2/FR-6）、**v1→v2 迁移与回滚**（FR-6）、
> **界面结构对齐原型**（FR-1/FR-4/FR-5）。既有 158 条里凡涉及 `url` 直填的用例按新契约更新，并逐条记理由。

## 1. 图标与 rail（serves: FR-1, FR-4）

| 用例 | 断言（可执行） |
|---|---|
| TC-1 | `test/client-service.test.js`：`client.js` 内联 SVG 常量表含 5 个品牌 glyph 与 1 个通用 glyph；每项带 `取自 dsh-im` 注释 |
| TC-2 | 同上：`ChannelIcon({channel:'wecom',size:22})` 返回元素且 `props.viewBox === '0 0 24 24'`、`props.width === 22` |
| TC-3 | 同上：`grep -c 'https\?://.*\.svg\|<img' client.js` 为 0（**不含远程图片**） |
| TC-4 | 同上：rail 渲染含三段标记（`全部目标` / `按渠道` / `默认组`）；六个渠道各有一行（0 个目标时也在） |
| TC-5 | 同上：`isDefault` 目标在 rail 显示「默认」徽标；被会话绑定的目标显示「绑定」徽标 |

## 2. 只填 key 与 URL 组装（serves: FR-2, FR-6）

| 用例 | 断言（可执行） |
|---|---|
| TC-6 | 新增 `test/channels.meta.test.js`：`CHANNEL_META` 六项齐全；`input:'key'` 的三项都有 `urlPrefix` 与 `keyPattern` |
| TC-7 | 同上：`composeUrl({channel:'wecom',key:'abc12345'})` === 前缀 + key；`dingtalk`/`feishu` 同理 |
| TC-8 | 同上：对三渠道做 `parseKey(composeUrl(x)) === x`（**互逆**）；反解失败返回 `undefined` 且**不抛异常** |
| TC-9 | `test/targets.test.js`：保存 `{channel:'wecom',key:'abc12345'}` → 落盘记录含 `key` 且 `url` 为派生值 |
| TC-10 | 同上：`key` 形状不合法（空 / 含空格 / 超长）→ 保存被拒、文件未被修改、revision 不 bump |
| TC-11 | `test/rpc.write.test.js`：`POST /targets` 同时传 `key` 与不一致的 `url` → 以 `key` 为准、返回 200，日志有 warn |

## 3. 迁移与回滚（serves: FR-6）

| 用例 | 断言（可执行） |
|---|---|
| TC-12 | 新增 `test/compat.v3.test.js`：喂 **v1 文件**（`{version:1, targets:[{channel:'wecom', url:'…?key=abc12345'}]}`）→ 读出 `key==='abc12345'`，写回后 `version===2` |
| TC-13 | 同上：v1 文件里**前缀不匹配**的条目（用户手改过 url）→ 保留 `url` 原样、无 `key`、仍参与投递、有 warn |
| TC-14 | 同上：**回滚模拟**——用 v1 语义的读取路径读 v2 文件，能取到可投递的 `url` 且不报错 |
| TC-15 | 同上：坏 JSON / `version:99` → 空清单且**原文件字节不变**（沿用既有口径） |

## 4. RPC 与说明浮层（serves: FR-2, FR-3）

| 用例 | 断言（可执行） |
|---|---|
| TC-16 | `test/rpc.read.test.js`：`GET /state` 含 `channelMeta`（六项、每项有 `help.title/steps/docUrl`）与目标的 `key` |
| TC-17 | 同上：`secret` 仍只回 `secretConfigured` 布尔；**密钥明文不出现在响应里** |
| TC-18 | `test/client-service.test.js`：`help` 缺失的渠道**不渲染**说明入口；`help` 存在时点击后元素含 `steps` 与 `docUrl` |
| TC-19 | 同上：说明浮层为就地展开（无 `window.open` 调用；`docUrl` 仅作为链接 href），且 Esc 可关 |

## 5. 契约不回归（serves: FR-6）

| 用例 | 断言（可执行） |
|---|---|
| TC-20 | `node --test test/channels.cn.test.js test/channels.global.test.js`：**六渠道报文与加签串断言逐条不变**（这是硬边界） |
| TC-21 | `node --test "test/*.test.js"`：全绿；受新数据模型影响的既有用例已按新契约更新，更新理由逐条记入测试报告 |

## 6. 用例与 FR 的对应（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| FR | 用例 |
|---|---|
| FR-1 | TC-1, TC-2, TC-3, TC-5 |
| FR-2 | TC-6, TC-7, TC-9, TC-10, TC-11, TC-16 |
| FR-3 | TC-16, TC-18, TC-19 |
| FR-4 | TC-4, TC-5（结构）+ 人工照原型核对 |
| FR-5 | TC-4, TC-5（徽标）+ 绑定页人工核对 |
| FR-6 | TC-8, TC-12, TC-13, TC-14, TC-15, TC-17, TC-20, TC-21 |
