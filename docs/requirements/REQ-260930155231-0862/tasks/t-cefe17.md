# t-cefe17 客户端半：设置页骨架与目标页

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
客户端半：设置页骨架与目标页

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：frontend

## 得到什么结果
打开 设置 → Webhook 通知 页面：出现左渠道 rail（含图标与数量徽标）与右详情卡；控制台无报错；grep -c 'settings.section' client.js ≥ 1

## 实施方案（implementation）
新增 client.js（window.__ModuleLoader__.load 格式，require('react')）；ctx.slots.inject('settings.section') 注册 {name,id:'dsh-notice-webhook',order:21,label:thunk}；实现 ChannelRail（含 6 渠道内联 SVG 图标与数量徽标）与 TargetCard 骨架，数据经 RPC GET /state。验证：打开设置页看 rail+卡片，控制台无报错；grep 命中 settings.section。

## 上游产出摘要（dependsSummary）
- 实现 RPC 写入端点与 revision 栅栏

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T10:48:46.588Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t10 完成：设置里现在多了「通知」一页——左侧按渠道列出目标，右侧是详情卡；页面数据全部来自后端状态，不再需要手改配置文件。

### 完成项

- 落地 client.js：window.__ModuleLoader__.load 格式 + require('react')，自包含无 ESM
- 注册 settings.section（id dsh-notice-webhook / order 21 / label thunk）
- 实现 ChannelRail（6 渠道内联 SVG 图标 + 数量徽标）与 TargetCard 骨架，数据经 GET /state
- 落地 test/client-service.test.js 用真实产物跑绿 8/8

### 改动文件

- `client.js`
- `test/client-service.test.js`
- `package.json`

---
