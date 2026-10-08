# t-cbf2e4 实现 webhook 投递层

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
实现 webhook 投递层

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/deliver.test.js 全绿；用例含：本地接收端返回 200 → 判定成功且请求体含 version/event/message；指向 http://127.0.0.1:1/ → 判定失败且不抛异常；接收端返回 302 → 判定失败（不跟随重定向）；日志文本不含 URL 的 query 串

## 实施方案（implementation）
新增 src/deliver.js：用 Node 内置 fetch 发 POST JSON（带 Content-Type: application/json; charset=utf-8 与 webhookHeaders）；用 AbortSignal.timeout(timeoutMs) 控制超时；redirect 设为 'manual' 且把 3xx 判定为失败；仅对网络错误、5xx、超时按 retry 次数重试，4xx 不重试；所有分支包 try/catch，失败只写 logger.warn，日志只输出 new URL(url).host 不输出完整 URL 与 headers。

## 上游产出摘要（dependsSummary）
- 建立插件包骨架与配置层

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T05:51:44.584Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

这条路通了：通知真的能发出去，接收端慢或挂掉都不拖住会话；失败只留一条去敏日志，带凭据的地址不会进日志。

### 完成项

- 交付 src/deliver.js：POST JSON + 超时 + 有限重试 + 重定向不跟随 + 日志只记 host
- 子卡链三阶段全部完成：研发（落盘）+ 复核（对照出站契约无偏离）+ 测试（6/6 全绿）
- 验证限制（如实记录）：本卡只验证投递层本身；真实 Host 端到端推送见 t8/t9 卡

### 改动文件

- `src/deliver.js`
- `test/deliver.test.js`

---
