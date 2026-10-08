# t-cc2a0c 端到端、兼容与回归收尾（无数据迁移，验证回滚路径）

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
端到端、兼容与回归收尾（无数据迁移，验证回滚路径）

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：test
- 端侧：fullstack

## 得到什么结果
node --test "test/*.test.js" → fail 0 且 tests ≥ 288；node --test test/e2e.local.test.js → 全绿（含 TC-24…TC-26）；docs/requirements/REQ-261002150038-344a/tests/verification-report.md 存在且含「基线 288」与改动后两组数字 + 回滚路径。

## 实施方案（implementation）
test/e2e.local.test.js 复用既有 withReceiver() + createNotifier()：TC-24 dive 注入 + turn/end(completed) → received.length === 0；TC-25 紧接着 user 消息 + completed → 1 条，msg_type==='interactive'、card.header.title.content==='✅ 对话完成'、JSON.stringify(card) 不含 `**类型**`；TC-26 dive + turn/end(error) → 1 条且标题为 '⚠️ 会话中断'。README.md「为什么需要它」补全为「goal / dive / plugin 注入轮一律静默，只有真人与中断才响」。写 docs/requirements/REQ-261002150038-344a/tests/verification-report.md：基线 288/0 与改动后数字、四条不变量核验（文本渠道用例未改动全绿、无配置键/落盘变更、PAYLOAD_VERSION 仍为 1）、回滚路径（删 src/source.js + 还原 4 处）。

## 上游产出摘要（dependsSummary）
- 自动轮静默：GoalTracker 认入 dive / plugin 注入轮
- 「任务」字段：注入正文不再冒充人的要求
- 设置页预览：卡片区不再显示「类型」行

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-02T07:16:30.393Z，窗口 session-eda4a33c-31bc-4d31-901d-5a9c640287bf）

这一步做完，整条需求有了可复核的收口材料：改了什么、怎么验的、怎么退回去，都在报告里。

### 完成项

- 端到端用例 4 条（TC-24…TC-27）：自动续跑 0 报文 / 人插话 1 条且任务=人的话 / 注入轮报错 1 条中断 / 飞书卡片无类型行
- README 补全「谁在说话」口径表
- 验收报告落盘：数字对照（288→293→304→305→307）、逐条命令与输出、行为证据、不变量核验、回滚路径（含测试一起回退）
- 全量 307 绿 / 0 失败；端到端 6 绿
- 如实登记一条既有并发偶发（test/e2e.multi.test.js，非本次引入，4 次复跑未再现）

### 改动文件

- `test/e2e.local.test.js`
- `README.md`
- `docs/requirements/REQ-261002150038-344a/tests/verification-report.md`

### 下一步

提交验收材料（reqboard_submit kind=verification）。

---
