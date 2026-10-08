# t-5a7d2f 实现目标集合解析与替代默认组

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
实现目标集合解析与替代默认组

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/router.resolve.test.js 全绿：绑定非空→只发绑定目标；绑定为空/不存在→默认组；总开关只作用于默认组

## 实施方案（implementation）
在 src/router.js 实现 resolveTargets(sessionId, intent)：targetBindings 非空→只取这些（enabled 过滤，空则回落默认组）；否则取 isDefault && enabled；总开关仅作用默认组；输出目标集合供逐目标打包。验证：新增 test/router.resolve.test.js（含 TC-19 断言）。

## 上游产出摘要（dependsSummary）
- 实现 Slack / Discord / 通用三渠道
- 升级绑定存储：targetBindings 段

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T10:08:42.636Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t8a 完成：路由现在能解析"该会话发到哪些目标"——绑定非空只发绑定目标，绑定失效回落默认组，总开关只管默认组；旧路由方法保留、行为不变。

### 完成项

- 交付 src/router.js：resolveGroup + resolveTargets（绑定优先且替代默认组）
- resolveTargets 顺序固定：类开关→目标解析→总开关→目标过滤→去重
- 落地 test/router.resolve.test.js 并跑绿 5/5；旧路由回归 8/8

### 改动文件

- `src/router.js`
- `test/router.resolve.test.js`

---
