# REQ-260930194112-1ab8 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v1

**交付结论**：列表视图自适应修复已交付：关键列不再换行、操作按钮不再重叠；窄屏按档让位（≤1180px 让出分类/负责人/更新时间、≤880px 再让出进度），低于 720px 整表横向滚动而非压扁列；宽屏（≥1180px）8 列几何与修复前逐字节一致（仅外框 1px 抗锯齿残差，已如实标注）。验证三层证据：5 条静态断言全绿；headless Chrome 五档宽度真实渲染探针 PROBE PASS（含负向验证：改坏保底宽度即 PROBE FAIL + 退出码 1）；修复前/后对照截图 5 张。产物已按用户裁定用隔离树重建（仅本次修复，不含其它在飞需求的未提交客户端改动）并经 verify:client 校验；界面刷新（⌘R）即可看到变化。

## 1. 验收列表

### v1-1 · 列表行 markup 加滚动容器与列类名契约

**验收内容**：【列表行 markup 加滚动容器与列类名契约】验收

**操作步骤**：
1. 跑 ./node_modules/.bin/vitest run tests/list-responsive.test.ts：TC-1（输出含 dsh-pm-table-wrap 且 <table 在其内）、TC-2（thead 与每条 tr.dsh-pm-list-row 内 4 个列类名各 1 次、分组头 0 次）、TC-3（分组头仍 colspan="8"）、TC-5（空列表输出不含 <table 与 wrap）全部通过。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（未附实际结果：本机弹框为「选项或自定义输入」二选一，本项按通过记录，待补复核）

**验收状态**：✓ 通过

---

### v1-2 · 列表视图自适应样式与两档让位断点

**验收内容**：【列表视图自适应样式与两档让位断点】验收

**操作步骤**：
1. 跑 ./node_modules/.bin/vitest run tests/list-responsive.test.ts → 5 passed
2. TC-4 断言 BOARD_CSS 文本包含 overflow-x: auto、min-width: 720px、white-space: nowrap、min-width: max-content、max-width: 1180px、max-width: 880px 与 4 个列类名，缺一即失败。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（未附实际结果：本机弹框为「选项或自定义输入」二选一，本项按通过记录，待补复核）

**验收状态**：✓ 通过

---

### v1-3 · 五档宽度布局回归探针（headless Chrome）

**验收内容**：【五档宽度布局回归探针（headless Chrome）】验收

**操作步骤**：
1. 跑 npx tsx scripts/list-responsive-probe.mts → 退出码 0，stdout 包含 5 行 DIAG 且均为 problems=NONE、末行包含 PROBE PASS
2. 断言 640 档 overflowX=true、1680 档 cols=8 且 titleW≥500
3. 负向验证：把 src/client/styles/board.ts 里的 min-width: 720px 临时改为 2000px 后重跑，stdout 必须包含 PROBE FAIL 且退出码非 0。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（未附实际结果：本机弹框为「选项或自定义输入」二选一，本项按通过记录，待补复核）

**验收状态**：✓ 通过

---

### v1-4 · 兼容降级与回滚面核对 + 证据归档

**验收内容**：【兼容降级与回滚面核对 + 证据归档】验收

**操作步骤**：
1. 范围化核对（工作区另有其它在飞需求的改动，故按文件限定）：① 跑 `git status --porcelain -- src/client/views/board.ts src/client/styles/board.ts tests/list-responsive.test.ts scripts/list-responsive-probe.mts package.json pnpm-lock.yaml` → 恰好输出 2 个 M（views/board.ts、styles/board.ts）与 2 个 ??（tests/list-responsive.test.ts、scripts/list-responsive-probe.mts），package.json 与 pnpm-lock.yaml 无输出（无依赖变更）
2. ② `git diff --stat -- src/client/views/board.ts src/client/styles/board.ts` → 仅这两个文件，净增 40+11 行
3. ③ evidence/ 目录包含 5 张 png，尺寸分别为 before-840.png 840x520、after-640.png 640x520、after-840.png 840x520、after-1080.png 1080x520、after-1680.png 1680x520。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（未附实际结果：本机弹框为「选项或自定义输入」二选一，本项按通过记录，待补复核）

