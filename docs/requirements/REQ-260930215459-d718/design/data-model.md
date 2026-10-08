---
title: 数据模型 · 通知设置页按原型重做并借鉴 dsh-im 图标
requirement_refs: [REQ-260930215459-d718]
updated: 2026-09-30
---

# 数据模型

> **TL;DR**：`TargetRecord` 增 `key`（app 渠道必填）与 `secret`（可选），`url` 由"用户输入"变为**派生值**；
> `targets.json` 升 v2，**同时落派生 url** 以便旧版本回滚；v1 文件按渠道前缀反解 key（反解失败则保留 url 直投）。

## 1. TargetRecord v2（serves: FR-2, FR-6）

| 字段 | 类型 | 必填 | 约束 | 变化 |
|---|---|---|---|---|
| `id` | string | ✅ | 非空、表内唯一 | 不变 |
| `name` | string | ✅ | 非空、≤60 | 不变 |
| `channel` | string | ✅ | `wecom/feishu/dingtalk/slack/discord/custom` | 不变 |
| `key` | string | app 渠道 ✅ | 匹配该渠道 `keyPattern`；无空白字符 | **新增** |
| `secretRef` | string | ✕ | 仅 `feishu`/`dingtalk` 允许 | 不变（语义仍是环境变量名） |
| `url` | string | ✅（落盘） | http(s) 绝对地址 | **语义变更**：不再由用户输入，而是 `composeUrl(channel, key)` 的派生值（`custom`/`slack`/`discord` 仍等于用户输入） |
| `headers` | object | ✕ | 仅 `custom` 允许 | 不变 |
| `enabled` | boolean | ✅ | 默认 `true` | 不变 |
| `events` | string[] | ✅ | 取值受控，空=全收 | 不变 |
| `isDefault` | boolean | ✅ | 默认 `false` | 不变 |

**校验的分工**（避免两处实现分叉）：

```
界面：形状校验（非空 / 无空格 / 长度） → 立即反馈，不落盘
Host：权威校验（keyPattern + 渠道×字段交叉约束） → 失败即 400 且不落盘
```

## 2. targets.json v2（serves: FR-2, FR-6）

```json
{
  "version": 2,
  "targets": [
    {
      "id": "企微-项目群-a1b2",
      "name": "项目群-企微",
      "channel": "wecom",
      "key": "693a91f6-7xxx-4bc4-97a0-0ec2sifa5aaa",
      "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx-4bc4-97a0-0ec2sifa5aaa",
      "enabled": true,
      "events": ["turn/end"],
      "isDefault": true
    }
  ]
}
```

| 决策 | 理由 |
|---|---|
| 落盘**同时**写 `key` 与派生 `url` | 冗余换回滚能力：旧版本只读 `url` 照样投递（AC-9）；一致性由"写入时一次算出"保证，不做惰性重算 |
| `key` 明文落盘（与 `url` 同级） | key 本就是地址的一部分、且现有 `url` 已明文；`secretRef` 仍只存**环境变量名**（密钥不出进程） |
| 不引入 `targets.json` v3 的迁移链 | 只有 v1→v2 一档；未知版本仍走"空表且不覆盖" |

## 3. 反解规则（v1 → v2）（serves: FR-6）

| 渠道 | 反解方式 | 失败处理 |
|---|---|---|
| `wecom` | 取 `?key=` 之后的部分 | 保留 url，记 warn，按 v1 语义直投 |
| `dingtalk` | 取 `?access_token=` 之后、`&` 之前 | 同上 |
| `feishu` | 取路径末段（`/hook/<token>`） | 同上 |
| `slack`/`discord`/`custom` | 无反解概念（本就是完整 URL） | 不产生 `key`，`input: 'url'` |

反解**只做一次**（读到 v1 文件时），结果立即升 v2 落盘；之后不再重复反解。

## 4. 迁移矩阵与回滚（serves: FR-6）

| 场景 | 行为 | 覆盖验收 |
|---|---|---|
| v1 文件，前缀命中 | 反解出 key → 升 v2，url 重算后与原文一致 | AC-8 |
| v1 文件，前缀不命中 / 用户手改过 url | 保留 url 直投 + warn，**不丢目标** | AC-8 |
| v2 文件被**旧版本**读 | 旧版本忽略 `key`，用 `url` 正常投递 | AC-9 |
| 坏 JSON / 未知版本 | 空清单且**不覆盖原文件** | 既有口径 |
| 单条非法（如 key 形状不对） | 只跳过该条并告警，其余照常加载 | 既有口径 |

## 5. RPC 投影变化（serves: FR-2）

| 端点 | 变化 |
|---|---|
| `GET /state` → `targets[]` | 增 `key`（可回显，属地址一部分）与 `secretConfigured`（保持只回布尔）；`url` 仍回（派生值，便于排查与兼容旧页面） |
| `POST /targets` | 收 `key`；若同时传了 `url` 且与派生值不一致 → **以 key 为准并记 warn**（防止两边打架）；`custom/slack/discord` 仍收 `url` |
| `POST /targets/delete`、`/test`、`/bind`、`/bindings/delete` | 不变 |
| 每目标新增 `help` 投影 | **新增只读字段**：由渠道元数据投影出 `{ title, steps[], docUrl }`，供界面渲染说明浮层 |

`revision` 栅栏语义不变；投影新增字段属追加式，不升 RPC 版本。
