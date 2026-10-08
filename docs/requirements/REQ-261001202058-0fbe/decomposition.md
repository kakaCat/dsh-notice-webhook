---
title: 拆分计划 · 后台 job 运行中不再推「会话已完成」
requirement_refs: [REQ-261001202058-0fbe]
updated: 2026-10-01
---

# 拆分计划

> **目标**：让「会话已完成」这条通知只在**真的没有活挂在后台**时发出——`turn/end` 后若本会话仍有本轮拉起、未结算的 job，
> 就抑制；该批 job 全部结算且会话确实空闲时补发一次。
>
> **做法**：新增一个只读判定闸门 `src/jobs.js`，插在 `classify` 与 `dispatch` 之间；接线走 `ctx.inject(['jobs'])`
> （形状不符即降级为旧行为）；新增一个 volatile 开关 `jobAwareComplete`；出站报文与落盘数据一字不动。
>
> **一句话验收**：`node --test "test/*.test.js"` 退出码 0（基线 241 通过，新增用例全绿），
> 且新增用例覆盖「抑制 / 常驻 job 不静音 / 结算补发 / 开关与降级 / 报文零变化」。

## 1. 改动盘点（对照 5 份设计文档）

### 1.1 新增文件

| 文件 | 内容 | 规格来源 |
|---|---|---|
| `src/jobs.js` | `isJobRegistryLike()` + `createJobGate()`（attach / detach / noteTurnStart / gate / observe / pendingOf / dispose） | design/interfaces.md §2、design/data-model.md §3 |
| `test/jobs-gate.test.js` | 假 registry / 假时钟 / 假计时器 + 判定层与接线层用例（TC-1…TC-21） | design/test-cases.md |
| `docs/requirements/REQ-261001202058-0fbe/tests/` | 回归与联调报告 | 既有需求目录惯例 |

### 1.2 修改文件

| 文件 | 改动 | 规格来源 |
|---|---|---|
| `src/config.js` | 新增 `jobAwareComplete`（`DEFAULTS` / `BOOLEAN_KEYS` / schema `.default(true).volatile()` / `VOLATILE_KEYS`） | design/interfaces.md §5 |
| `index.js` | `createNotifier` 新增可选 `jobs / jobGraceMs / clock / timers` 与 `gate`、`dispose()`；`handle()` 插入 `turn/start` 记录与完成闸门；`deliverToTarget` 支持 `extra.prompt`；`apply()` 增加 `ctx.inject(['jobs'])` 接线与清理顺序 | design/interfaces.md §3、§4、§7 |
| `test/config.test.js` | **仅测试标题文案**：「恰好这 9 个」→「恰好这 10 个」（零断言改动） | design/test-cases.md §9 |
| `docs/guides/operations.md` | `drop` 原因码表新增 `job-running` 行；「通知没到」排查步骤补一条 | design/interfaces.md §4（FR-6） |

### 1.3 明确不改（写进不变量，回归靠既有测试）

`src/classify.js`、`src/router.js`、`src/goal.js`、`src/deliver.js`、`src/payload.js`、`src/bindings.js`、`src/targets.js`、
`src/outcomes.js`、`src/rpc.js`、`src/channels/**`、`client.js`、`package.json`（**不新增依赖**）、
`targets.json` / `bindings.json` 的格式与版本号、出站 v1 报文契约。

## 2. 任务表

| key | 标题 | phase | side | 依赖 | 说明 |
|---|---|---|---|---|---|
| t1 | 配置契约：新增开关 `jobAwareComplete` | implement | backend | — | `src/config.js` 四处登记 + 既有 volatile 断言兼容 |
| t2 | 判定闸门模块 `src/jobs.js`（纯内存 + 单测） | implement | backend | — | 接口与判定式按 design/interfaces.md §2、data-model.md §3 |
| t3 | 接线：主链路插入闸门 + `ctx.inject(['jobs'])` + 补发通路 | implement | backend | t1, t2 | `index.js` 唯一改动点集中于此卡 |
| t4 | 迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方） | test | backend | t3 | 单列的兼容卡：不改既有断言，证明降级 == 旧行为 |
| t5 | 排障口径：`drop` 原因码 `job-running` 进运维文档 | doc | doc | t3 | FR-6 的文档落点 |
| t6 | 端到端联调：真 HTTP 接收端跑「抑制 → 结算 → 补发」 | test | backend | t4 | 与 t4 串行，共用 `test/jobs-gate.test.js` |

