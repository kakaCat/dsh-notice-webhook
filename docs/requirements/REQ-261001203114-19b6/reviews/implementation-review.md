---
title: 实施评审报告 · 会话异常中断通知
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 实施评审报告

> **结论**：实现与已确认的设计逐项一致；评审期内**发现并修复 1 处真实回归**（`targetAccepts` 的 explicit 分支漏 `goal/*` 通配）
> 与 **1 处语义瑕疵**（判定顺序让 `turn-aborted` 永不可达）。无未决问题，无静默降级。

## 1. 评审范围与方法

| 项 | 做法 |
|---|---|
| 契约一致性 | 逐条对照 `design/interfaces.md`（意图形状、常量、开关、报文字段）与 `design/data-model.md`（eventsMode 判定式、配置默认值） |
| 行为正确性 | 跑 `test/classify.test.js`、`test/interrupt.test.js`、`test/targets-events.test.js`；探针命令见 `tests/verification-report.md` |
| 回归风险 | 全量 `node --test --test-timeout=30000 "test/*.test.js"`（288 例）+ 逐条核对 7 条不变量 |
| 迁移/回滚 | 见 `tests/compat-report.md`（三条兼容路径 + 回滚可读） |
| 范围纪律 | 核对未触碰 `src/jobs.js`、`src/goal.js`、`src/deliver.js`、`src/rpc.js`、五个非 custom 渠道与 `package.json` |

## 2. 评审发现（全部已闭环）

### 2.1 【已修·回归】`targetAccepts` 的 explicit 分支漏掉 `goal/*` 通配

- **现象**：新分支只做 `events.includes(event)`，于是「勾了目标终态（`goal/*`）」的目标在 `goal/complete`、`goal/blocked`
  上被判为**不收**——等于把一类既有通知弄丢了。
- **发现方式**：既有用例 `test/router.filter.test.js` 的 TC-9 当场失败（不是靠人肉读代码）。
- **修复**：抽出单一匹配函数 `listedEventMatches(events, event)`（精确命中 + `goal/*` 覆盖 goal 终态），
  `explicit` / 缺省两条通路共用；`all` 直接放行。
- **教训（已进 architecture 文档「踩过的坑」）**：过滤规则只能有一份实现，新分支要复用旧分支的**全部**语义。

### 2.2 【已修·可观测性】判定顺序让 `turn-aborted` 永远不可达

- **现象**：`aborted` 默认就在 `skipReasons` 里，而静默名单排在特例之前 → 专用原因码 `turn-aborted` 永远走不到，
  排障时看到的是笼统的 `turn-skipped`。
- **修复**：把 `aborted` 判定提到第 1 条（行为不变：两种码都是「不推送」）；设计与测试用例文档同步修订。
- **教训（已进 architecture 文档）**：判定顺序是语义的一部分，**更具体的原因**必须排在**更宽泛的名单**之前。

### 2.3 【已确认·非缺陷】全量并发下一次 60s 等待超时

- **现象**：全量并发跑时 `test/e2e.multi.test.js` 的「五类事件」用例出现过一次 60s 等待超时。
- **核查**：单文件复跑 **39ms 全绿**；同批次另有窗口在同一仓库跑重负载用例（`test/jobs-gate.test.js`，24KB）。
- **结论**：资源竞争导致的偶发，与本需求改动无关（该用例目标 `events: []` → 归一化后为全收，不经过任何新过滤分支）；
  已在 `tests/verification-report.md` 如实记录，不静默放过。

### 2.4 【已记账】需求 FR-5 措辞 vs 设计机制

- 需求写「不改文件格式」，设计精确化为「不升 `version`，单条记录追加可选字段 `eventsMode`」。
  评审确认：改动是**纯追加**，旧版本按白名单读取时该字段不可见、`events: []` 在旧语义里同样是全收 → 回滚安全。
  偏差在设计与验收报告中均已记账。

## 3. 不变量复核（design/architecture.md §4）

| 不变量 | 结论 | 依据 |
|---|---|---|
| I1 `error`/未知终态永不产出 `turn/end` | ✅ | T4-1 断言接收端不存在 `event === 'turn/end'` |
| I2 非中断意图报文逐字节不变 | ✅ | T4-5 断言完成报文不含 `reason`/`error` |
| I3 分类是纯函数、不抛 | ✅ | T2-8 四种畸形输入 |
| I4 `targets.json` 版本不变、仅追加可选字段 | ✅ | T6-7 断言 `version === 3` |
| I5 `blocked`/`max-tokens`/`forked` 不推也不谎报 | ✅ | E1/E2 + T5-3 |
| I6 `autoRound` 静默只对完成生效 | ✅ | T5-1 / T5-2 |

## 4. 残留风险与后续（不阻塞本次验收）

| # | 风险 | 处置 |
|---|---|---|
| R1 | 只认 `turn/end` 的老接收端收不到中断通知 | 方案固有代价（D1 人已裁决）；README 明示，接收端按 `turn/error` 分流即可 |
| R2 | `blocked`/`max-tokens`/`forked` 本次不推送 | 已写进需求边界；要推需引入按 kind 的开关与文案矩阵（届时升级重档） |
| R3 | 子卡阶段模板给的是 `npx vitest run` / `pnpm test` 验收口径，本仓库实际用 `node --test` | 本次按仓库真实命令执行并留证；建议后续在 pmboard 的任务阶段模板里按仓库声明测试命令，避免误导 |

## 5. 评审结论

实现与设计一致、缺陷已闭环、证据可复核。**同意提交验收**；验收通过后按 feature 归档路径合并结论
（`docs/architecture/notification-plugin.md` 决策 8 与 `docs/guides/operations.md` 原因码表已在实施期同步写入）。
