---
title: 拆分计划 · 会话异常中断通知（turn/end 按 reason 分类）
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 拆分计划

> **目标**：agent 因模型流报错（如 `tool input is invalid JSON`）或崩溃中断而停下时，用户收到一条**「会话异常中断（错误码）」**；
> 且**再也不会**在 `error` / `interrupted` / 未知终态上收到假的「会话已完成」。
>
> **做法**：把 `turn/end` 的二值判定换成一张**终态分类表**（纯函数 `decideTurnEnd`，7 行判定顺序）；中断走新出站取值
> `turn/error` 并追加 `reason` / `error` 两个键（`version` 仍 1，**非中断报文逐字节不变**）；新增 `notifyInterrupt` 开关与
> `interruptMessage` 文案，`skipReasons` 默认改 `['aborted']` 且语义收紧为「静默名单」；`targets.json` **不升版本**，
> 仅追加可选字段 `eventsMode`（`all` / `explicit`）并让 `targetAccepts` 按 mode 判定——解决「UI 默认全选写成显式四项 →
> 新事件到不了任何既有目标」与「用户取消勾选却关不掉」两个问题。
>
> **一句话验收**：`node --test "test/*.test.js"` 退出码 0（基线 `tests 244 / pass 244 / fail 0`，用例只增不减），
> 且新增用例覆盖「8 种终态决策表 / 不再谎报完成 / 中断报文字节 / 开关与静默名单 / 自动轮不静默 / eventsMode 迁移」。

## 1. 改动盘点（对照 7 份设计文档）

### 1.1 新增文件

| 文件 | 内容 | 规格来源 |
|---|---|---|
| `test/interrupt.test.js` | 链路集成：真 HTTP 接收端 + `handle()` 灌 `turn/end`（8 种终态）+ 报文断言（T4-*、T5-*） | design/test-cases.md §4、§5 |
| `test/targets-events.test.js` | `eventsMode` 归一化 / 幂等 / 版本不变 / 回滚可读（T6-*） | design/test-cases.md §6 |
| `docs/requirements/REQ-261001203114-19b6/tests/` | 回归与联调报告（t9 产出） | 既有需求目录惯例 |

### 1.2 修改文件

| 文件 | 改动 | 规格来源 |
|---|---|---|
| `src/classify.js` | 新增 `KNOWN_TURN_KINDS` / `INTENT_INTERRUPT` / `EVENT_TURN_ERROR` / `decideTurnEnd()` / `silentReasonOf()` / `errorFacts()`；`turn/end` 分支改查表 | design/interfaces.md §1、§2 |
| `src/config.js` | `notifyInterrupt` / `interruptMessage` 新增，`skipReasons` 默认值变更（`DEFAULTS` / `BOOLEAN_KEYS` / `STRING_KEYS` / schema / `VOLATILE_KEYS` 五处同进同出） | design/interfaces.md §5 |
| `src/router.js` | `isTypeDisabled()` 与废弃 `route()` **两处**加中断开关分支；`targetAccepts()` 按 `eventsMode` 判定 | design/interfaces.md §3 |
| `src/channels/custom.js` | `buildPayload()` 仅对中断意图追加 `reason` / `error` | design/interfaces.md §6 |
| `src/payload.js` | `EVENT_META` 增 `'turn/error'` | design/interfaces.md §6 |
| `src/targets.js` | `EVENT_TYPES` 追加 `'turn/error'`；新增 `LEGACY_ALL_EVENTS` / `normalizeEvents()`；`validateTarget()` 输出补 `eventsMode` | design/data-model.md §2 |
| `index.js` | `handle()` 的 `intent === null` 分支改走 `silentReasonOf()` 留痕；`autoRound` 静默分支保持只对完成生效 | design/backend.md §6 |
| `client.js` | `EVENTS` 追加「会话中断」；`save()` 提交 `events` + `eventsMode`（全勾 → `[]` + `all`） | design/frontend.md §1、§2 |
| `README.md` | 「推送契约」`event` 枚举 + `reason`/`error` 字段；配置项表两个新键；`skipReasons` 默认值变更与接收端兼容说明 | design/interfaces.md §5、§6 |
| `docs/architecture/notification-plugin.md` | 事件分类表补中断一行 | design/architecture.md §1 |
| `docs/guides/operations.md` | `drop` 原因码表补 `turn-skipped` / `turn-aborted` / `turn-not-notifiable` | design/backend.md §7 |
| `test/classify.test.js` | 扩展 8 种终态决策与静默码断言；**改写**「`error` 当完成」的既有期望 | design/test-cases.md §2、§3 |

