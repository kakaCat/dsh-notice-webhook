# REQ-261002150038-344a 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v1

**交付结论**：交付结论：Dive 自动续跑等「系统注入轮」不再推「对话完成」（只认 direct human：source 缺失或 kind==='user'），注入正文不再冒充「任务」；注入轮里 agent 报错/崩溃**照推**中断（静默只挡完成）。飞书卡片与设置页卡片预览删掉与标题重复的「类型」行；文本渠道报文一字未改。6 张父卡 + 23 张子卡全 done（逐卡覆盖对照 29/29）；全量测试 307/0（基线 288，只增不减）；真 HTTP 接收端端到端 6/6；口径 14/14、轮次行为 9/9、任务字段 6/6 与设计逐行一致，无偏离。已知限制：真实飞书/企微群未实测（需重启 Host）；如实登记一条既有并发偶发（test/e2e.multi.test.js，非本次引入，4 次复跑未再现）。

## 1. 验收列表

### v1-1 · 口径契约：isHumanSource 纯函数与真值表

**验收内容**：【口径契约：isHumanSource 纯函数与真值表】验收

**操作步骤**：
1. node --test test/source.test.js → 全绿且用例数 ≥ 5
2. node -e "import('./src/source.js').then(m=>console.log(m.isHumanSource(undefined), m.isHumanSource({kind:'user'}), m.isHumanSource({kind:'dive'})))" → 输出 `true true false`。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

### v1-2 · 自动轮静默：GoalTracker 认入 dive / plugin 注入轮

**验收内容**：【自动轮静默：GoalTracker 认入 dive / plugin 注入轮】验收

**操作步骤**：
1. node --test test/goal.auto.test.js → 全绿（含新增 TC-6…TC-12）
2. grep -n "'goal'" src/goal.js → 用户消息来源判定处不再出现 'goal' 字面量（仅 goal 终态通路 goal/change、EVENT_GOAL_* 保留）。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

### v1-3 · 「任务」字段：注入正文不再冒充人的要求

**验收内容**：【「任务」字段：注入正文不再冒充人的要求】验收

**操作步骤**：
1. node --test test/payload.test.js → 全绿（含 TC-13…TC-16）
2. 用例数较基线只增不减。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

### v1-4 · 飞书卡片：删掉与标题重复的「类型」行

**验收内容**：【飞书卡片：删掉与标题重复的「类型」行】验收

**操作步骤**：
1. node --test test/channels.feishu.test.js → 全绿
2. node -e 构造 buildCard 后打印 elements[0].fields 的标签拼接 → stdout 不含「类型」，且含 会话 / 工作区 / 任务 / 时间。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

### v1-5 · 设置页预览：卡片区不再显示「类型」行

**验收内容**：【设置页预览：卡片区不再显示「类型」行】验收

**操作步骤**：
1. node --test test/client-render.test.js → 全绿（含 TC-21…TC-23）
2. 既有 payloadPreviewLines 三行断言保持绿。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

### v1-6 · 端到端、兼容与回归收尾（无数据迁移，验证回滚路径）

**验收内容**：【端到端、兼容与回归收尾（无数据迁移，验证回滚路径）】验收

**操作步骤**：
1. node --test "test/*.test.js" → fail 0 且 tests ≥ 288
2. node --test test/e2e.local.test.js → 全绿（含 TC-24…TC-26）
3. docs/requirements/REQ-261002150038-344a/tests/verification-report.md 存在且含「基线 288」与改动后两组数字 + 回滚路径。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

### v1-7 · 需求级验收

**验收内容**：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**操作步骤**：
1. 需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

### v1-8 · 需求级验收 · E2E 覆盖

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）

**验收状态**：✓ 通过

---

## 2. 测试报告

- 全量：pnpm test → tests 307 / pass 307 / fail 0（基线 288，逐阶段 293→304→305→307）
- node --test test/source.test.js → 5 passed / 0 failed（真值表 TC-1…TC-5）
- node --test test/goal.auto.test.js → 13 passed / 0 failed（含 TC-6…TC-12 注入轮静默）
- node --test test/payload.test.js → 11 passed / 0 failed（含 TC-13…TC-16 任务字段）
- node --test test/channels.feishu.test.js → 7 passed / 0 failed（断言翻转 + 字段顺序）
- node --test test/client-render.test.js → 19 passed / 0 failed（含 TC-21/22 卡片区无类型行）
- node --test test/e2e.local.test.js → 6 passed / 0 failed（含 TC-24…TC-27 真接收端端到端）
- 端到端实测：Dive 注入轮 completed → handle 返回 silent、接收端 0 条；人插话轮 → 1 条且正文含人的话、不含注入正文；Dive 轮 error → 1 条「会话异常中断」
- 卡片报文实测：标题 ✅ 对话完成 / 配色 green / 正文字段 会话→工作区→任务→时间，卡片 JSON 不含「类型」
- 文本渠道边界实测：企微 markdown 仍含「**类型**：✅ 对话完成」；无 context 老调用方仍回落 msg_type:text
- 逐卡覆盖对照（29/29 = 100%，每卡 covers 标注）：docs/requirements/REQ-261002150038-344a/tests/test-evidence.md
- 验收报告（数字对照 / 逐条命令 / 行为证据 / 不变量 / 回滚路径）：docs/requirements/REQ-261002150038-344a/tests/verification-report.md
- 自评审报告（含我自己的 5 处过错与 3 条遗留）：docs/requirements/REQ-261002150038-344a/reviews/self-review.md
- 设计文档：docs/requirements/REQ-261002150038-344a/design/（architecture / interfaces / data-model / test-cases / use-cases）
- 代码锚点（唯一口径）：src/source.js；调用点 src/goal.js、src/payload.js；卡片 src/channels/feishu.js；预览 client.js
- 不变量实测：PAYLOAD_VERSION 仍为 1；未改 src/config.js（无新配置键）；未改目标/绑定落盘格式；'user' 字面量只出现在 src/source.js

## 3. 文档完整性检查

✓ 9 类文档齐全

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v1-1 | 口径契约：isHumanSource 纯函数与真值表 | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
| v1-2 | 自动轮静默：GoalTracker 认入 dive / plugin 注入轮 | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
| v1-3 | 「任务」字段：注入正文不再冒充人的要求 | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
| v1-4 | 飞书卡片：删掉与标题重复的「类型」行 | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
| v1-5 | 设置页预览：卡片区不再显示「类型」行 | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
| v1-6 | 端到端、兼容与回归收尾（无数据迁移，验证回滚路径） | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
| v1-7 | 需求级验收 | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
| v1-8 | 需求级验收 · E2E 覆盖 | ✓ 通过 | human/session-eda4a33c-31bc-4d31-901d-5a9c640287bf | 2026-10-02 15:18 |
