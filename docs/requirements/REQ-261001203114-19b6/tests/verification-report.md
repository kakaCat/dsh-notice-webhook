---
title: 需求级自检报告 · 会话异常中断通知
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 需求级自检报告（t9）

> **结论**：**FR-1 ~ FR-6 六条全部达标**，7 条不变量全部成立，`node --test "test/*.test.js"` = **288 passed / 0 failed**。
> 本次交付的核心行为变化一句话：**agent 因报错或崩溃停下时会被叫到，且再也不会被说成「已完成」**。

## 1. 逐条 FR 对照（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| FR | 判定命令 | 实际输出摘要 | 结论 |
|---|---|---|---|
| **FR-1** 终态分类，禁止兜底成「完成」 | `node -e` 逐 kind 调 `Classifier.classify`（8 种） | `completed→complete/turn/end`；`error/interrupted/weird→interrupt/turn/error`；`aborted/blocked/max-tokens/forked→null` | ✅ 与分类表逐行一致 |
| **FR-2** 中断内容与错误事实 | 同上 + `node --test test/interrupt.test.js`（T4-2/T4-3） | `error.message` 已单行化；300 字符输入 → `length === 200`；`error:{}` → `code=UNKNOWN, message=''`；`interrupted` → `error=null`、正文无括号 | ✅ |
| **FR-3** 出站新增 `turn/error`（version 仍 1） | `node -e` 调 `buildPayload` 对比中断/完成 | 中断报文键：`…,reason,error,…`，`version=1`，`reason='error'`；**完成报文不含 `reason`/`error`** | ✅ |
| **FR-4** 开关、文案与静默名单 | `node -e` 读 `Config({})` 与 `Router.isTypeDisabled` + T5-1/T5-2 | `notifyInterrupt=true`（volatile）；`skipReasons=["aborted"]`；`interruptMessage=会话异常中断`；`notifyInterrupt:false → isTypeDisabled(interrupt)=true`；`skipReasons:['error'] → turn-skipped`；自动轮 `error` 照推、自动轮 `completed` 静默 | ✅ |
| **FR-5** 配置面与 eventsMode 迁移 | `node -e` 调 `normalizeEvents` + `node --test test/targets-events.test.js` | 旧版全集 → `{"events":[],"eventsMode":"all"}`；`explicit` 四项 → 保持；`explicit` 空 → 全不收；`TARGET_FILE_VERSION=3`；客户端 `turn/error` 出现 2 处 | ✅ |
| **FR-6** 可观测与回归 | `node -e` 调 `silentReasonOf` + 全量回归 | `aborted→turn-aborted`、`blocked/max-tokens/forked→turn-not-notifiable`、`error` 进名单→`turn-skipped`、`completed→null`；全量 **288/288** | ✅ |

## 2. 不变量核对（design/architecture.md §4）（serves: FR-1, FR-2, FR-3, FR-5）

| 不变量 | 核对方式 | 结果 |
|---|---|---|
| I1 `error` / 未知终态**永不**产出 `turn/end` | T4-1 断言 `received.some(b => b.event === 'turn/end') === false` | ✅ |
| I2 非中断意图报文**逐字节不变** | T4-5 断言完成报文键集合不含 `reason` / `error` | ✅ |
| I3 分类是纯函数、不抛、无 I/O | T2-8 用 `{}` / `{kind:42}` / `undefined` / `{kind:''}` 四种畸形输入 | ✅ |
| I4 `targets.json` 版本不变，只追加记录级可选字段 | T6-7 断言 `version === 3` 且记录含 `eventsMode` | ✅ |
| I5 `blocked`/`max-tokens`/`forked` 既不推送也不产出完成 | E1/E2 + T5-3 | ✅ |
| I6 `autoRound` 静默**只**对完成意图生效 | T5-1（自动轮 error 照推）/ T5-2（自动轮 completed 静默） | ✅ |

