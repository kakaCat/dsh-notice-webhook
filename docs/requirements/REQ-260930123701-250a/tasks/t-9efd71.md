# t-9efd71 实现 goal 终态识别与去重·测试

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
实现 goal 终态识别与去重·测试

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/goal.terminal.test.js 全绿（含正文 20/20 与重复上报只推一条）

## 汇报 1（2026-09-30T06:11:39.069Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

测试段完成：十条用例全绿——目标终态一定叫得醒，重复上报不会重复吵。

### 完成项

- node --test test/goal.terminal.test.js 10/10 全绿
- 用例证据：TC-10 complete → goal/complete；TC-11 round-limit + maxGoalRounds=20 正文含 20/20；其他 code 含 code；同一 (goalId,revision,phase) 重复上报只推一条；paused 不推

---