### 1.3 明确不改（写进不变量，回归靠既有测试）

`src/goal.js`、`src/deliver.js`、`src/bindings.js`、`src/outcomes.js`、`src/rpc.js`、`src/service.js`、`src/channels/{wecom,feishu,dingtalk,slack,discord}.js`、
`src/channels/index.js`、`src/channels/meta.js`、`package.json`（**不新增依赖**）、
`targets.json` 的 `version`（保持 3）、`bindings.json` 格式、出站 `version`（保持 1）、RPC 与 `payload` 字段投影、
`TARGET_FILE_VERSION` 的版本闸门逻辑、授权/提问/goal 三类通知。

## 2. 任务表

| key | 标题 | phase | side | 依赖 | 说明 |
|---|---|---|---|---|---|
| t1 | 分类契约：`turn/end` 终态决策表（纯函数） | implement | backend | — | `src/classify.js` 唯一真相：7 行顺序 + error 事实提取 |
| t2 | 数据契约：目标事件语义 `eventsMode` 与事件清单 | implement | backend | — | `src/targets.js`：`EVENT_TYPES` + 归一化纯函数 |
| t3 | 接线：开关、类型过滤与静默留痕 | implement | backend | t1, t2 | `config.js` + `router.js` + `index.js` 三处缝在一起 |
| t4 | 出站报文：中断意图的 `reason` / `error` 与事件元数据 | implement | backend | t1 | `channels/custom.js` + `payload.js`，非中断报文零变化 |
| t5 | 前端：设置页「关心事件」与保存语义 | ui | frontend | t2 | `client.js` 两处；全勾折成全收 |
| t6 | 迁移与兼容（单列）：老记录归一化 + 版本不变 + 回滚可读 | test | backend | t2, t3 | 旧数据 / 旧客户端 / 旧版本读新文件三条路径 |
| t7 | 测试：决策表 / 链路集成 / 迁移三套用例 | test | fullstack | t1, t2, t3, t4, t5 | 新增两个净室文件 + 扩展 `classify.test.js` |
| t8 | 文档同步：报文契约、事件分类表、排障原因码 | doc | doc | t1, t3, t4, t6 | README + architecture + operations |
| t9 | 需求级自检：逐条 FR 对照可跑命令并汇总证据 | test | fullstack | t7, t8 | 产出 `tests/` 报告，供验收阶段直接引用 |

**依赖图**：

```
t1 ─┬─▶ t4 ─────────────┐
    │                   │
t2 ─┼─▶ t5 ─────────────┤
    │                   ├─▶ t7 ──▶ t9
    └─▶ t3 ─┬─▶ t6 ─────┤
            │           │
            └───────────┴─▶ t8 ──▶ t9
```

**为什么这样切**：数据契约（t2）与分类契约（t1）**先行且互不依赖**——它们分别定义了「事件怎么分类」与「目标怎么过滤」；
接线（t3）是唯一把配置、路由、留痕缝在一起的卡；出站报文（t4）只依赖分类契约，可与接线并行；
前端（t5）只依赖数据契约；迁移兼容（t6）按类型档要求**单列**；测试（t7）在五张实现卡之后统一收口；
文档（t8）与需求级自检（t9）各自独立收尾。

### 2.3 覆盖对照表（需求条款 ↔ 接收任务）