**依赖图**：

```
t1 ─┐
    ├─▶ t3 ─┬─▶ t4 ──▶ t6
t2 ─┘       └─▶ t5
```

**为什么这样切**：数据契约（t1）与模块接口（t2）先行且互不依赖；接线（t3）是唯一把三者缝在一起的卡；
迁移兼容（t4）按类型档要求**单列**；文档（t5）与联调（t6）各自独立收口。

### t1 配置契约：新增开关 `jobAwareComplete`

- **implementation**：`src/config.js` 的 `DEFAULTS.jobAwareComplete = true`、`BOOLEAN_KEYS` 增键、
  `Config` schema 增 `jobAwareComplete: z.boolean().default(true).volatile()`、`VOLATILE_KEYS` 增键（四处必须同进同出）；
  `test/config.test.js:35` 只改测试标题文案「9」→「10」；在 `test/jobs-gate.test.js` 落配置断言。
- **acceptance**：
  ```sh
  node --test test/config.test.js     # 退出码 0（集合断言两侧同时新增该键，零断言改动）
  node -e "import('./src/config.js').then(m=>{const c=m.Config({});console.log(c.jobAwareComplete.get(), m.VOLATILE_KEYS.includes('jobAwareComplete'))})"
  # 期望输出：true true
  ```
  且非法值回落：`normalizeConfig({jobAwareComplete:'yes'})` → `true` 且产生 1 条 warn。
- **skipIntegration**：true（纯配置契约，无接口可联调）。

### t2 判定闸门模块 `src/jobs.js`

- **implementation**：实现 `isJobRegistryLike()` 与 `createJobGate({logger, graceMs, clock, setTimer, clearTimer, deliver})`，
  成员与错误语义严格按 design/interfaces.md §2；判定式按 design/data-model.md §3（owner / status / `startedAt >= since` 三重过滤）；
  `observe()` 只认 `settled` / `removed` 且必须判 `event?.job` 存在（`output` 事件没有 `job`）；
  所有异常吞掉 + warn。测试侧在 `test/jobs-gate.test.js` 建假 registry / 假时钟 / 假计时器与判定层用例。
- **acceptance**：
  ```sh
  node --test test/jobs-gate.test.js   # 退出码 0
  ```
  判定层断言覆盖：本轮 `running` → `suppressed:true` + `jobIds`；`startedAt < since`（常驻 job）→ `suppressed:false`；
  无 `turn/start` → `reason:'no-turn-start'`；`settle` 后推进计时器 → `deliver` **恰好 1 次**；
  多 job 需全部结算；`dispose()` 后推进计时器 → 0 次且无异常。
- **skipIntegration**：true（纯内存模块，无对外接口）。

### t3 接线：主链路插入闸门 + `ctx.inject(['jobs'])` + 补发通路

- **implementation**：`index.js` —— `createNotifier` 接受 `options.jobs/jobGraceMs/clock/timers` 并建闸门
  （`deliver` 接到 `dispatch(session, intent, now, {prompt})`）；`handle()` 里 `turn/start` → `noteTurnStart`，
  完成意图且非自动轮静默后再过闸门，抑制时返回 `{action:'dropped', reason:'job-running', intent, jobIds}`；
  `deliverToTarget` 用 `extra.prompt ?? prompts.take(session)`；`apply()` 增 `ctx.inject(['jobs'], jobCtx => jobCtx.effect(() => runtime.gate.attach(jobCtx.jobs)))`；
  `dispose` 顺序 = 先 `offJobs`/`detach`/清计时器，再清状态。补测试接线层用例。
- **acceptance**：
  ```sh
  node --test test/jobs-gate.test.js   # 退出码 0
  ```
  接线层断言覆盖：假 registry 注入下 `handle(turn/end)` → `action:'dropped'`/`reason:'job-running'` 且接收端 0 条；
  结算 + 推进宽限 → 接收端 **1** 条且与基线报文逐字段相等（忽略 `at`）；宽限内 `turn/start` → 0 条补发；
  `jobAwareComplete:false` 与不注入 `jobs` → `action:'sent'`。

