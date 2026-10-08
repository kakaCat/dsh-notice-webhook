---
title: 端到端联调报告 · 后台 job 运行中不再推「会话已完成」
requirement_refs: [REQ-261001202058-0fbe]
updated: 2026-10-01
---

# 端到端联调报告

> **结论**：两条完整链路在**真实 HTTP 接收端**上跑通——后台有活时**零推送**、活干完**恰好补一条**、
> 补的那条与正常通知**逐字段一致**；换轮次时不会重复，多个 job 时只认最后一个。

## 1. 联调环境

| 项 | 值 |
|---|---|
| 接收端 | 测试内起真 `node:http` server（`127.0.0.1` 随机端口），收真报文、回 200 |
| 目标渠道 | `custom`（v1 原样 JSON 契约） |
| 唯一打桩处 | DSH 的 `ctx.jobs` 换成测试假件（其余全真：分类 → 闸门 → 路由 → 渠道打包 → HTTP 投递） |
| 时间控制 | 假时钟 + 假计时器（宽限窗口瞬时推进，不真等 1.5s） |
| 命令 | `node --test test/jobs-gate.test.js` |
| 结果 | **tests 25 / pass 25 / fail 0** |

## 2. 链路 ①「抑制 → 结算 → 补发」

```
turn/start(turn=1)
   ↓
假 registry 注册 running job（bash-1, startedAt ≥ 轮次起点）
   ↓
turn/end(completed) ──▶ 闸门命中 ──▶ drop(job-running)
   ↓                                  └─ 接收端：**0 条**  ✅
job 结算（settled 事件）
   ↓
推进宽限计时器（窗口内无新 turn/start）
   ↓
dispatch 补发 ──────────────────────▶ 接收端：**恰好 1 条**  ✅
                                       └─ 与「无 job 同场景基线」逐字段相等（忽略 at）✅
```

**证据用例**

| 用例 | 断言 | 结果 |
|---|---|---|
| `TC-3 接线：本轮 running job → turn/end 被压住` | 返回 `{action:'dropped', reason:'job-running', jobIds:['bash-1']}`，接收端 0 条 | ✅ 71.6ms |
| `TC-10/18/19 接线：job 结算 + 宽限到点` | 接收端恰好 1 条；`withoutAt(补发) deepEqual withoutAt(基线)` | ✅ 55.7ms |

> 「逐字段相等」包含 `version:1` / `event:'turn/end'` / `message` / `title` / `sessionId` / `workspace` / `source`，
> 以及 `context` 里的「你说了什么」——证明被抑制那一轮的输入确实从捕获值回填（此时实时 prompt 已被 clear）。

## 3. 链路 ②「换轮次不重复」

```
抑制（turn=1 结束）→ job 结算 → **宽限窗口内** turn/start(turn=2)
   ↓
pending 被新轮次作废 → 推进计时器 → 接收端 0 条补发   ✅
   ↓
turn=2 的 turn/end(completed)
   ↓
正常投递 ────────────────────────▶ 接收端 **1 条**  ✅
```

**证据用例**

| 用例 | 断言 | 结果 |
|---|---|---|
| `TC-11 接线：结算后宽限内开新轮次` | 推进计时器后 0 条；随后新轮次 `turn/end` 返回 `action:'sent'`，接收端 1 条 | ✅ 65.3ms |

## 4. 链路 ③「多 job」（补充）

| 用例 | 断言 | 结果 |
|---|---|---|
| `TC-12 接线：一轮两个 job` | 先结算 `bash-1` → 0 条；再结算 `bash-2` + 推进宽限 → 恰好 1 条 | ✅ 63.7ms |

## 5. 同批联调覆盖的边界

| 用例 | 断言 | 结果 |
|---|---|---|
| `TC-14b dispose 后推进计时器` | 卸载后推进计时器 → 0 条（无悬挂计时器、无未捕获异常） | ✅ 42.4ms |
| `TC-15 jobAwareComplete=false` | 有 running job 仍 `action:'sent'`（旧行为） | ✅ 23.0ms |
| `TC-16 未注入 job 服务` | 照常发；无端告警 0 条 | ✅ 22.5ms |
| `TC-16b 形状不符` | 照常发 + 恰好 1 条降级 warn | ✅ 23.0ms |
| `TC-17b 生产路径 ctx.inject(['jobs'])` | 服务就绪 → 订阅上（listenerCount 1）；卸载 → 摘掉（0） | ✅ 2.4ms |

## 6. 全量回归

```sh
node --test "test/*.test.js"    # tests 266 / pass 266 / fail 0
```

## 7. 复现命令

```sh
cd /Users/mac/Documents/ai/dsh/dsh-notice-webhook
node --test test/jobs-gate.test.js
```