| 需求条款 | 要求摘要 | 接收任务 |
|---|---|---|
| FR-1 | `turn/end` 终态按 kind 分类，禁止兜底成「完成」 | t1、t3 |
| FR-2 | 中断意图的内容与错误事实（`code` / `message` 单行化 + 限长） | t1、t4 |
| FR-3 | 出站新增 `event` 取值 `turn/error`（`version` 仍 1） | t4、t8 |
| FR-4 | 开关、文案与静默名单（`notifyInterrupt` / `interruptMessage` / `skipReasons`） | t3、t7 |
| FR-5 | 配置面与文档同步（`EVENT_TYPES` / 设置页 / `eventsMode` 迁移） | t2、t5、t6、t8 |
| FR-6 | 可观测与回归（静默留痕、基线 244 只增不减） | t3、t7、t9 |

> **无「本轮不做」条款**：6 条 FR 全部有任务卡落点；两处设计偏差（`eventsMode` 追加字段、静默码收敛）已在
> [design/architecture.md §8](design/architecture.md) 记账，由 t8 同步进项目文档，由 t9 核对。

### t1 分类契约：`turn/end` 终态决策表（纯函数）

- **implementation**：`src/classify.js` —— 新增冻结常量 `KNOWN_TURN_KINDS`（7 种终态）、`INTENT_INTERRUPT = 'interrupt'`、
  `EVENT_TURN_ERROR = 'turn/error'`；新增纯函数 `decideTurnEnd(reason, skipReasons)`（按 design/architecture.md §1 的 7 行顺序，
  `reason.kind` 非字符串/空 → `'unknown'`，长度 > 40 → 截断）、`silentReasonOf()`、`errorFacts()`（`code` 缺省 `UNKNOWN`，
  `message` 单行化 + `slice(0,200)`）；`Classifier.classify()` 的 `turn/end` 分支改为查表并组装中断意图
  （`{ kind, event:'turn/error', message, toolName:null, reason, error }`）。**不得**保留任何「默认当完成」的兜底分支。
- **acceptance**：
  ```sh
  node --test test/classify.test.js     # 退出码 0
  node -e "import('./src/classify.js').then(async m=>{const {normalizeConfig}=await import('./src/config.js');const c=new m.Classifier(normalizeConfig({}));const s={header:{}};for(const k of ['completed','error','interrupted','aborted','blocked','max-tokens','forked','weird'])console.log(k,'=>',JSON.stringify(c.classify(s,{type:'turn/end',data:{reason:{kind:k,error:k==='error'?{message:'a\nb',code:'MALFORMED_RESPONSE'}:undefined}}})))})"
  # 期望：completed→complete/turn/end；error/interrupted/weird→interrupt/turn/error；aborted/blocked/max-tokens/forked→null
  # 且 error 的 error.message === 'a b'（单行化）
  ```
- **skipIntegration**：true（纯函数，无对外接口可联调）。

### t2 数据契约：目标事件语义 `eventsMode` 与事件清单

- **implementation**：`src/targets.js` —— `EVENT_TYPES` 追加 `'turn/error'`（既有四项顺序不变）；新增 `LEGACY_ALL_EVENTS`
  与纯函数 `normalizeEvents(events, mode)`（判定式按 design/data-model.md §2，幂等）；`validateTarget()` 读取 `input.eventsMode`
  （值域 `all` / `explicit`，其它视为缺省）、未知事件**仍按既有规则报错**、输出补 `eventsMode`。
  `TargetStore.#persist()` 与版本闸门**零改动**。
- **acceptance**：
  ```sh
  node -e "import('./src/targets.js').then(m=>{console.log(m.EVENT_TYPES.includes('turn/error'),JSON.stringify(m.normalizeEvents(['turn/end','ask_user_question','approval/asked','goal/*'],undefined)),JSON.stringify(m.normalizeEvents([],'explicit')),JSON.stringify(m.normalizeEvents(['turn/end'],undefined)))})"
  # 期望：true {"events":[],"eventsMode":"all"} {"events":[],"eventsMode":"explicit"} {"events":["turn/end"],"eventsMode":"explicit"}
  node --test test/targets.test.js test/config.test.js     # 退出码 0
  ```
- **skipIntegration**：true（纯数据契约，无对外接口）。

### t3 接线：开关、类型过滤与静默留痕

