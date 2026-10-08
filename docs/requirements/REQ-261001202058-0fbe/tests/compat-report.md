---
title: 兼容与迁移回归报告 · 后台 job 运行中不再推「会话已完成」
requirement_refs: [REQ-261001202058-0fbe]
updated: 2026-10-01
---

# 兼容与迁移回归报告

> **结论**：**无破坏性变更**。新增能力只在「接上 DSH 后台任务信息源 + 开关打开」时生效；
> 其余情形逐条等于改动前行为。全量 266 条用例全绿（基线 241 + 新增 25），既有断言**零改写**。

## 1. 环境与命令

| 项 | 值 |
|---|---|
| 包 | `dsh-notice-webhook`（纯 Node ESM，零 devDependencies） |
| 测试框架 | `node:test`（`package.json` 的 `scripts.test` = `node --test "test/*.test.js"`） |
| 命令 | `node --test "test/*.test.js"` |
| 改动前基线 | **tests 241 / pass 241 / fail 0**（本次改动前实测） |
| 改动后现状 | **tests 266 / pass 266 / fail 0**（31 个测试文件） |

## 2. 新增能力的作用范围（为什么它是「加法」）

```
                 ┌─ 未接上 job 服务（组合里没有 / 形状不符）──▶ 判定恒「不抑制」= 旧行为
完成类通知 ◀─────┤
                 ├─ jobAwareComplete = false ─────────────────▶ 判定不执行 = 旧行为
                 │
                 └─ 接上 + 开关打开 ──▶ 只有「本轮拉起且未结算的 job」才抑制（FR-1/FR-2）
```

**默认值兜底**：老配置不写 `jobAwareComplete` 即为 `true`（启用新能力）；想回到旧行为只需把它置 `false`（热改）。

## 3. 降级路径逐条证据

### 3.1 路径一：组合里没有 job 服务（既有 30 个测试文件天然覆盖）

| 用例 / 范围 | 断言 | 结果 |
|---|---|---|
| 既有 30 个测试文件的全部 241 条基线用例 | 调用 `createNotifier(config, {...})` 时**都不传** `options.jobs` → 闸门保持降级态 | **241/241 原样通过**，无一条因本需求改写 |
| `test/jobs-gate.test.js` → `TC-16 接线：没注入 job 服务（降级）→ 照常发` | `handle(turn/end)` 返回 `action:'sent'`，接收端收到 1 条 | 通过 |
| 同上 | 生产路径不主动 attach，因此**不产生**「job 服务不可用」告警 | 通过（告警计数 0） |
| `test/jobs-gate.test.js` → `TC-16b 接线：attach 形状不符的 job 服务 → 降级 + 一条 warn` | `handle(turn/end)` 仍 `action:'sent'`；降级告警**恰好 1 条** | 通过 |
| `test/jobs-gate.test.js` → `TC-2 job 服务形状不符` | `gate()` 返回 `{suppressed:false, reason:'unavailable'}`；重复 attach 不重复告警 | 通过 |

### 3.2 路径二：配置开关关闭

| 用例 | 断言 | 结果 |
|---|---|---|
| `TC-15 接线：jobAwareComplete=false → 逐字回到旧行为` | 假 registry 里明明有本轮 `running` 的 job，`handle(turn/end)` 仍返回 `action:'sent'`，接收端收到 1 条 | 通过 |
| `TC-15 关掉开关读得回来` | `normalizeConfig({jobAwareComplete:false}).jobAwareComplete === false`；不写该键则 `true` | 通过 |

### 3.3 判定保守性（拿不准 = 旧行为）

| 用例 | 断言 | 结果 |
|---|---|---|
| `TC-7` | 常驻 job（`startedAt` 早于本轮起点）不参与抑制 → `reason:'no-jobs'` | 通过 |
| `TC-8` | 没有轮次起点（插件晚加载）→ `reason:'no-turn-start'`（保守不抑制） | 通过 |
| `TC-2c` | `list()` 抛错 → `reason:'error'`，**照旧发**，并留一条 warn | 通过 |
| `TC-2b` | 畸形 job 事件（`output` 无 `job` 字段 / 无 owner）不抛异常、不误补发 | 通过 |

## 4. 既有测试改动声明

- **唯一改动**：`test/config.test.js:35` 的**测试标题文案**「volatile 字段集合与设计一致：恰好这 9 个」→「恰好这 10 个」。
- **零断言改动**：该用例的断言仍是 `assert.deepEqual(schema 的 volatile 集合, VOLATILE_KEYS)`——
  两边同时新增 `jobAwareComplete` 即继续成立（`test/config.test.js` 其余 5 条用例一字未动）。
- 其余 29 个既有测试文件**一行未改**。

## 5. 未触碰清单（回归靠既有用例守住）

`src/classify.js`、`src/router.js`、`src/goal.js`、`src/deliver.js`、`src/payload.js`、`src/bindings.js`、
`src/targets.js`、`src/outcomes.js`、`src/rpc.js`、`src/channels/**`、`client.js`、`package.json`（**依赖表未动**）；
`targets.json` / `bindings.json` 的格式与版本号；出站 v1 报文契约（补发报文与正常投递**逐字段相等**，见 `TC-10/18/19`）。

## 6. 回滚路径

| 场景 | 操作 | 效果 |
|---|---|---|
| 排障时想回到旧行为 | 配置 `jobAwareComplete: false` | **热改，不用重启**；下一次事件立即按旧行为处理 |
| 彻底回滚 | 卸载本版本 | 零落盘变更（没有新增文件、没有新增落盘键），卸载即净 |
| 换到没有 job 服务的组合 | 无需操作 | 自动降级 + 一条提示日志 |

## 7. 复现命令

```sh
cd /Users/mac/Documents/ai/dsh/dsh-notice-webhook
node --test "test/*.test.js"        # 期望：tests 266 / pass 266 / fail 0
node --test test/jobs-gate.test.js  # 期望：tests 25 / pass 25 / fail 0
```
