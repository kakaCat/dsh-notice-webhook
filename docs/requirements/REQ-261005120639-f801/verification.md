# REQ-261005120639-f801 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v1

**交付结论**：交付结论：notice 插件不再在子代理还在跑时报「会话已完成」。

判定源从一路扩为两路：既有后台 job + 新增「本会话在跑的 subagent 后代」。
子代理结束、两路都清空后，宽限 1.5 秒内无新轮次才补发一条真的完成通知。

新增原因码 subagent-running / work-running，job-running 逐字保留，排障可查。
不新增配置键（复用 jobAwareComplete 一键回旧行为）、不改出站报文、不落盘、不动 DSH 源码。

测试：全量 320/320 通过（基线 307，只增不减）；两条端到端链路在真 HTTP 接收端跑通；
测试文档已按卡标注 covers（20 张任务卡全部有落点）。
现场复算：2 个真实会话 27 个误报窗口，子代理在「已完成」之后还继续跑了 35 秒 ~ 24 分钟。
评审：1 处「宽限到点又忙起来会静默丢通知」的缺陷已在复核中修复并加用例锁定，其余无偏离。

已知残余风险已明示：若子代理结算事件在某种组合下收不到、且父会话始终没被唤醒，这次补发不会发生（不引入轮询是有意取舍）。

## 1. 验收列表

### v1-1 · 判定层：闸门看两路活（job + subagent 后代）

**验收内容**：【判定层：闸门看两路活（job + subagent 后代）】验收

**操作步骤**：
1. node --test test/jobs-gate.test.js 退出码 0。断言覆盖：1 个本会话 running 子代理 → suppressed:true + reason:'subagent-running' + subagentIds 非空
2. 只有未结算 job → reason:'job-running'（逐字保留）
3. 两者都有 → 'work-running'
4. idle 子代理 / parentSession 指向别的会话 / 有 parentSession 但 origin 缺失（普通 fork）/ 脏条目 → reason:'no-work'
5. 孙代（两级血统）计入
6. 自指环不死循环
7. attachSubagents({}) 与 list() 抛错都不抛异常。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）

**验收状态**：✓ 通过

---

### v1-2 · 接线层：ctx.agents 注入 + subagent/end 复检

**验收内容**：【接线层：ctx.agents 注入 + subagent/end 复检】验收

**操作步骤**：
1. node --test test/jobs-gate.test.js 退出码 0
2. grep -n "subagent/end" index.js 命中接线与 dispose 两处。接线层断言：注入假 agents 后 handle(turn/end) → action:'dropped' / reason:'subagent-running' 且接收端 0 条
3. 子代理转 idle + observeSubagentEnd() + 推进宽限 → 接收端恰好 1 条且与基线完成报文逐字段相等（忽略 at）
4. 宽限内 turn/start → 0 条补发
5. jobAwareComplete:false 与不注入 agents → action:'sent'。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）

**验收状态**：✓ 通过

---

### v1-3 · 测试与降级回归（含 2 处既有断言同步）

**验收内容**：【测试与降级回归（含 2 处既有断言同步）】验收

**操作步骤**：
1. node --test "test/*.test.js" 退出码 0、fail 0、tests ≥ 307（只增不减）
2. grep -rn "no-jobs" test/ src/ 期望 0 命中
3. 兼容报告逐条列出唯一既有断言改动（2 处诊断码）与降级路径等价的证据（用例名 + 断言）。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）

**验收状态**：✓ 通过

---

### v1-4 · 文档口径：完成闸门 + 两个新原因码

**验收内容**：【文档口径：完成闸门 + 两个新原因码】验收

**操作步骤**：
1. grep -rn "subagent-running\|work-running" docs/guides/operations.md 两行都命中
2. grep -rn "只读 ctx.jobs" docs/ 期望 0 命中
3. 人工核对三份 architecture 文档里「完成闸门」口径一致。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）

