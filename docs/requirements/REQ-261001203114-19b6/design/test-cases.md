---
title: 测试用例 · 会话异常中断通知（turn/end 按 reason 分类）
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 测试用例

> **TL;DR**：三类新增覆盖——**决策表单元**（`test/classify.test.js` 扩展）、**链路集成**（新增 `test/interrupt.test.js`，
> 复用既有「真实 HTTP 接收端 + `waitFor`」的写法断言报文字节）、**事件语义迁移**（新增 `test/targets-events.test.js`，临时目录 + 真文件读写）。
> 既有 244 用例中**只允许**改写「`error` 被当完成」相关断言；其余一字不动。

## 1. 注入缝与假件（serves: FR-1, FR-2, FR-5, FR-6）

| 缝 | 形态 | 用途 |
|---|---|---|
| 事件对象 | 直接构造 `{ type:'turn/end', data:{ turn, reason:{ kind, error? } } }` | 决策表与链路，无需真会话 |
| 会话对象 | `{ header: { id, cwd, … } }`（既有写法） | 顶层 / 嵌套判定 |
| 配置 | `normalizeConfig({ … })` 或 `createNotifier({ … })` 选项 | 开关与文案 |
| 目标清单 | `mkdtempSync()` + `TargetStore({ path })` | `eventsMode` 迁移与落盘断言 |
| 接收端 | 既有 `withReceiver()` / `waitFor()` 套路（`test/e2e.local.test.js`） | 断言出站报文字节 |

## 2. 决策表：8 种终态（serves: FR-1）

| 用例 | 输入 `reason` | 断言（可执行） |
|---|---|---|
| T2-1 | `{ kind: 'completed' }` | `kind === 'complete'`、`event === 'turn/end'`、正文 = `会话已完成` |
| T2-2 | `{ kind: 'error', error:{ code:'MALFORMED_RESPONSE', message:'DeepSeek Messages stream: tool input is invalid JSON' } }` | `kind === 'interrupt'`、`event === 'turn/error'`、`reason === 'error'`、`error.code === 'MALFORMED_RESPONSE'`；**且 `event !== 'turn/end'`** |
| T2-3 | `{ kind: 'interrupted' }` | `kind === 'interrupt'`、`reason === 'interrupted'`、`error === null`、正文**不含**括号后缀 |
| T2-4 | `{ kind: 'aborted', reason:{ kind:'user' } }` | `classify(...) === null`；`silentReasonOf(...).reason === 'turn-aborted'`（**aborted 判定排在静默名单之前**，否则该码不可达） |
| T2-5 | `{ kind: 'blocked' }` | `classify(...) === null`；`silentReasonOf(...).reason === 'turn-not-notifiable'` |
| T2-6 | `{ kind: 'max-tokens' }` | 同 T2-5 |
| T2-7 | `{ kind: 'forked' }` | 同 T2-5 |
| T2-8 | `{ kind: 'brand-new-kind' }` / `{}` / `{ kind: 42 }` | 三者都 → `kind === 'interrupt'`；非字符串 kind 时 `reason === 'unknown'`；**都不得产出 `turn/end`** |

## 3. 静默名单优先与开关（serves: FR-1, FR-4）

| 用例 | 配置 | 断言 |
|---|---|---|
| T3-1 | 默认配置 + `{ kind:'interrupted' }` | **推送**中断（证明默认值已从 `['interrupted','aborted']` 变为 `['aborted']`） |
| T3-2 | `skipReasons: ['error']` + `{ kind:'error' }` | `classify(...) === null`、`silentReasonOf(...).reason === 'turn-skipped'`；链路 0 条报文 |
| T3-3 | `notifyInterrupt: false` + `{ kind:'error' }` | 路由丢弃、**0 条报文**；且**不得**出现 `event:'turn/end'`（谎报回归锁） |
| T3-4 | `notifyInterrupt: false` + 会话绑定非空 | 绑定**不豁免**类型开关（命中绑定也 0 条） |
| T3-5 | `skipReasons: ['aborted']` 且 `notifyInterrupt: true` | `{ kind:'completed' }` 仍推完成（开关互不串扰） |

## 4. 出站报文字节（serves: FR-2, FR-3）

| 用例 | 断言 |
|---|---|
| T4-1 | `custom` 目标收到 `event:'turn/error'`、`version === 1`、`reason:'error'`、`error.code` 与 `error.message` 逐字等于输入 |
| T4-2 | `error.message` 含换行 / 超长（300 字符）→ 报文里已单行化且长度 ≤200 |
| T4-3 | `{ kind:'error', error:{} }` / `error.message` 非字符串 → `code === 'UNKNOWN'`、`error.message === ''`；**不抛异常** |
| T4-4 | 正文形如 `修复登录 bug · 会话异常中断（MALFORMED_RESPONSE）`；`includeTitle:false` 时只剩 `会话异常中断（MALFORMED_RESPONSE）` |
| T4-5 | **回归锁**：`{ kind:'completed' }` 的 `custom` 报文键集合**不含** `reason` / `error`（逐字节等于改动前） |
| T4-6 | `EventMeta('turn/error').title === '⚠️ 会话中断'`、`color === 'red'` |