- **implementation**：`src/config.js` 五处登记（`DEFAULTS.notifyInterrupt = true` / `interruptMessage = '会话异常中断'` /
  `skipReasons = ['aborted']`、`BOOLEAN_KEYS`、`STRING_KEYS`、schema、`VOLATILE_KEYS`）；
  `src/router.js` —— `isTypeDisabled()` 与废弃 `route()` **两处**加中断开关分支，`targetAccepts()` 按 `eventsMode` 判定
  （`explicit` 严格白名单、`all` 全收、**缺省逐字保持旧口径**）；
  `index.js` —— `handle()` 的 `intent === null` 分支改为 `silentReasonOf()` + debug 日志 + `{ action:'dropped', reason, turnKind }`；
  `autoRound` 静默分支**逐字不动**（只对完成意图生效）。
- **acceptance**：
  ```sh
  node -e "import('./src/config.js').then(m=>{const c=m.Config({});console.log(c.notifyInterrupt.get(),m.VOLATILE_KEYS.includes('notifyInterrupt'),JSON.stringify(c.skipReasons.get()),c.interruptMessage.get())})"
  # 期望：true true ["aborted"] 会话异常中断
  node -e "import('./src/router.js').then(m=>{const t={events:[],eventsMode:'explicit'};const a={events:[],eventsMode:'all'};const l={events:[]};const R=new m.Router({notifyInterrupt:false,notifyComplete:true,notifyApproval:true,notifyQuestion:true});console.log(m.targetAccepts(t,'turn/error'),m.targetAccepts(a,'turn/error'),m.targetAccepts(l,'turn/error'),R.isTypeDisabled({kind:'interrupt'}))})"
  # 期望：false true true true
  node --test test/config.test.js test/router.filter.test.js test/router.test.js    # 退出码 0
  ```
- **skipIntegration**：false（本卡是链路接线，t7 会在其上做端到端）。

### t4 出站报文：中断意图的 `reason` / `error` 与事件元数据

- **implementation**：`src/channels/custom.js` 的 `buildPayload()` —— 仅当 `intent.kind === 'interrupt'` 时追加
  `reason: intent.reason` 与 `error: intent.error ?? null`（其余事件键集合**逐字节不变**）；
  `src/payload.js` 的 `EVENT_META` 增 `'turn/error': { title: '⚠️ 会话中断', color: 'red' }`；五个渠道适配器零改动。
- **acceptance**：
  ```sh
  node -e "import('./src/channels/custom.js').then(m=>{const b=m.buildPayload({intent:{kind:'interrupt',event:'turn/error',message:'x',reason:'error',error:{code:'MALFORMED_RESPONSE',message:'m'}},session:{},title:null,now:0,contextText:null});const c=m.buildPayload({intent:{kind:'complete',event:'turn/end',message:'y'},session:{},title:null,now:0,contextText:null});console.log(JSON.stringify(b.reason),JSON.stringify(b.error),Object.keys(c).includes('reason'),c.version)})"
  # 期望："error" {"code":"MALFORMED_RESPONSE","message":"m"} false 1
  node --test test/payload.test.js test/channels.meta.test.js     # 退出码 0
  ```
- **skipIntegration**：true（纯报文组装，无接口可联调）。

### t5 前端：设置页「关心事件」与保存语义

- **implementation**：`client.js` —— `EVENTS` 在「对话完成」之后插入 `{ id:'turn/error', label:'会话中断', field:'turn/error' }`；
  `save()` 计算 `allChecked`（勾选集合 == `EVENT_IDS`）→ 全勾提交 `{ events: [], eventsMode: 'all' }`，否则提交
  `{ events: <勾选>, eventsMode: 'explicit' }`；`selectTarget()` 回显口径不变（空 = 全勾），仅补注释。
  不改布局 / 样式 / 图标 / `renderTargetPicker` 契约。
- **acceptance**：
  ```sh
  node --test test/client-render.test.js test/client-service.test.js test/client-hooks.test.js   # 退出码 0
  grep -c "turn/error" client.js    # ≥ 2（EVENTS 项 + 保存判定可见）
  ```
  且断言：`EVENT_IDS.length === 5`；全勾时提交载荷为 `{events: [], eventsMode: 'all'}`；取消勾选「会话中断」后为
  `{events:[4 项], eventsMode:'explicit'}`。
