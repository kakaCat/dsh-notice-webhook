# t-ce4b1a 需求级自检：逐条 FR 对照可跑命令并汇总证据

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
需求级自检：逐条 FR 对照可跑命令并汇总证据

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：test
- 端侧：fullstack

## 得到什么结果
跑 node --test "test/*.test.js" 期望 fail 0 且 tests ≥ 244；跑 test -f docs/requirements/REQ-261001203114-19b6/tests/verification-report.md && echo ok 期望输出 ok；报告须覆盖 FR-1…FR-6，每条带真实命令与实际输出摘要。

## 实施方案（implementation）
按 design/test-cases.md §8 逐条跑，产出 docs/requirements/REQ-261001203114-19b6/tests/verification-report.md（每条 FR 一行：命令 + 输出摘要 + 结论），并核对 design/architecture.md §4 的 7 条不变量与两处设计偏差是否已如实记录。

## 上游产出摘要（dependsSummary）
- 测试：决策表 / 链路集成 / 迁移三套用例
- 文档同步：报文契约、事件分类表、排障原因码

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:51:23.340Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

这一步做完，验收有据可查：每条功能点都对应一条真实命令与实际输出，所有偏差（包括实施期自查抓到的回归）都写在报告里而不是被静默消化。

### 完成项

- 产出 docs/requirements/REQ-261001203114-19b6/tests/verification-report.md：FR-1…FR-6 逐条「判定命令 + 实际输出摘要 + 结论」
- 7 条不变量（I1…I6）逐条给出核对方式与结果（含 T4-1 的「绝不出现 turn/end」回归锁）
- 全量回归记录：node --test --test-timeout=30000 "test/*.test.js" → 288 passed / 0 failed
- 5 处偏差全部记账（eventsMode 措辞、aborted 判定顺序、探针写法、goal/* 通配回归、3 处既有断言改动），并说明基线 244→266 来自并发窗口的 jobs-gate 用例
- 边界复述：不做重试/续跑、不带堆栈进正文、不按 kind 细分开关、不提供退回谎报的开关

### 改动文件

- `docs/requirements/REQ-261001203114-19b6/tests/verification-report.md`

---
