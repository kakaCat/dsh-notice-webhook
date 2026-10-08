# REQ-261001202058-0fbe 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v1

**交付结论**：交付结论：通知插件不再把「本轮把活交给后台 job」误报成「会话已完成」。turn/end 判出完成意图后先读一次 DSH 的 job 快照（ctx.jobs），若本会话仍有**本轮拉起且未结算**的 job（running/stopping）则压住不投递（drop 原因码 job-running）；该批 job 全部结算、且会话在 1500ms 宽限内没有开新轮次时，经**同一条** dispatch 补发一次完成通知（报文与正常投递逐字段相等）。没有 job 服务或把 `jobAwareComplete` 关掉时逐条等于改动前行为。全量 266/266 绿（基线 241/0），零新增失败，既有断言零改写；24 张任务卡的测试覆盖已在 tests/test-report.md 逐张登记。**遗留一条验证缺口**：真实 Host（真 profile + 真 ctx.jobs）内的联调未做，评审报告末尾给了 4 步人工核实清单；即使接不上也只会降级为旧行为并有 warn 可查。

## 1. 验收列表

### v1-1 · 配置契约：新增 volatile 开关 jobAwareComplete

**验收内容**：【配置契约：新增 volatile 开关 jobAwareComplete】验收

**操作步骤**：
1. 跑 `node --test test/config.test.js` 退出码 0
2. 跑 `node -e "import('./src/config.js').then(m=>{const c=m.Config({})
3. console.log(c.jobAwareComplete.get(), m.VOLATILE_KEYS.includes('jobAwareComplete'))})"` 输出恰为 `true true`
4. normalizeConfig({jobAwareComplete:'yes'}) 返回 true 且 logger 收到 1 条 warn。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

### v1-2 · 判定闸门模块 src/jobs.js（纯内存 + 判定层单测）

**验收内容**：【判定闸门模块 src/jobs.js（纯内存 + 判定层单测）】验收

**操作步骤**：
1. 跑 `node --test test/jobs-gate.test.js` 退出码 0
2. 判定层断言逐条通过：本轮 running job → suppressed:true 且 jobIds 含该 id
3. startedAt < since（常驻 job）→ suppressed:false
4. 无 turn/start → reason:'no-turn-start'
5. settle 后推进计时器 → deliver 恰好 1 次
6. 两个 job 需全部 settle 才触发
7. dispose() 后推进计时器 → 0 次且无未捕获异常。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

### v1-3 · 接线：主链路插入闸门 + ctx.inject(['jobs']) + 补发通路

**验收内容**：【接线：主链路插入闸门 + ctx.inject(['jobs']) + 补发通路】验收

**操作步骤**：
1. 跑 `node --test test/jobs-gate.test.js` 退出码 0
2. 接线层断言逐条通过：注入假 registry 后 handle(turn/end) 返回 action:'dropped'/reason:'job-running' 且本地接收端 0 条
3. settle + 推进宽限 → 接收端恰好 1 条且与基线报文逐字段相等（忽略 at）
4. 宽限内 turn/start → 0 条补发、随后该轮 turn/end → 1 条 sent
5. jobAwareComplete:false 与不注入 jobs 两种情形均 action:'sent'。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

### v1-4 · 迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方）

**验收内容**：【迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方）】验收

**操作步骤**：
1. 跑 `node --test "test/*.test.js"` 退出码 0、fail 0、tests 数 ≥ 基线 241（只增不减，基线已实测 241 passed / 0 failed）
2. 报告文件存在且逐条列出降级路径与旧行为等价的证据（用例名 + 断言）。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

### v1-5 · 排障口径：drop 原因码 job-running 进运维文档

**验收内容**：【排障口径：drop 原因码 job-running 进运维文档】验收

**操作步骤**：
1. 跑 `grep -n 'job-running' docs/guides/operations.md` 命中原因码表行，且该行含义与 FR-6/design/interfaces.md §4 一致（不是只出现在正文散文里）。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

### v1-6 · 端到端联调：真 HTTP 接收端跑「抑制 → 结算 → 补发」

**验收内容**：【端到端联调：真 HTTP 接收端跑「抑制 → 结算 → 补发」】验收

**操作步骤**：
1. 跑 `node --test test/jobs-gate.test.js` 退出码 0
2. 两条链路的接收端条数与字段断言逐条通过（报文含 version:1、event:'turn/end' 与完成文案），且链路 ① 的报文与无 job 基线逐字段相等（忽略 at）。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

### v1-7 · 需求级验收

**验收内容**：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**操作步骤**：
1. 需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

### v1-8 · 需求级验收 · E2E 覆盖

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：`node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）

**验收状态**：✓ 通过

---

## 2. 测试报告

- `node --test "test/*.test.js"` → tests 266 / pass 266 / fail 0（改动前基线 241/0，新增 25 条全绿、既有断言零改写）
- `node --test test/jobs-gate.test.js` → tests 25 / pass 25 / fail 0（判定层 16 + 接线/联调 9，含真 HTTP 接收端）
- `node --test test/config.test.js` → tests 6 / pass 6 / fail 0（含 volatile 集合断言，仅标题文案 9→10）
- `node -e "import('./src/config.js').then(m=>{const c=m.Config({});console.log(c.jobAwareComplete.get(), m.VOLATILE_KEYS.includes('jobAwareComplete'))})"` → `true true`
- `grep -c 'job-running' docs/guides/operations.md` → 2（排查清单 :35 + 原因码表 :52）
- 测试覆盖登记（24 张卡逐张 covers）：docs/requirements/REQ-261001202058-0fbe/tests/test-report.md
- 兼容与回滚报告：docs/requirements/REQ-261001202058-0fbe/tests/compat-report.md
- 端到端联调报告：docs/requirements/REQ-261001202058-0fbe/tests/e2e-report.md
- 实施评审报告：docs/requirements/REQ-261001202058-0fbe/reviews/implementation-review.md（逐项评审 + 5 条偏差处置 + 风险遗留 + 验收前人工核实 4 步）
- 交付文件：src/jobs.js（新增 222 行）、index.js（接线，424 行）、test/jobs-gate.test.js（新增 579 行）、src/config.js（新增 1 个 volatile 键）、docs/guides/operations.md（排障口径）

## 3. 文档完整性检查

✓ 9 类文档齐全

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v1-1 | 配置契约：新增 volatile 开关 jobAwareComplete | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
| v1-2 | 判定闸门模块 src/jobs.js（纯内存 + 判定层单测） | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
| v1-3 | 接线：主链路插入闸门 + ctx.inject(['jobs']) + 补发通路 | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
| v1-4 | 迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方） | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
| v1-5 | 排障口径：drop 原因码 job-running 进运维文档 | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
| v1-6 | 端到端联调：真 HTTP 接收端跑「抑制 → 结算 → 补发」 | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
| v1-7 | 需求级验收 | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
| v1-8 | 需求级验收 · E2E 覆盖 | ✓ 通过 | human/session-b04b5777-de03-4582-8e15-756f94d43cf8 | 2026-10-01 20:42 |
