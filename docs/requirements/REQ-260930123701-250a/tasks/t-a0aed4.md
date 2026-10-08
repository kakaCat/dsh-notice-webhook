# t-a0aed4 接线整合与本地端到端联调·联调

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
接线整合与本地端到端联调·联调

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/e2e.local.test.js 全绿：本地接收端收到 5 类 event 各 1 条

## 汇报 1（2026-09-30T06:21:13.889Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

联调段完成：五类通知在真实 HTTP 上端到端跑通，字段与契约一致；接收端挂掉也不会让会话或进程出问题。

### 完成项

- 联调证据：起真实本地 HTTP 接收端，按序收到 turn/end、approval/asked、ask_user_question、goal/complete、goal/blocked 五类 event 各一条
- 逐字段核对 payload：version/title/toolName/goal/sessionId/workspace/source/at 全部符合 interfaces.md 契约
- goal/blocked 正文实测包含「轮次耗尽」，goal.round === 20
- 失败隔离联调：地址指向 127.0.0.1:1 时只留 warn，测试进程退出码 0

---