## 5. 自动轮与静默留痕（serves: FR-4, FR-6）

| 用例 | 场景 | 断言 |
|---|---|---|
| T5-1 | goal 自动轮（整轮无人工输入）+ `{ kind:'error' }` | **照常推送**中断（不被 autoRound 静默） |
| T5-2 | goal 自动轮 + `{ kind:'completed' }` | `handle()` 返回 `{ action:'silent' }`、0 条报文（既有语义不回归） |
| T5-3 | `{ kind:'blocked' }` 走 `handle()` | 返回 `{ action:'dropped', reason:'turn-not-notifiable' }` + 一条 debug 日志含 kind |
| T5-4 | 非 `turn/end` 事件（如 `step/start`） | 返回 `{ action:'ignored' }`（既有语义不变） |

## 6. 事件语义迁移（serves: FR-5）

| 用例 | 输入记录 | 断言 |
|---|---|---|
| T6-1 | `events: []`（无 mode） | 归一化为 `{ events: [], eventsMode: 'all' }` |
| T6-2 | `events: ['turn/end','ask_user_question','approval/asked','goal/*']`（无 mode） | 归一化为 `{ events: [], eventsMode: 'all' }`（老「全选」兼容） |
| T6-3 | `events: []` + `eventsMode: 'explicit'` | **保持** `events: []` + `'explicit'`（不升级为 all） |
| T6-4 | `events: [四项]` + `eventsMode: 'explicit'`（新界面取消勾选「会话中断」） | **保持四项 + explicit**；`targetAccepts(target,'turn/error') === false`（用户关得掉） |
| T6-5 | `events: ['turn/end']`（无 mode） | 归一化为 `explicit` + 一项（尊重子集选择） |
| T6-6 | 同一记录归一化两次 | 结果**幂等** |
| T6-7 | 写入后读文件 | `version === 3`（**未升版本**）、记录含 `eventsMode`、既有字段一字未改 |
| T6-8 | 模拟旧版本读取（按白名单只取已知字段） | `events` 仍可用、不抛异常（回滚可读） |
| T6-9 | `eventsMode: 'explicit'` 且 `events: []` + 目标级过滤 | `targetAccepts` 对**所有**事件（含 `turn/error`、`turn/end`、`goal/*`）返回 `false`（显式空 = 什么都不收，语义自洽） |
| T6-10 | `EVENT_TYPES.includes('turn/error') === true` 且既有四项仍在 | 校验器对新取值放行（否则存不进目标） |
| T6-11 | `eventsMode: 'all'` 且 `events` 被构造成非空（绕过归一化的外部输入） | `targetAccepts` 仍返回 `true`（mode 说了算） |
| T6-12 | **mode 缺省** + `events: []` / `events: [四项]` / `events: ['turn/end']` | 与改动前逐字一致（空 = 全收；非空 = 白名单）——既有 244 用例的回归保护 |

## 7. 用例与 FR 的对应（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

| FR | 用例 |
|---|---|
| FR-1 | T2-1…T2-8、T3-1、T3-2 |
| FR-2 | T2-2、T2-3、T4-1…T4-4 |
| FR-3 | T4-1、T4-5、T4-6、T3-3 |
| FR-4 | T3-3、T3-4、T3-5、T5-1、T5-2 |
| FR-5 | T6-1…T6-12 |
| FR-6 | T2-4…T2-7、T3-2、T5-3 |

## 8. 验收命令与期望输出（serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6）

```sh
# 全量回归：期望 tests ≥ 244+新增、pass 全部、fail 0（改动前基线 244/244）
node --test "test/*.test.js"

# 决策表现场对照：error/interrupted/未知 必须是 interrupt，aborted/blocked/max-tokens/forked 必须是 null
node -e "import('./src/classify.js').then(async m=>{const {normalizeConfig}=await import('./src/config.js');const c=new m.Classifier(normalizeConfig({}));const s={header:{}};for(const k of ['completed','error','interrupted','aborted','blocked','max-tokens','forked','weird'])console.log(k,'=>',JSON.stringify(c.classify(s,{type:'turn/end',data:{reason:{kind:k,error:k==='error'?{message:'DeepSeek Messages stream: tool input is invalid JSON',code:'MALFORMED_RESPONSE'}:undefined}}})))})"

# 迁移：老「全选」记录读入后应变成 events: [] + eventsMode: 'all'
node --test test/targets-events.test.js
```

**期望**：`error → {"kind":"interrupt","event":"turn/error",…}`；`aborted/blocked/max-tokens/forked → null`；
`weird → interrupt`（未知终态不谎报）；全量 `fail 0`、用例数只增不减。
