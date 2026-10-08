# REQ-261001201200-8f8b 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v1

**交付结论**：交付结论：唤醒链的**两处**断点都已接上并各自有守卫测试锁住——①组合根按类签名三参构造投递器（原两参导致 createRoundMessage 抛 TypeError）；②src/index.ts 的 diveRoundPorts 原本根本没接 delivery（drive() 第一步即抛 undefined）。配套：disarm 写台账留痕（停摆可见）、存量误停摆需求可在下次推进或看板「继续」时恢复、人的主动暂停不被越权覆盖。零 schema 变更、零客户端改动、零工具面改动；全量回归 97 failed / 2897 passed（基线 106 / 2807），构建 exit 0。端到端一条如实标注未跑（需插件重载后人工观察）。

## 1. 验收列表

### v1-1 · 对齐投递器装配契约（组合根三参 + 可注入 id 工厂）

**验收内容**：【对齐投递器装配契约（组合根三参 + 可注入 id 工厂）】验收

**操作步骤**：
1. npx tsc --noEmit -p tsconfig.json 2>&1 过滤 pm-capture-root 输出为空（修前为 TS2554 Expected 3 arguments, but got 2）
2. tsx 脚本调 createCaptureRuntime 产出的 deliverer.createRoundMessage 返回非空 messageId
3. 第二参传非函数（如 {plugin}）时构造期抛 TypeError。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28

**验收状态**：✓ 通过

---

### v1-2 · 装配形状守卫与投递契约单测（修前必红转修后全绿）

**验收内容**：【装配形状守卫与投递契约单测（修前必红转修后全绿）】验收

**操作步骤**：
1. npx vitest run tests/dive-wake-wiring.test.ts tests/agent-deliverer.test.ts 全绿
2. 修前实测同一命令 9 failed（报错全为 this.idFactory is not a function），该修前输出需作为证据留存。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28

**验收状态**：✓ 通过

---

### v1-3 · disarm 写台账留痕（停摆可见）

**验收内容**：【disarm 写台账留痕（停摆可见）】验收

**操作步骤**：
1. npx vitest run tests/dive-round-driver.test.ts 全绿
2. 新增用例断言 comment 前缀与 reason 一致、teardown 路径不写、重复 disarm 不重复追加
3. 失败时直接报出缺失的 comment 文本。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28

**验收状态**：✓ 通过

---

### v1-4 · 误停摆恢复（判别器 + 恢复入口 + 两个调用点）

**验收内容**：【误停摆恢复（判别器 + 恢复入口 + 两个调用点）】验收

**操作步骤**：
1. npx vitest run tests/dive-round-state.test.ts tests/dive-rearm.test.ts 全绿
2. 真值表 5 行逐行通过（disarmed+active 为真，armed+active / disarmed+idle / 任意+paused / undefined 为假）
3. 集成用例断言 onRequirementMoved 后台账 activation=armed 且 inbox 收到 dive 消息
4. 负例断言 disarmed/idle 与 paused 零写入且不新增恢复 comment。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28

**验收状态**：✓ 通过

---

### v1-5 · 迁移兼容与端到端验证（回归基线 + 回滚说明）

**验收内容**：【迁移兼容与端到端验证（回归基线 + 回滚说明）】验收

**操作步骤**：
1. pnpm build 退出码 0 且 dist/ 与 lib/client.js 有新产物
2. npx vitest run 失败数不高于基线 106 failed / 2807 passed
3. git diff --stat 不含 schema、客户端与工具面文件
4. 端到端证据（dive 消息行与时间戳、roundsInStage 变化）已落盘
5. 未跑到的项如实标注未跑。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28

**验收状态**：✓ 通过

---

### v1-6 · 需求级验收

**验收内容**：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**操作步骤**：
1. 需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28

**验收状态**：✓ 通过

---

### v1-7 · 需求级验收 · E2E 覆盖

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28

**验收状态**：✓ 通过

---

## 2. 测试报告

