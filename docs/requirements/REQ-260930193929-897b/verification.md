# REQ-260930193929-897b 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v2

**交付结论**：交付结论（第二轮）：读盘类闸门按需求自己声明的工作区读盘——唯一收敛入口 + 两个闸门共 7 处接线；13 例测试全绿，其中**新增 2 例显式 E2E 场景**（真实 HTTP → 仓储 → 状态机，断言需求状态 / 状态迁移历史 / 推进留痕三项可观察终态，另含反向「真缺文件不推进」），直接兑现上轮验收意见 v1-8。

本轮验证口径的变化（必须说明）：返工时发现**仓基线已移动**（期间两个新提交合入，全量从 103 失败/213 类型错误变为 97 失败/192 类型错误，测试文件 266 → 295），我早先的基线不可再用于逐条对比。故改用**同一棵树的前后对比 + A/B 归因**：本次返工零新增失败；对失败清单里落在我改动领域内的文件（design-completeness-gate 等）做了最小 A/B——把我的校正改成真 no-op 后失败数完全不变，证明与本需求无关。

仍需你在验收时裁决/知悉的四点：

① **E2E 项读数仍会显示「无（缺口）」**：该读数只认 requirement.md 的测试策略表，而该文档已确认、平台禁止在 implementing 阶段重交（实测 REQBOARD_BAD_STATUS，回退 brainstorming 会作废既有确认）。我**撤回**了加节改动以保持磁盘与确认版本逐字节一致（零漂移）。请按「通过 + 写明理由」处置，理由可直接引 tests/test-evidence.md 的「返工响应」节。

② 写入侧缺口（本需求未覆盖，建议另立）：批准计划时 queue.json 与 4 张任务卡被写进另一个工作区（dsh-notice-webhook），流程却报「落库成功」；同一错误根还导致 FR 覆盖门空过、RTM 条款接收全丢。物证已留 notes/。

③ 主机级实测未做：宿主经软链加载本仓 dist/index.mjs，需重建 dist + 重载宿主才生效，而重载会终止本会话——是否执行请人决定。

④ 工具通道（reqboard_confirm_artifact）只有接线位置的静态断言、无行为用例，已在测试证据「失败与未跑项」如实列出。

## 1. 验收列表

### v2-1 · 需求级验收 · E2E 覆盖

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：定向测试：node_modules/.bin/vitest run tests/design-gate-workspace-root.test.ts → Test Files 1 passed (1)；Tests 13 passed (13)

**验收状态**：✓ 通过

---

## 2. 测试报告

- E2E（验收返工项 v1-8 的交付）：node_modules/.bin/vitest run tests/design-gate-workspace-root.test.ts -t "E2E" → 2 passed。正向断言 4 项可观察终态（HTTP 200 + advanced=true + 无 gate_failure；status=decomposing；statusHistory 非空；评论含「看板一键确认产物」）；反向断言 advanced=false、gate_failure.code=design_doc_incomplete、status 留在 design
- 本文件全量：node_modules/.bin/vitest run tests/design-gate-workspace-root.test.ts → 13 passed
- 全量回归（当前树）：node_modules/.bin/vitest run → 97 failed | 2880 passed | 295 文件；与返工前**同一棵树**的 97 failed 持平 → 本次返工零新增失败
- A/B 归因实验（关键证据）：把我的根校正临时改成真 no-op 后重跑 tests/design-completeness-gate.test.ts → 仍 5 failed / 11 passed，与生效时**一字不差** → 该领域内的存量失败与本需求无关（失败形态是「reqboard_move 本该拒绝却成功」，而 MoveRequirement.ts 的 mtime 是 09-29、只调 assertArtifactGates、从未被我触碰）
- 类型检查：node_modules/.bin/tsc --noEmit -p tsconfig.json → 192 条（当前树基线）；改动/新增文件零错误。唯一命中的 src/http/routers/requirements.ts(459,23) 是**改动前基线里就存在**的同一处 cast 错误（当时 451 行，见改动前基线文本）
- 实现（唯一收敛入口）：src/application/internal/support.ts 的 applyRequirementWorkspaceRoot + WorkspaceRootTargets；7 处接线见 tests/design-gate-workspace-root.test.ts 的防旁路静态断言
- 测试文件：tests/design-gate-workspace-root.test.ts（13 例，含 E2E 两条）
- 评审报告：docs/requirements/REQ-260930193929-897b/reviews/self-review.md（问题清单 6 项，含本轮 E2E 返工与读数限制的处置）
- 测试证据：docs/requirements/REQ-260930193929-897b/tests/test-evidence.md（含「返工响应」节：E2E 用例表、读数限制说明、A/B 归因、covers 含 t-8cc56a）
- 回滚说明：docs/requirements/REQ-260930193929-897b/notes/rollback.md（6 文件反向编辑清单 + 期望值 + 「不要用 git checkout」警告）
- 本需求缺陷现场复现（立据）：19:45 设计确认落章成功但自动推进被拦，报「requirement.md 不存在」；磁盘实测该文件在盘上 13283 bytes 且落在需求声明的 workspaceRoot 下
- 写入侧缺口物证（本需求未覆盖，建议另立）：docs/requirements/REQ-260930193929-897b/notes/evidence-misplaced-decomposition.md——批准计划时 queue.json 与 4 份任务卡被写进 /Users/mac/Documents/ai/dsh/dsh-notice-webhook/...；定位在 confirm-settle.ts 的 landPlanTasks（该路径跳过两处校正）

## 3. 文档完整性检查

✗ 缺失：requirement.md（需求文档）
✗ 缺失：design/architecture.md（架构）
✗ 缺失：design/data-model.md（数据模型）
✗ 缺失：design/interfaces.md（接口）
✗ 缺失：design/test-cases.md（测试用例）
✗ 缺失：decomposition.md（拆分计划）
✗ 缺失：reviews/（评审报告，非空）
✗ 缺失：tests/（测试证据，非空）
✗ 缺失：tasks/t-be2369.md（任务卡）
✗ 缺失：tasks/t-b9d8e9.md（任务卡）
✗ 缺失：tasks/t-211525.md（任务卡）
✗ 缺失：tasks/t-671de7.md（任务卡）
✗ 缺失：tasks/t-59fed4.md（任务卡）
✗ 缺失：tasks/t-10098f.md（任务卡）
✗ 缺失：tasks/t-85644c.md（任务卡）
✗ 缺失：tasks/t-79a599.md（任务卡）
✗ 缺失：tasks/t-359e38.md（任务卡）
✗ 缺失：tasks/t-904889.md（任务卡）
✗ 缺失：tasks/t-58c789.md（任务卡）
✗ 缺失：tasks/t-d4ec69.md（任务卡）
✗ 缺失：tasks/t-5da4f0.md（任务卡）
✗ 缺失：tasks/t-f9a205.md（任务卡）
✗ 缺失：tasks/t-18a70f.md（任务卡）
✗ 缺失：tasks/t-40797a.md（任务卡）
✗ 缺失：tasks/t-eecd25.md（任务卡）
✗ 缺失：tasks/t-8cc56a.md（任务卡）
✗ 缺失：tasks/t-400452.md（任务卡）
✗ 缺失：tasks/t-1c0aea.md（任务卡）
✗ 缺失：tasks/t-3ec560.md（任务卡）
✗ 缺失：tasks/t-6934f4.md（任务卡）

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v2-1 | 需求级验收 · E2E 覆盖 | ✓ 通过 | human/session-a8201e1d-9d20-4697-aad0-927b83f54a3c | 2026-10-01 20:34 |
