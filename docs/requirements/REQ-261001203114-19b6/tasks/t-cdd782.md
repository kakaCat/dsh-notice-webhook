# t-cdd782 测试：决策表 / 链路集成 / 迁移三套用例

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
测试：决策表 / 链路集成 / 迁移三套用例

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：test
- 端侧：fullstack

## 得到什么结果
跑 node --test "test/*.test.js" 期望 fail 0 且 tests ≥ 244+新增（只增不减）；跑 node --test test/interrupt.test.js test/targets-events.test.js 退出码 0。

## 实施方案（implementation）
扩展 test/classify.test.js（T2-*、T3-*：8 种终态、静默码、skipReasons 优先、开关不串扰，并改写既有『error 当完成』的期望为中断）；新增 test/interrupt.test.js（复用 test/e2e.local.test.js 的 withReceiver()/waitFor()，覆盖 T4-1…T4-6、T5-1…T5-4：报文字节、单行化与截断、自动轮不静默、静默留痕）；新增 test/targets-events.test.js（T6-1…T6-12）。既有 244 用例中只允许改动上述 error 相关断言。

## 上游产出摘要（dependsSummary）
- 接线：开关、类型过滤与静默留痕
- 出站报文：中断意图的 reason / error 与事件元数据
- 前端：设置页「关心事件」与保存语义

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:51:23.107Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

这一步做完，三条最关键的保证被用例钉死：报错再也不会被说成「已完成」、老目标收得到中断通知、无人值守的自动轮里 agent 报错照样叫人。

### 完成项

- 新增 test/interrupt.test.js（7 个链路用例）：报文 event/reason/error 逐字断言、绝不出现 turn/end、错误详情单行化+200 截断、缺字段回落 UNKNOWN、标题与 includeTitle、自动轮里报错照推而完成静默、三种静默码、开关与静默名单各自生效
- 新增 test/targets-events.test.js（10 个用例）：归一化判定式、接收语义三态、落盘 version 3、老记录迁移、显式勾选不被迁移、回滚可读、未知事件仍被拒
- 扩展 test/classify.test.js（7 个用例）：8 种终态决策表、静默原因码、单行化与截断、未知/畸形终态不抛异常
- 全量回归 node --test --test-timeout=30000 "test/*.test.js" → 288 passed / 0 failed（本需求新增+扩展 22 个用例）
- 改写 3 处旧断言（均属需求预期变更）：classify TC-5 interrupted、config 默认 skipReasons、config volatile 计数 10→11

### 改动文件

- `test/interrupt.test.js`
- `test/targets-events.test.js`
- `test/classify.test.js`
- `test/config.test.js`

---