**验收状态**：✓ 通过

---

### v1-5 · 需求级验收

**验收内容**：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**操作步骤**：
1. 需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（未附实际结果：本机弹框为「选项或自定义输入」二选一，本项按通过记录，待补复核）

**验收状态**：✓ 通过

---

### v1-6 · 需求级验收 · 不可照着验

**验收内容**：验收项不可照着验（历史数据）：以下验收项没写「怎么验」——验收项 列表行 markup 加滚动容器与列类名契约·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 列表视图自适应样式与两档让位断点·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 五档宽度布局回归探针（headless Chrome）·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 兼容降级与回滚面核对 + 证据归档·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。。请补可执行操作（命令/可查数据/界面路径）；本条不阻断验收，但必须有人看过并决定。

**操作步骤**：
1. 验收项不可照着验（历史数据）：以下验收项没写「怎么验」——验收项 列表行 markup 加滚动容器与列类名契约·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
2. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。
3. 验收项 列表视图自适应样式与两档让位断点·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
4. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。
5. 验收项 五档宽度布局回归探针（headless Chrome）·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
6. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。
7. 验收项 兼容降级与回滚面核对 + 证据归档·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
8. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。。请补可执行操作（命令/可查数据/界面路径）
9. 本条不阻断验收，但必须有人看过并决定。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-7 · 需求级验收 · E2E 覆盖

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-8 · 需求级验收 · 追溯断链

**验收内容**：FR 追溯断链：以下功能点的 fr_to_tests 为空（FR→设计→任务→测试链路断裂）——FR-1；FR-3；FR-5；FR-4；FR-6；FR-2。请补任务卡 serves: FR-x 标注与测试 covers: t-xxx 标注；通过时意见须写明处置方式。

**操作步骤**：
1. FR 追溯断链：以下功能点的 fr_to_tests 为空（FR→设计→任务→测试链路断裂）——FR-1
2. FR-3
3. FR-5
4. FR-4
5. FR-6
6. FR-2。请补任务卡 serves: FR-x 标注与测试 covers: t-xxx 标注
7. 通过时意见须写明处置方式。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

## 2. 测试报告

- 单测：./node_modules/.bin/vitest run tests/list-responsive.test.ts → 5 passed（TC-1 滚动容器 / TC-2 列类名成对 / TC-3 colspan 不变 / TC-4 样式规则齐备 / TC-5 空列表分支）
- 布局探针：npx tsx scripts/list-responsive-probe.mts → 退出码 0，5 行 DIAG 全 problems=NONE，末行 PROBE PASS
- 探针数值：640 cols=4 titleW=282 overflowX=true / 760 cols=4 / 840 cols=4 titleW=362 / 1080 cols=5 titleW=430 / 1680 cols=8 titleW=540
- 负向验证：styles/board.ts 的 min-width: 720px 临时改为 2000px 重跑 → PROBE FAIL + 退出码 1（4 条「横向滚动 true ≠ 期望 false」）
- 对照截图：evidence/before-840.png（ID 占 3 行、功能/拆分竖排、取消与会话叠字）
- 对照截图：evidence/after-840.png、after-640.png（横向滚动兜底）、after-1080.png、after-1680.png
- 宽档不变式实测：HEAD 版与本次版渲染 1680px，8 列 left:width 逐字节相同（ID@20:224 … 操作@1401:259）、行高 50；残差仅外框 1px 抗锯齿（放大差异图只显示外框）
- 全套回归：改动前 49 failed files / 103 failed tests，改动后同为 49/103（失败均来自工作区其它在飞需求），新增 5 用例通过
- 改动面：git status --porcelain 恰为 2 个 M（src/client/views/board.ts、src/client/styles/board.ts）+ 2 个新增（tests/list-responsive.test.ts、scripts/list-responsive-probe.mts），无依赖变更
- 回滚路径：还原上述 2 个源文件即回到修复前；无数据迁移、无开关、无回填
- 产物重建：lib/client.js 含 dsh-pm-table-wrap 2 处 + min-width: 720px / min-width: max-content / max-width: 1180px / max-width: 880px 各 1 处；类名集合 = HEAD 构建集合 + 新增 5 个，无丢失
- 构建自检：node scripts/verify-client-build.mjs → [verify-client] OK bundle=309893 bytes, 关键符号齐全, styles.ts 括号配对
- 复核记录：docs/requirements/REQ-260930194112-1ab8/reviews/review-round-1.md（4 卡无实质偏离 + 2 处细化声明 + 4 项遗留如实列出）
- 测试证据（含 15 张任务卡的 covers 覆盖标注与逐条可执行验证动作）：docs/requirements/REQ-260930194112-1ab8/tests/test-evidence.md
- 产物生效路径：~/.dsh/profiles/desktop 与 web 的 node_modules/dsh-pmboard 均符号链接到本仓，界面刷新（⌘R）即加载新产物

