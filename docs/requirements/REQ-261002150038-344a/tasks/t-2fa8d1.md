# t-2fa8d1 自动轮静默：GoalTracker 认入 dive / plugin 注入轮·研发

> 需求：REQ-261002150038-344a 通知去噪：Dive 自动轮不推送 + 卡片删除重复的「类型」行

## 在做什么
自动轮静默：GoalTracker 认入 dive / plugin 注入轮·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`npx vitest run <本卡改动涉及的测试文件>` → 全绿；并附 `git diff --stat` 摘要

---
## 汇报 1（2026-10-02T07:07:56.839Z，窗口 session-eda4a33c-31bc-4d31-901d-5a9c640287bf）

这一步做完，Dive 自动续跑与插件注入的轮次不再被当成人工轮——完成通知不会再为自动跑响一次。

### 完成项

- src/goal.js 的 user/message 分支改调 isHumanSource（不再单点判断 kind === 'goal'）
- 轮次标记 sawGoal → sawInjected；isAutoRound 语义收敛为「见过注入且无人工」
- 无任何 user/message 的轮次不判自动轮（维持不静默）
- 类头注释记下本次修正的前因（Dive 每轮推「对话完成」的噪音）
- test/goal.auto.test.js 增 TC-6…TC-12，文件内导出 tracker 供断言
- node --test test/goal.auto.test.js → 13 passed / 0 failed

### 改动文件

- `src/goal.js`
- `test/goal.auto.test.js`

### 下一步

联调子卡：用真实 notifier 主链路灌一条 Dive 轮，确认 0 投递。

---