**验收状态**：✓ 通过

---

### v1-5 · 端到端联调：真 HTTP 接收端跑「抑制 → 复检 → 补发」

**验收内容**：【端到端联调：真 HTTP 接收端跑「抑制 → 复检 → 补发」】验收

**操作步骤**：
1. node --test test/jobs-gate.test.js 退出码 0
2. 两条链路的接收端条数与字段断言逐条通过（报文含 version:1 / event:'turn/end' / 完成文案）。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）

**验收状态**：✓ 通过

---

### v1-6 · 需求级验收

**验收内容**：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**操作步骤**：
1. 需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）

**验收状态**：✓ 通过

---

### v1-7 · 需求级验收 · E2E 覆盖

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）

**验收状态**：✓ 通过

---

## 2. 测试报告

- node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（新增 TC-S1…TC-S13 共 13 条）
- node --test "test/*.test.js" → tests 320 / pass 320 / fail 0（开工前基线 307，只增不减）
- 最小复现：有子在跑 → suppressed:true / reason:subagent-running / subagentIds:['session-child']；子代理结束后 → suppressed:false / reason:no-work
- grep -rn "no-jobs" test/ src/ → 0 命中（诊断码已全部改名为 no-work）
- grep -n "subagent/end" index.js → 2 处（订阅 + dispose 摘线）
- grep -rn "只读 ctx.jobs" docs/architecture docs/guides → 0 命中（口径已改述为完成闸门两路事实源）
- python3 docs/requirements/REQ-261005120639-f801/repro-continuable-window.py → 两个真实会话共 27 个「父轮次 completed 而子代理仍在跑」的窗口（最长 +1429s）
- docs/requirements/REQ-261005120639-f801/verification.md（交付结论 + FR 逐条证据 + 命令与实测输出 + 残余风险 + 真机验证步骤）
- docs/requirements/REQ-261005120639-f801/tests/compat-report.md（兼容与回归报告 + covers 覆盖标注 11 张卡）
- docs/requirements/REQ-261005120639-f801/tests/e2e-report.md（真 HTTP 接收端两条链路实测 + covers 覆盖标注 9 张卡）
- docs/requirements/REQ-261005120639-f801/reviews/implementation-review.md（实施评审：1 处缺陷已修复并加 TC-S9 锁定、无偏离、残余风险明示）

## 3. 文档完整性检查

✓ 9 类文档齐全

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v1-1 | 判定层：闸门看两路活（job + subagent 后代） | ✓ 通过 | human/session-df00704c-5bd1-4d81-a003-3d3a4b648ea4 | 2026-10-05 12:43 |
| v1-2 | 接线层：ctx.agents 注入 + subagent/end 复检 | ✓ 通过 | human/session-df00704c-5bd1-4d81-a003-3d3a4b648ea4 | 2026-10-05 12:43 |
| v1-3 | 测试与降级回归（含 2 处既有断言同步） | ✓ 通过 | human/session-df00704c-5bd1-4d81-a003-3d3a4b648ea4 | 2026-10-05 12:43 |
| v1-4 | 文档口径：完成闸门 + 两个新原因码 | ✓ 通过 | human/session-df00704c-5bd1-4d81-a003-3d3a4b648ea4 | 2026-10-05 12:43 |
| v1-5 | 端到端联调：真 HTTP 接收端跑「抑制 → 复检 → 补发」 | ✓ 通过 | human/session-df00704c-5bd1-4d81-a003-3d3a4b648ea4 | 2026-10-05 12:43 |
| v1-6 | 需求级验收 | ✓ 通过 | human/session-df00704c-5bd1-4d81-a003-3d3a4b648ea4 | 2026-10-05 12:43 |
| v1-7 | 需求级验收 · E2E 覆盖 | ✓ 通过 | human/session-df00704c-5bd1-4d81-a003-3d3a4b648ea4 | 2026-10-05 12:43 |