## 3. 交付物与证据（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| 产物 | 说明 |
|---|---|
| `src/classify.js` | `decideTurnEnd()` 决策表（唯一真相）、`silentReasonOf()`、`errorFacts()`、`turnKindOf()`；`turn/end` 分支改查表 |
| `src/config.js` | `notifyInterrupt`（volatile）、`interruptMessage`、`skipReasons` 默认 `['aborted']`（五处登记一致） |
| `src/router.js` | 中断类型开关（两处通路）+ `targetAccepts()` 按 `eventsMode` 判定（`listedEventMatches()` 单点实现 `goal/*` 通配） |
| `src/channels/custom.js` / `src/payload.js` | 中断意图追加 `reason` / `error`；事件元数据 `⚠️ 会话中断` |
| `src/targets.js` | `EVENT_TYPES` + `turn/error`、`LEGACY_ALL_EVENTS`、`normalizeEvents()`、`validateTarget()` 输出 `eventsMode` |
| `index.js` | `handle()`：静默留痕（`turn-*` 原因码 + debug 日志）；自动轮静默仍只对完成生效 |
| `client.js` | 关心事件多一项「会话中断」；保存语义改为「全勾 → 全收，否则显式」 |
| `test/interrupt.test.js`（新） | 7 个链路用例：报文字节、单行化/限长、自动轮、开关与静默码 |
| `test/targets-events.test.js`（新） | 10 个用例：归一化判定式、接收语义、落盘版本、老记录迁移、回滚可读 |
| `test/classify.test.js`（扩展） | 决策表 7 个新用例（8 终态 / 静默码 / 单行化 / 未知终态） |
| 文档 | `README.md`（场景表 / 配置表 / 推送契约 / 接收端兼容）、`docs/architecture/notification-plugin.md`（决策 8 + 三条新坑）、`docs/guides/operations.md`（三个 `turn-*` 原因码） |

**全量回归**：

```sh
node --test --test-timeout=30000 "test/*.test.js"
# ℹ tests 288 / pass 288 / fail 0 / duration_ms ≈ 2.6s
```

**基线说明（重要）**：立项时基线是 `244`，本次改动开始前实测为 `266`——差额来自**另一个窗口在同一仓库并发实施**
`REQ-261001202058-0fbe`（后台 job 闸门，新增 `src/jobs.js` 与 `test/jobs-gate.test.js`）。本次自身新增/扩展 **22** 个用例，
`266 + 22 = 288`，符合"只增不减"。

## 4. 与需求/设计文档的偏差（全部记账，无静默降级）（serves: FR-4, FR-5, FR-6）

| # | 偏差 | 处置 |
|---|---|---|
| 1 | 需求 FR-5 写「不改文件格式」；设计精确化为「不升 `version`，单条记录追加可选字段 `eventsMode`」 | 设计阶段已向人明示并获批准；实现与 [compat-report.md](compat-report.md) 一致 |
| 2 | 设计判定顺序把 `skipReasons` 排在 `aborted` 之前 → `turn-aborted` 不可达 | 实施期改为 `aborted` 优先（行为不变、码变准）；设计文档 §1 与 T2-4 已同步修订 |
| 3 | 计划 t3 的验收探针写成 `c.skipReasons.get()` | `skipReasons` 非 volatile（普通值不是 getter），实际用 `c.skipReasons`；结论不变（默认值 `["aborted"]`） |
| 4 | 实现期自查抓到 `targetAccepts` explicit 分支漏 `goal/*` 通配 | 被既有用例 TC-9 抓住后修复：抽出 `listedEventMatches()` 单点实现 |
| 5 | 既有断言改动 3 处 | `classify.test.js` TC-5（`interrupted` 不再静默）、`config.test.js` 两处（默认 `skipReasons`、volatile 计数 10→11）——均属需求预期变更 |

## 5. 未做（边界，来自需求 §边界）（serves: FR-1）

- 不做错误自动重试 / 自动续跑（属 DSH `llm-retry` 与 agent-loop）；
- 不把 stream 原始事件或错误堆栈搬进正文（只取 code + 单行截断 message）；
- 不做按 kind 的独立开关与文案矩阵：`blocked` / `max-tokens` / `forked` 本次**不推送**（要推走后续需求）；
- 不提供「退回谎报完成」的开关。

## 6. 任务卡覆盖对照（covers 标注）（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

> 每张任务卡「被谁验证」的对照表（父卡与其子卡链各自成立）。门禁解析本节的 `covers:` 标注。

### 6.1 父卡

