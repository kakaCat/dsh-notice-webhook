# t-33df5a RPC 追加 channelMeta / help / key

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
RPC 追加 channelMeta / help / key

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/rpc.read.test.js test/rpc.write.test.js 全绿：GET /state 含 channelMeta（六项、每项有 help.title/steps/docUrl）与目标 key；密钥仍只回 secretConfigured 布尔且响应不含密钥值；POST /targets 同传 key 与不一致 url→以 key 为准返回 200 且日志有 warn

## 实施方案（implementation）
src/rpc.js：buildState 的 targets[] 增 key；新增 channelMeta 投影（由 src/channels/meta.js 取 label/input/keyLabel/secret/help）；POST /targets 接受 key 并优先于 url（不一致时 warn）；错误信息按渠道 keyLabel 定制。验证：扩展 test/rpc.read.test.js 与 test/rpc.write.test.js。

## 上游产出摘要（dependsSummary）
- targets.json v2 与校验收口

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T14:33:06.879Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t5 完成：界面上「每个渠道该填什么、怎么拿」的文案与格式全部由后端下发——前端不再硬编码，改文案只需改一处；目标读取里也带上了 key。

### 完成项

- GET /state 增 channelMeta（六渠道 label/input/keyLabel/secret/help）与目标 key
- POST /targets 接受 key；同传 key 与不一致 url 时以 key 为准并记 warn（不返回 400，避免旧页面被打断）
- test/rpc.read.test.js 7/7 + rpc.write.test.js 8/8 全绿
- 独立进程走 profile 装载路径验证：/state 确回 channelMeta 六项与带 key 的目标

### 改动文件

- `src/rpc.js`
- `test/rpc.read.test.js`

---
