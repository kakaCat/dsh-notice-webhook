# 实施评审报告 · REQ-261005120639-f801

> 评审对象：本需求全部代码改动（`src/jobs.js`、`index.js`、`test/jobs-gate.test.js`）与四份项目文档口径。
> 评审方式：逐卡复核（t1 复核子卡、t2 复核子卡、t4 复核子卡）+ 全量回归 + 现场口径复算。
> **结论：可以交付**（1 处实现缺陷已在复核中修复；无偏离设计项；2 条残余风险已明示）。

## 1. 评审范围与结论一览

| 范围 | 评审点 | 结论 |
|---|---|---|
| `src/jobs.js` 判定层 | 两路事实源、血缘口径、三态原因码、复检与兜底补发、降级与容错 | ✅ 通过（复核中修掉 1 处缺陷，见 §2） |
| `index.js` 接线层 | `ctx.inject(['agents'])`、`ctx.on('subagent/end')`、`handle()` 返回值、`dispose()` 摘线顺序 | ✅ 无偏离 |
| `test/jobs-gate.test.js` | 13 条新用例覆盖 FR-1…FR-6；2 处既有诊断码断言同步 | ✅ 通过（唯一既有断言改动） |
| 四份文档 | 与实现逐条对齐；旧口径清零 | ✅ 无偏离 |
| 出站/落盘/依赖 | 报文、配置键、落盘数据、第三方依赖、DSH 源码 | ✅ 零改动 |

## 2. 评审发现（1 处缺陷，已修复）

**缺陷**：子代理在宽限窗口内被再次唤醒（continuable 的新 epoch）时，原写法在计时器回调里**先
`pending.delete()` 再判断是否还有活**——一旦判断为「还有活」，这条被压住的完成通知就**永远不会再发**
（pending 已丢、没有第二次机会）。这是「静默丢通知」，比误报更严重。

**修复**：把「还有活 → 返回」提到 `pending.delete()` 之前，并把 `record.timer` 置回 `undefined`，
允许下一次 `subagent/end` 复检重新起窗口。

**回归锁定**：新增 `TC-S9`（宽限到点时子代理又忙起来：不补发、不丢 pending，下次复检仍能补发）。
同类防御也补在 `armGrace` 的 `watched.size > 0` 分支（同属"不可能但万一"的路径）。

## 3. 与设计的偏离

**无偏离。** 依据：

- 接口签名、成员与错误语义逐条对照 `design/interfaces.md` §1/§2；
- pending 记录字段、生命周期与清理对照 `design/data-model.md` §2/§3；
- 降级与开关对照 `design/architecture.md` §降级、§不变量；
- 时序场景对照 `design/use-cases.md` UC-1…UC-7（UC-1/UC-2 已由真 HTTP 接收端用例覆盖）。

两处**实现细化**（不改变对外语义，记录在案）：

1. 宽限到点时**再查一次**子代理存活（设计只写了"两路都空才补发"，这里是把它落到"到点这一刻"）；
2. `agents.list()` 运行期抛错的告警做了一次性抑制（沿用既有"降级不刷屏"口径）。

## 4. 评审证据（可复核）

```sh
node --test test/jobs-gate.test.js        # 38 / pass 38 / fail 0
node --test "test/*.test.js"              # 320 / pass 320 / fail 0（基线 307）
grep -rn "no-jobs" test/ src/             # 0 命中
grep -rn "只读 ctx.jobs" docs/architecture docs/guides   # 0 命中
python3 docs/requirements/REQ-261005120639-f801/repro-continuable-window.py   # 27 个误报窗口
```

不变式自检（`src/jobs.js`）：

- 无 `import` / `require`（零运行期依赖、不 import DSH 内部包）；
- 无 `cancel(` / `kill(` / `followup(`（只读事实源）；
- 无 `await`（判定同步，不阻塞会话）。

## 5. 残余风险（交付时明示）

| 风险 | 处置 |
|---|---|
| 子代理结算事件在某组合下收不到，且父会话始终未被唤醒 → 这次补发不发生 | 接受（有意不引入轮询）；父会话被唤醒时新轮次的 `turn/end` 会正常通知；该事件与 `session/event` 同一条派发路径 |
| 子代理卡在授权 / 长任务 → 父会话「已完成」长期被压住 | 接受（正是「还有活」的语义）；子代理自身界面可见 |
| `ctx.agents` 形状漂移（DSH 升级） | 形状不符即整路降级照发（`TC-S6` 锁定），不会误抑制 |
| 真机（重载插件后）未自动验证 | 已写明人工步骤（`verification.md` §六）；本窗口不自证 |

## 6. 评审结论

- 功能：FR-1…FR-6 全部实现且有可跑证据（`verification.md` §二）；
- 质量：全量回归只增不减、失败 0；唯一既有断言改动为 2 处内部诊断码；
- 兼容：三条降级路径与旧行为逐字一致（`tests/compat-report.md` §3）；
- 风险：2 条残余风险明示、均有缓解路径，不隐藏。

**建议：交付并进入人工验收。**