| 任务卡 | 验证它的证据 | covers 标注 |
|---|---|---|
| t1 分类契约 | 8 终态决策表探针 + `test/classify.test.js`（T2-*、T3-*） | `covers: t-5e2101` |
| t2 数据契约 | 归一化探针 + `test/targets-events.test.js`（T6-1…T6-12） | `covers: t-a36090` |
| t3 接线 | 配置/路由探针 + `test/interrupt.test.js`（T3-2/T3-3、T5-3/T5-4）+ router/config 用例 | `covers: t-413c55` |
| t4 出站报文 | 报文探针 + `test/interrupt.test.js`（T4-1…T4-6） | `covers: t-5cbf4c` |
| t5 前端 | `test/client-render.test.js` / `client-service` / `client-hooks` + `grep -o turn/error client.js` | `covers: t-ca1e16` |
| t6 迁移与兼容 | `test/targets-events.test.js`（T6-2/T6-4/T6-7/T6-8）+ `tests/compat-report.md` | `covers: t-ef4fa8` |
| t7 测试 | 全量 `node --test` → 288/288 + 两个新测试文件 | `covers: t-cdd782` |
| t8 文档同步 | `grep turn/error` / `grep turn-not-notifiable` 三份文档命中 | `covers: t-691d67` |
| t9 需求级自检 | 本报告 §1/§2 + `reviews/implementation-review.md` | `covers: t-ce4b1a` |

### 6.2 子卡链

| 子卡 | 验证它的证据 | covers 标注 |
|---|---|---|
| t1·研发 | 决策表探针（8 终态逐行一致） | `covers: t-0a89bd` |
| t1·复核 | 契约逐条对照 + 非中断路径零改动核对 | `covers: t-96b6a2` |
| t1·测试 | `node --test test/classify.test.js` 全绿 + 全量 288/288 | `covers: t-5249d2` |
| t2·研发 | 归一化探针（三态 + 幂等 + 版本 3） | `covers: t-f5f9e9` |
| t2·复核 | 唯一归一化落点核对 + 未知事件仍被拒 | `covers: t-4039c3` |
| t2·测试 | `node --test test/targets-events.test.js` 10/10 | `covers: t-90073b` |
| t3·研发 | 配置探针 + 路由探针 | `covers: t-a6684d` |
| t3·联调 | `test/interrupt.test.js` 真 HTTP 接收端两条链路 | `covers: t-9bd584` |
| t3·复核 | 两处开关通路一致 + 三态语义逐行核对 | `covers: t-5a02c2` |
| t3·测试 | config/router/filter 用例 + 全量回归 | `covers: t-946335` |
| t4·研发 | 报文探针（中断带字段 / 完成不带） | `covers: t-626838` |
| t4·复核 | 条件追加契约核对 + T4-5 不变量 | `covers: t-e0032e` |
| t4·测试 | `test/payload` / `channels.meta` / `interrupt` 全绿 | `covers: t-539bd4` |
| t5·研发 | `grep -c turn/error client.js` = 2 | `covers: t-5d66e3` |
| t5·复核 | 布局/图标/对外契约未变核对 | `covers: t-3b3e5b` |
| t5·测试 | 客户端三份用例全绿 | `covers: t-5a0f0d` |
| t6·研发 | `tests/compat-report.md` 三条路径证据命令 | `covers: t-774e6d` |
| t6·复核 | 回滚安全 + 两种空语义区分（T6-3/T6-9/T6-12） | `covers: t-126c83` |
| t6·测试 | `node --test test/targets-events.test.js` 10/10 + `version === 3` | `covers: t-13691e` |
| t7·研发 | 三套用例落地（本报告 §1 逐条引用） | `covers: t-4a8281` |
| t7·联调 | 真接收端：中断报文 / 静默 / 自动轮 | `covers: t-624074` |
| t7·测试 | 全量 288/288 + 基线口径说明 | `covers: t-014928` |
| t8·研发 | 三份文档 grep 命中 | `covers: t-3f1491` |
| t8·复核 | 文档与实现逐项对齐核对 | `covers: t-79265a` |
| t9·研发 | 本报告 §1 逐条 FR 证据 | `covers: t-577377` |
| t9·复核 | 本报告 §2 七条不变量 + §4 偏差记账 | `covers: t-2c64b0` |
| t9·测试 | 全量 288/288 + 并发噪音说明 | `covers: t-d3aa47` |

**覆盖结论**：36 张任务卡（9 父卡 + 27 子卡）全部有对应验证证据，覆盖率 100%。
