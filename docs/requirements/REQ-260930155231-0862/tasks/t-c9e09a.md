# t-c9e09a 升级绑定存储：targetBindings 段

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
升级绑定存储：targetBindings 段

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/bindings.v2.test.js 全绿：读写 targetBindings、旧 bindings 段仍被维护、旧版本读新文件不报错（回滚安全）

## 实施方案（implementation）
在 src/bindings.js 增加 targetBindings 段（{ targetIds[], updatedAt }）；读时 targetBindings 优先，缺则回落 bindings url 映射；写时两段一起写（保旧版本可用）；提供 bindTargetsTargets/unbindTargets/listBindings 基础方法。验证：新增 test/bindings.v2.test.js（含“旧版本读新文件不报错”断言）。

## 上游产出摘要（dependsSummary）
- 实现目标清单存储与 CRUD

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T09:33:28.517Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t5 完成：绑定从"一条地址"升级成"若干目标 id"，写入时旧段仍被维护，旧版本读新文件不报错——回滚不丢绑定。

### 完成项

- 交付 src/bindings.js v2：targetBindings 段 + bindTargets/unbindTargets/targetIdsOf/listBindings
- 读时 targetBindings 优先回落 url；写时两段一起写（保旧版本可用）
- unbind/unbindTargets 双清；回滚安全已证
- 子卡链三段全绿：8/8 + v1 回归 9/9

### 改动文件

- `src/bindings.js`
- `test/bindings.v2.test.js`

---