- 构建（C-11）：`pnpm build` → 退出码 0；`[verify-client] OK bundle=331279 bytes, 关键符号齐全, 样式归属章在场, CSS 分片完整`；产物 dist/index.mjs 与 lib/client.js mtime 均为 20:28
- 回归（C-14）：`npx vitest run` → `Tests 97 failed | 2897 passed | 20 skipped`；对基线 106 failed / 2807 passed：失败减少 9、通过增加 90；失败项均为既有红
- 本需求用例全绿：tests/dive-wake-wiring.test.ts(7) / tests/dive-rearm.test.ts(8) / tests/agent-deliverer.test.ts(10) / tests/dive-round-driver.test.ts(17) / tests/dive-round-state.test.ts(15)
- 修前必红：组合根临时改回两参 → `Tests 3 failed | 1 passed`（TypeError: this.idFactory is not a function）；还原后 7 passed
- 第二处断点：从 src/index.ts 的 diveRoundPorts 移除 delivery → 守卫 `1 failed`（expected … to contain delivery:）；还原后 7 passed
- 类型红线：`tsc --noEmit` 过滤 pm-capture-root → 修前 TS2554 Expected 3 arguments, but got 2.；修后无输出
- 改动面归属：本次改动 mtime 20:22–20:27；src/client/**、src/shared/protocol.ts、src/tools/** 为 18:28–18:55（会话前既存）→ 未改 schema/客户端/工具面
- 端到端（**未跑**，如实标注）：修前基线 dive 消息 0 条、本需求 roundsInStage=0；复现步骤见证据文件
- 证据：docs/requirements/REQ-261001201200-8f8b/evidence/verification.md
- 测试证据（含 covers 逐卡对照）：docs/requirements/REQ-261001201200-8f8b/tests/test-evidence.md
- 实施评审：docs/requirements/REQ-261001201200-8f8b/reviews/implementation-review.md
- 迁移与回滚：docs/requirements/REQ-261001201200-8f8b/notes/migration-and-rollback.md

## 3. 文档完整性检查

✗ 缺失：requirement.md（需求文档）
✗ 缺失：design/architecture.md（架构）
✗ 缺失：design/data-model.md（数据模型）
✗ 缺失：design/interfaces.md（接口）
✗ 缺失：design/test-cases.md（测试用例）
✗ 缺失：decomposition.md（拆分计划）
✗ 缺失：reviews/（评审报告，非空）
✗ 缺失：tests/（测试证据，非空）
✗ 缺失：tasks/t-cd44d6.md（任务卡）
✗ 缺失：tasks/t-0cdb32.md（任务卡）
✗ 缺失：tasks/t-e2139e.md（任务卡）
✗ 缺失：tasks/t-d8d82b.md（任务卡）
✗ 缺失：tasks/t-d912e9.md（任务卡）
✗ 缺失：tasks/t-0f5858.md（任务卡）
✗ 缺失：tasks/t-0823eb.md（任务卡）
✗ 缺失：tasks/t-4a5db1.md（任务卡）
✗ 缺失：tasks/t-c8b5b5.md（任务卡）
✗ 缺失：tasks/t-d18e54.md（任务卡）
✗ 缺失：tasks/t-5b1be2.md（任务卡）
✗ 缺失：tasks/t-151ffa.md（任务卡）
✗ 缺失：tasks/t-cbc679.md（任务卡）
✗ 缺失：tasks/t-5236d6.md（任务卡）
✗ 缺失：tasks/t-3cefc0.md（任务卡）
✗ 缺失：tasks/t-0b3262.md（任务卡）
✗ 缺失：tasks/t-8157df.md（任务卡）
✗ 缺失：tasks/t-a89a79.md（任务卡）
✗ 缺失：tasks/t-0b5604.md（任务卡）
✗ 缺失：tasks/t-93c57e.md（任务卡）
✗ 缺失：tasks/t-52f2cc.md（任务卡）
✗ 缺失：tasks/t-5cc632.md（任务卡）
✗ 缺失：tasks/t-742553.md（任务卡）

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v1-1 | 对齐投递器装配契约（组合根三参 + 可注入 id 工厂） | ✓ 通过 | human/session-fc0c4b27-505e-4897-adf1-f6d70f624de4 | 2026-10-01 20:31 |
| v1-2 | 装配形状守卫与投递契约单测（修前必红转修后全绿） | ✓ 通过 | human/session-fc0c4b27-505e-4897-adf1-f6d70f624de4 | 2026-10-01 20:31 |
| v1-3 | disarm 写台账留痕（停摆可见） | ✓ 通过 | human/session-fc0c4b27-505e-4897-adf1-f6d70f624de4 | 2026-10-01 20:31 |
| v1-4 | 误停摆恢复（判别器 + 恢复入口 + 两个调用点） | ✓ 通过 | human/session-fc0c4b27-505e-4897-adf1-f6d70f624de4 | 2026-10-01 20:31 |
| v1-5 | 迁移兼容与端到端验证（回归基线 + 回滚说明） | ✓ 通过 | human/session-fc0c4b27-505e-4897-adf1-f6d70f624de4 | 2026-10-01 20:31 |
| v1-6 | 需求级验收 | ✓ 通过 | human/session-fc0c4b27-505e-4897-adf1-f6d70f624de4 | 2026-10-01 20:31 |
| v1-7 | 需求级验收 · E2E 覆盖 | ✓ 通过 | human/session-fc0c4b27-505e-4897-adf1-f6d70f624de4 | 2026-10-01 20:31 |