- **skipIntegration**：true（前端清单与提交载荷，无跨进程接口）。
- **side**：frontend。

### t6 迁移与兼容（单列）

- **implementation**：核对并锁定三条路径——① **老记录**（`events` 恰为 `LEGACY_ALL_EVENTS` 且无 mode）载入后归一化为
  `{events: [], eventsMode:'all'}`，老目标开箱即收中断；② **老客户端**（提交显式四项、无 mode）推断为全收；③ **旧版本读新文件**：
  按白名单只取已知字段，忽略 `eventsMode`、`events: []` 在旧语义里同样是全收，文件 `version` 仍为 3。
  结果写入 `docs/requirements/REQ-261001203114-19b6/tests/compat-report.md`。
- **acceptance**：
  ```sh
  node --test test/targets-events.test.js    # 退出码 0（T6-1…T6-12 全绿）
  node -e "import('./src/targets.js').then(m=>{console.log(JSON.stringify(m.normalizeEvents(undefined,'explicit')),m.TARGET_FILE_VERSION)})"
  # 期望：{"events":[],"eventsMode":"explicit"} 3
  ```
  且新写入的文件里**每条记录**含 `eventsMode`，`version === 3`，既有字段值一字未改。
- **skipIntegration**：true（文件读写与纯函数，无接口）。

### t7 测试：决策表 / 链路集成 / 迁移三套用例

- **implementation**：扩展 `test/classify.test.js`（T2-*、T3-*：8 种终态、静默码、`skipReasons` 优先、开关不串扰；
  **改写**既有「`error` 当完成」的期望为中断）；新增 `test/interrupt.test.js`（复用 `test/e2e.local.test.js` 的
  `withReceiver()` / `waitFor()`，覆盖 T4-1…T4-6、T5-1…T5-4：报文字节、单行化与截断、自动轮不静默、静默留痕）；
  新增 `test/targets-events.test.js`（T6-1…T6-12）。既有 244 用例中**只允许**改动上一条所述断言。
- **acceptance**：
  ```sh
  node --test "test/*.test.js"    # fail 0，tests ≥ 244 + 新增（只增不减）
  node --test test/interrupt.test.js test/targets-events.test.js    # 退出码 0
  ```
- **skipIntegration**：false（本卡就是端到端联调所在）。

### t8 文档同步：报文契约、事件分类表、排障原因码

- **implementation**：`README.md` —— 「推送契约」`event` 枚举补 `turn/error` 与 `reason` / `error` 字段示例、
  配置项表补 `notifyInterrupt` / `interruptMessage` 与 `skipReasons` 默认值变更（含「只认 `turn/end` 的老接收端收不到中断」的明示）、
  「关心的时刻」表格补一行；
  `docs/architecture/notification-plugin.md` 的事件分类表补中断一行；
  `docs/guides/operations.md` 的 `drop` 原因码表补 `turn-skipped` / `turn-aborted` / `turn-not-notifiable` 与排查步骤。
- **acceptance**：
  ```sh
  grep -n "turn/error" README.md docs/architecture/notification-plugin.md    # 三份文档各至少 1 处命中
  grep -n "turn-not-notifiable" docs/guides/operations.md README.md          # 原因码已登记
  ```
- **skipIntegration**：true（纯文档）。

### t9 需求级自检：逐条 FR 对照可跑命令并汇总证据

- **implementation**：按 [test-cases.md §8](design/test-cases.md) 逐条跑，产出
  `docs/requirements/REQ-261001203114-19b6/tests/verification-report.md`（每条 FR 一行：命令 + 输出摘要 + 结论），
  并核对 7 条不变量 I1–I6（architecture §4）与两处设计偏差是否已在文档中如实记录。
- **acceptance**：
  ```sh
  node --test "test/*.test.js"     # fail 0；tests ≥ 244
  test -f docs/requirements/REQ-261001203114-19b6/tests/verification-report.md && echo ok
  ```
  报告须覆盖 FR-1…FR-6，且每条带一条**真实命令**与**实际输出摘要**。
- **skipIntegration**：false（需求级端到端自检）。