### t4 迁移与兼容回归

- **implementation**：不改任何既有断言，跑全量并逐条核对两条降级路径（不注入 `jobs` / `jobAwareComplete:false`）
  与改动前行为一致；结果写入 `docs/requirements/REQ-261001202058-0fbe/tests/compat-report.md`。
- **acceptance**：
  ```sh
  node --test "test/*.test.js"   # 退出码 0；fail 0；tests ≥ 基线 241（只增不减）
  ```
  报告中逐条列出：既有 30 个测试文件未改断言（唯一改动 = `test/config.test.js` 标题文案）、
  降级路径与旧行为等价的证据（用例名 + 断言）。
- **skipIntegration**：true（回归卡，不新增对外接口）。

### t5 排障口径：`drop` 原因码进运维文档

- **implementation**：`docs/guides/operations.md` 的 `drop` 原因码表新增一行
  `job-running` →「本会话仍有本轮拉起、未结算的后台 job（完成通知延后到 job 结算）」；
  「通知没到：按这个顺序查」补一条指向该原因码。
- **acceptance**：
  ```sh
  grep -n 'job-running' docs/guides/operations.md   # 命中原因码表行，含义与 FR-6 一致
  ```
- **skipIntegration**：true（文档卡）。

### t6 端到端联调：真 HTTP 接收端

- **implementation**：仿 `test/e2e.local.test.js` 起真实 HTTP 接收端，在 `test/jobs-gate.test.js` 内串两条完整链路：
  ① `turn/start → 注册 running job → turn/end`（断言 0 条）`→ settle + 推进宽限`（断言 1 条，字段与基线一致）；
  ② `settle` 后宽限内开新轮次（断言 0 条补发）→ 新轮次 `turn/end`（断言 1 条）。报告写入 `tests/e2e-report.md`。
- **acceptance**：
  ```sh
  node --test test/jobs-gate.test.js   # 退出码 0
  ```
  两条链路的接收端条数与字段断言逐条通过（报文含 `version:1` / `event:'turn/end'` / 完成文案）。
- **depends_on**：t4（与其串行，避免两卡并发写同一测试文件）。

## 3. FR 覆盖对照

| 需求条款 | 条款内容 | 接收任务 | 验证落点 |
|---|---|---|---|
| FR-1 | 后台 job 未结算时不推完成通知 | t2, t3 | TC-3…TC-6（判定层 + 接线层） |
| FR-2 | 抑制范围只限本轮拉起的 job | t2 | TC-7…TC-9 |
| FR-3 | 最后一个被抑制的 job 结算后兜底补发 | t2, t3, t6 | TC-10…TC-14、e2e 链路 ①② |
| FR-4 | 开关与降级 | t1, t3, t4 | TC-1, TC-2, TC-15…TC-17 + t4 兼容报告 |
| FR-5 | 出站契约与既有报文不变 | t3, t6 | TC-18…TC-20、e2e 字段断言 |
| FR-6 | 抑制与补发可观测 | t3, t5 | TC-21、TC-22 + `docs/guides/operations.md` |

> 6 条条款全部有落点，无「本轮不做」项。

## 4. 风险与处置（与 design/architecture.md §9 一致）

| 风险 | 处置 |
|---|---|
| 宽限窗口内唤醒迟到 → 重复一条通知 | 接受；窗口经 `jobGraceMs` 可调（不新增界面配置） |
| `quiet` 模式下补发后下次回来再报一次 | 接受（两次之间隔着用户自己的动作） |
| 常驻 job 所在那一轮不补发 | 接受（与「活还没完」语义一致；FR-2 已防永久静音） |
| `turnStarts` 不在会话销毁时回收 | 接受（每条仅一个 number，与架构 §9 记账一致） |

## 5. 整体验收命令

```sh
node --test test/jobs-gate.test.js      # 新增用例：全绿
node --test test/config.test.js         # 配置契约：全绿（含既有 volatile 集合断言）
node --test "test/*.test.js"            # 全量：fail 0；tests ≥ 241
```
