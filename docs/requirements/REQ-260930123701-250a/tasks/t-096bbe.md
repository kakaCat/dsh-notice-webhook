# t-096bbe 实现 goal 自动轮识别与静默·研发

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
实现 goal 自动轮识别与静默·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/goal.auto.test.js 全绿

## 汇报 1（2026-09-30T05:55:19.883Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：goal 自动跑轮不再逐轮吵人；但你在跑轮中间插话的那一轮照常通知——人在旁边不会漏响。

### 完成项

- 落地 src/goal.js 自动轮部分：读 user/message 的 source.kind 维护本轮标记
- isAutoRound 判定「本轮全部为 goal 注入」；endRound 每轮清空
- node --test test/goal.auto.test.js 6/6 通过（含人工插话放行、无 goal 会话零回归）

### 改动文件

- `src/goal.js`
- `test/goal.auto.test.js`

---