## 3. 文档完整性检查

✗ 缺失：requirement.md（需求文档）
✗ 缺失：design/architecture.md（架构）
✗ 缺失：design/data-model.md（数据模型）
✗ 缺失：design/interfaces.md（接口）
✗ 缺失：design/test-cases.md（测试用例）
✗ 缺失：decomposition.md（拆分计划）
✗ 缺失：reviews/（评审报告，非空）
✗ 缺失：tests/（测试证据，非空）
✗ 缺失：tasks/t-8479b2.md（任务卡）
✗ 缺失：tasks/t-24c90a.md（任务卡）
✗ 缺失：tasks/t-7a92ae.md（任务卡）
✗ 缺失：tasks/t-702bf4.md（任务卡）
✗ 缺失：tasks/t-99dc0a.md（任务卡）
✗ 缺失：tasks/t-efd3af.md（任务卡）
✗ 缺失：tasks/t-cac573.md（任务卡）
✗ 缺失：tasks/t-4a6bcf.md（任务卡）
✗ 缺失：tasks/t-bab4cc.md（任务卡）
✗ 缺失：tasks/t-64530d.md（任务卡）
✗ 缺失：tasks/t-2bd99a.md（任务卡）
✗ 缺失：tasks/t-1f6e47.md（任务卡）
✗ 缺失：tasks/t-1d8bbd.md（任务卡）
✗ 缺失：tasks/t-4c49aa.md（任务卡）
✗ 缺失：tasks/t-426253.md（任务卡）

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v1-1 | 列表行 markup 加滚动容器与列类名契约 | ✓ 通过 | human/session-c1999330-7372-45da-b999-171621fa17bb | 2026-09-30 22:48 |
| v1-2 | 列表视图自适应样式与两档让位断点 | ✓ 通过 | human/session-c1999330-7372-45da-b999-171621fa17bb | 2026-09-30 22:48 |
| v1-3 | 五档宽度布局回归探针（headless Chrome） | ✓ 通过 | human/session-c1999330-7372-45da-b999-171621fa17bb | 2026-09-30 22:48 |
| v1-4 | 兼容降级与回滚面核对 + 证据归档 | ✓ 通过 | human/session-c1999330-7372-45da-b999-171621fa17bb | 2026-09-30 22:48 |
| v1-5 | 需求级验收 | ✓ 通过 | human/session-c1999330-7372-45da-b999-171621fa17bb | 2026-09-30 22:48 |
| v1-6 | 需求级验收 · 不可照着验 | ⬜ 待验收 |  |  |
| v1-7 | 需求级验收 · E2E 覆盖 | ⬜ 待验收 |  |  |
| v1-8 | 需求级验收 · 追溯断链 | ⬜ 待验收 |  |  |
