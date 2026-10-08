# 测试证据（REQ-261001202058-0fbe）

> 采集命令：`node --test "test/*.test.js"`（工作区根目录）
> 采集结果：**tests 266 / pass 266 / fail 0**（duration ≈ 2.4s）
> 改动前基线：**tests 241 / pass 241 / fail 0**（本需求开工前实测）

## 分文件统计（本需求相关）

| 测试文件 | 通过/总数 | 覆盖条款 | 对应用例 |
|---|---|---|---|
| `test/jobs-gate.test.js`（**新增**） | 25/25 | FR-1 … FR-6 | TC-1 … TC-22 |
| `test/config.test.js` | 6/6 | FR-4 | volatile 集合断言（仅标题文案 9→10） |
| 其余 29 个既有文件 | 235/235 | 既有条款 | 全部走降级路径（不注入 jobs）——FR-4 回归网 |

## 关键断言证据（摘要）

| 断言 | 实测结果 |
|---|---|
| 抑制：本轮 running job + turn/end | `{action:'dropped', reason:'job-running', jobIds:['bash-1']}`，真 HTTP 接收端 **0 条**（71.6ms） |
| 补发：结算 + 宽限到点 | 接收端 **恰好 1 条**（55.7ms）；与「无 job 同场景基线」`deepEqual`（忽略 `at`），含 `version:1` / `event:'turn/end'` / `message` / `context` 里的「你说了什么」 |
| 换轮次不重复 | 宽限内 `turn/start` → 0 条补发；新轮次 `turn/end` → 1 条 `sent`（65.3ms） |
| 多 job | 先结算 1 个 → 0 条；第 2 个结算 + 宽限 → 恰好 1 条（63.7ms） |
| 常驻 job 不静音 | `startedAt` 早于本轮起点 → `reason:'no-jobs'`、照常发（TC-7） |
| 无轮次起点（插件晚加载） | `reason:'no-turn-start'`、保守不抑制（TC-8） |
| 判定抛错 | `reason:'error'` + 1 条 warn、**照旧发**（TC-2c） |
| 降级（无 job 服务 / 形状不符） | 均 `action:'sent'`；形状不符额外 1 条 warn，不重复告警（TC-2 / TC-16 / TC-16b） |
| 开关关闭 | `jobAwareComplete:false` → `action:'sent'`（旧行为，TC-15） |
| dispose | 卸载后推进宽限计时器 → 0 条补发、无未捕获异常（TC-14 / TC-14b） |
| 生产路径接线 | `ctx.inject(['jobs'])` 就绪 → 订阅数 1；卸载 → 0（TC-17b） |
| 配置契约 | `jobAwareComplete` 默认 `true`、volatile 集合成员、非法值回落 + 1 条 warn |
| 排障口径 | `grep -c 'job-running' docs/guides/operations.md` → **2**（排查清单 + 原因码表） |

## 逐卡覆盖登记（24 张卡）

### t1 配置契约（`jobAwareComplete`）

| 覆盖登记 | 角色 | 证据 |
|---|---|---|
| `covers: t-1c0dc2` | 父卡 | `node --test test/config.test.js` 6/6；探针 `node -e "…c.jobAwareComplete.get(), VOLATILE_KEYS.includes('jobAwareComplete')"` → `true true` |
| `covers: t-ae0636` | 研发 | `node --test test/config.test.js test/jobs-gate.test.js` → 9/9；四处登记行号 src/config.js:34/58/182/224 |
| `covers: t-1a2036` | 复核 | 对照 `design/interfaces.md §5` 逐条（类型/默认/volatile/回落路径），结论「无偏离」 |
| `covers: t-5456ad` | 测试 | 全量 `node --test "test/*.test.js"` → 244/244（当时），0 fail |

### t2 判定闸门模块

