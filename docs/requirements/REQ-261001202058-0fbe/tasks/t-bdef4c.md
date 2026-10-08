# t-bdef4c 迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方）

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方）

## 解决什么问题
改通知行为最怕「顺手把别人搞坏」：老用户升级后什么都没配、或者跑在没有后台任务能力的组合里，
通知必须一条不少。这张卡就是把「新能力是纯加法」这件事**用证据钉住**——谁能被影响、谁一定不受影响。

## 范围
- 阶段：test
- 端侧：backend

## 得到什么结果
**人会看到的变化**：升级后不做任何配置，通知行为与升级前逐条一致（只有后台真的还有活时才不报「完成」）。
怀疑是新行为作祟时，把配置 `jobAwareComplete` 关掉即可立刻回到旧行为，不用重启。

工程验收口径：跑 `node --test "test/*.test.js"` 退出码 0、fail 0、tests 数 ≥ 基线 241（只增不减，基线已实测 241 passed / 0 failed）；报告文件存在且逐条列出降级路径与旧行为等价的证据（用例名 + 断言）。

## 实施方案（implementation）
不改任何既有断言，跑全量并逐条核对两条降级路径（不注入 jobs、jobAwareComplete:false）与改动前行为一致；把结论、用例名与断言证据写入 docs/requirements/REQ-261001202058-0fbe/tests/compat-report.md，含「既有 30 个测试文件唯一改动是 test/config.test.js 标题文案」的声明。

## 上游产出摘要（dependsSummary）
- 接线：主链路插入闸门 + ctx.inject(['jobs']) + 补发通路

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:38:27.335Z，窗口 session-b04b5777-de03-4582-8e15-756f94d43cf8）

兼容性有据可查：升级后不配任何东西就是旧行为，唯一的变化是「后台还有活时不报完成」；想退回旧行为改一行配置即可。

### 完成项

- 兼容报告落盘：docs/requirements/REQ-261001202058-0fbe/tests/compat-report.md（作用范围图 / 两条降级路径逐条证据 / 既有测试改动声明 / 未触碰清单 / 回滚路径 / 复现命令）
- 路径一「无 job 服务」验证：既有 30 个测试文件 241 条基线用例均不注入 jobs → 原样通过；TC-16（照常发、无告警）、TC-16b（形状不符 → 照常发 + 1 条 warn）、TC-2（available=false、reason 'unavailable'）
- 路径二「开关关闭」验证：TC-15（有 running job 仍返回 action:'sent'）；热改读得回 false、不写即 true
- 对账复核（子卡 t-c3b5bc）通过：grep 证明只有 jobs-gate.test.js 传 jobs；mtime 证明本窗口代码面只写了 index.js / src/config.js / src/jobs.js / test/config.test.js / test/jobs-gate.test.js 五个文件
- 全量回归：node --test "test/*.test.js" → 266 passed / 0 failed（基线 241/0，只增不减）；5 个落地文件 node --check 通过
- 子卡链全绿：研发（t-830f85）/ 复核（t-c3b5bc）/ 测试（t-9905e8）

### 改动文件

- `docs/requirements/REQ-261001202058-0fbe/tests/compat-report.md`

### 下一步

t5 排障文档卡（drop 原因码 job-running 进 operations.md）与 t6 端到端联调卡。

---
