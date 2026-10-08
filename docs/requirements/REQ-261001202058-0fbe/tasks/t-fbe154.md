# t-fbe154 端到端联调：真 HTTP 接收端跑「抑制 → 结算 → 补发」

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
端到端联调：真 HTTP 接收端跑「抑制 → 结算 → 补发」

## 解决什么问题
前面的卡片都是分片自证：判定对、接线对、兼容对。但使用者真正经历的是**一条完整的通知链路**——
消息有没有真的从插件走到接收端、走到几条、内容对不对。这张卡用真实 HTTP 接收端把这条路走一遍，
免得「每一段都测过」却拼起来不对。

## 范围
- 阶段：test
- 端侧：backend

## 得到什么结果
**人会看到的变化**：在真接收端上确认——后台有活时**一条都不发**，活干完**恰好补一条**，
而且补的那条与正常通知**一字不差**（连「你说了什么」都一样）；换轮次时不会收到两条。

工程验收口径：跑 `node --test test/jobs-gate.test.js` 退出码 0；两条链路的接收端条数与字段断言逐条通过（报文含 version:1、event:'turn/end' 与完成文案），且链路 ① 的报文与无 job 基线逐字段相等（忽略 at）。

## 实施方案（implementation）
仿 test/e2e.local.test.js 起真实 HTTP 接收端，在 test/jobs-gate.test.js 内串两条完整链路：①turn/start → 假 registry 注册 running job → turn/end（断言 0 条）→ settle + 推进宽限（断言 1 条，字段与基线一致）；②settle 后宽限内开新轮次（断言 0 条补发）→ 新轮次 turn/end（断言 1 条）。结果写入 docs/requirements/REQ-261001202058-0fbe/tests/e2e-report.md。

## 上游产出摘要（dependsSummary）
- 迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:40:43.330Z，窗口 session-b04b5777-de03-4582-8e15-756f94d43cf8）

端到端确认：使用者真正经历的那条链路是对的——后台有活时一条不发、活干完恰好补一条、内容与正常通知一字不差。

### 完成项

- 在真 HTTP 接收端上跑通三条链路：①抑制（0 条）→ 结算 + 宽限（恰好 1 条且与基线逐字段相等）；②换轮次不重复（0 条补发 + 新轮次 1 条）；③多 job（只认最后一个，恰好 1 条）
- 边界联调 5 项：dispose 后无悬挂计时器、开关关闭照常发、未注入/形状不符降级、生产路径 ctx.inject 就绪接上且卸载摘掉
- 联调报告落盘：docs/requirements/REQ-261001202058-0fbe/tests/e2e-report.md
- 三张子卡全部 done：研发（t-f8c218）/ 复核（t-0d216c，对账一致）/ 测试（t-caa24b，全量 266/266）
- 验收：node --test test/jobs-gate.test.js → tests 25 / pass 25 / fail 0；全量 266/266 绿

### 改动文件

- `docs/requirements/REQ-261001202058-0fbe/tests/e2e-report.md`

### 下一步

6 张卡全部 done → 需求自动进入 accepting；随后提交验收材料（reqboard_submit kind=verification）。

---
