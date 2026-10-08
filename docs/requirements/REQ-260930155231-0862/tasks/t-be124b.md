# t-be124b 实现渠道注册表与三国内渠道

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
实现渠道注册表与三国内渠道

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/channels.cn.test.js 全绿：企微/飞书/钉钉报文形状与加签串正确，isSuccess(200,{errcode:310000}) 判失败并带平台 errmsg

## 实施方案（implementation）
新增 src/channels/index.js：channel→adapter 注册表，未知渠道返回 {error} 不抛异常；新增 wecom.js（msgtype=markdown）、feishu.js（msg_type=text，可选 timestamp+sign 进 body）、dingtalk.js（msgtype=markdown，可选 timestamp+sign 进 query）；加签用 node:crypto 的 hmacSHA256；isSuccess 同时看 HTTP 状态与业务码。验证：新增 test/channels.cn.test.js。

## 上游产出摘要（dependsSummary）
- （无依赖）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T08:49:35.169Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t2a 完成：企业微信/飞书/钉钉的报文会按各自格式打包，加签串正确；即使平台回 HTTP 200 但 errcode≠0 也会判失败并带上原因，不会"发了却假装成功"。

### 完成项

- 落地 src/channels/index.js 注册表（channel→adapter，未知渠道返回 error 不抛）
- 落地 wecom/feishu/dingtalk 三个渠道模块（报文 + 加签 + 业务码判定）
- 落地 test/channels.cn.test.js 并跑绿 5/5

### 改动文件

- `src/channels/index.js`
- `src/channels/wecom.js`
- `src/channels/feishu.js`
- `src/channels/dingtalk.js`
- `test/channels.cn.test.js`

---