| 覆盖登记 | 角色 | 证据 |
|---|---|---|
| `covers: t-30bbed` | 父卡 | `node --test test/jobs-gate.test.js` 判定层 16/16 + 全量 257/257（当时） |
| `covers: t-bf2be8` | 研发 | `node --test test/jobs-gate.test.js` → 16/16；`node --check src/jobs.js` 通过 |
| `covers: t-d4d793` | 复核 | 对照 `design/interfaces.md §2` 成员表 + `data-model.md §3` 判定式逐条，结论「无偏离」（唯一扩展：pending 多存 jobIds） |
| `covers: t-e5e744` | 测试 | 全量 `node --test "test/*.test.js"` → 257/257（当时），0 fail |

### t3 接线（主链路 + `ctx.inject(['jobs'])` + 补发通路）

| 覆盖登记 | 角色 | 证据 |
|---|---|---|
| `covers: t-acae58` | 父卡 | 接线层断言（drop 时 0 条 / 补发 1 条且与基线逐字段相等 / 换轮次 0 条 / 双 job）全部通过；全量 266/266 |
| `covers: t-f468d1` | 研发 | `node --test test/jobs-gate.test.js` → 25/25；接线行号 index.js:126/220/235-237/367-369/411-412 |
| `covers: t-ce6b74` | 联调 | 真 HTTP 接收端三条链路：TC-3（0 条）、TC-10/18/19（1 条 + 逐字段相等）、TC-11（换轮次不重复）、TC-12（双 job） |
| `covers: t-1e395e` | 复核 | 对照 `§3/§4/§6/§7/§8` 逐条，结论「无偏离」；另记录三条交互细节（抑制不消耗冷却 / 延迟引用 dispatch 无 TDZ / volatile 读取路径未变） |
| `covers: t-cbf134` | 测试 | 全量 `node --test "test/*.test.js"` → 266/266，0 fail；`node --check index.js src/jobs.js` 通过 |

### t4 迁移与兼容回归

| 覆盖登记 | 角色 | 证据 |
|---|---|---|
| `covers: t-bdef4c` | 父卡 | 全量 266/266（基线 241/0）；`tests/compat-report.md` 落盘（两条降级路径逐条证据 + 回滚路径） |
| `covers: t-830f85` | 研发 | TC-15 / TC-16 / TC-16b / TC-2 / TC-2b / TC-2c / TC-7 / TC-8 全绿；报告含「唯一改动 = config.test.js 标题文案」声明 |
| `covers: t-c3b5bc` | 复核 | 对账：`grep -ln "jobs:" test/*.js` 只命中 jobs-gate.test.js；`find . -newermt 20:22`（代码面）只有 5 个文件 —— 一致 |
| `covers: t-9905e8` | 测试 | 全量 266/266；`node --check` 覆盖 5 个落地文件全部通过 |

### t5 排障口径

| 覆盖登记 | 角色 | 证据 |
|---|---|---|
| `covers: t-613fc4` | 父卡 | `grep -n 'job-running' docs/guides/operations.md` 命中两处表格行（:35 排查步骤 / :52 原因码表） |
| `covers: t-ff3619` | 研发 | 三处更新齐备：原因码表 :52、排查清单 :35、配置表 volatile 行 :58 |
| `covers: t-93732c` | 复核 | 三处口径对账：对 `design/interfaces.md §4` / `index.js:237` / `§5`，结论「无偏离」 |

### t6 端到端联调

| 覆盖登记 | 角色 | 证据 |
|---|---|---|
| `covers: t-fbe154` | 父卡 | `tests/e2e-report.md` 落盘；`node --test test/jobs-gate.test.js` 25/25 |
| `covers: t-f8c218` | 研发 | 三条链路 + 边界 5 项实测通过（耗时 71.6/55.7/65.3/63.7/42.4/23.0/22.5/2.4ms） |
| `covers: t-0d216c` | 复核 | 报告 3 条链路 + 5 行边界表 ↔ 9 组用例断言逐条对账，结论「对账一致」 |
| `covers: t-caa24b` | 测试 | 全量 266/266；`node --check` 5 文件通过 |

## 复现命令

```sh
cd /Users/mac/Documents/ai/dsh/dsh-notice-webhook
node --test "test/*.test.js"        # tests 266 / pass 266 / fail 0
node --test test/jobs-gate.test.js  # tests 25 / pass 25 / fail 0
node --test test/config.test.js     # tests 6 / pass 6 / fail 0
```
