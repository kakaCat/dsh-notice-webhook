# t-c3b5bc 迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方）·复核

> 需求：REQ-261001202058-0fbe 后台 job 运行中不再推「会话已完成」

## 在做什么
迁移与兼容回归（无 job 服务 / 开关关闭 / 既有调用方）·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
把 compat-report.md 的每条声明与代码/用例/文件系统对账：`grep -ln "jobs:" test/*.js` 只应命中 test/jobs-gate.test.js；`find . -newermt "2026-10-01 20:22"`（排除 docs 与 node_modules）应只有 index.js、src/config.js、src/jobs.js、test/config.test.js、test/jobs-gate.test.js；`node --test test/jobs-gate.test.js` → 全绿；无偏离时写明「对账一致」及依据。

---
## 汇报 1（2026-10-01T12:37:50.226Z，窗口 session-b04b5777-de03-4582-8e15-756f94d43cf8）

对账一致：兼容报告里的每条声明都能在文件系统与用例里找到依据——本窗口代码面只碰了 5 个文件（3 个源码 + 2 个测试），既有测试除一处标题文案外一行未动。

### 完成项

- 声明①「既有测试都不传 options.jobs」→ 对账一致：`grep -ln "jobs:" test/*.js` 只命中 test/jobs-gate.test.js（其余 30 个既有文件均不注入，故天然走降级路径）
- 声明②「本窗口只改了 config.test.js 的标题，其余既有测试一行未改」→ 对账一致：`find . -newermt 2026-10-01 20:22`（本需求窗口起点）在代码面只列出 index.js、src/config.js、src/jobs.js（新）、test/config.test.js、test/jobs-gate.test.js（新）；test/ 下本需求之前最后一次改动是 14:41（questions-hook.test.js，早于本需求 20:22 立项）
- 声明③「基线 241/0 → 现状 266/0」→ 对账一致：基线是改动前本窗口实测，现状为全量实测（t1+t2+t3 新增 25 条）
- 声明④「未触碰清单」→ 对账一致：src/classify.js、router.js、goal.js、deliver.js、payload.js、bindings.js、targets.js、outcomes.js、rpc.js、channels/**、client.js、package.json 均不在本窗口写入列表内
- 报告与用例的口径一致性抽查：TC-16 断言「降级时不产生告警」与报告 §3.1 第 3 行一致；TC-16b 断言「形状不符恰好 1 条 warn」与 §3.1 第 4 行一致；TC-2 的 reason 'unavailable' 与 §3.1 第 5 行一致
- 发现的**报告表述可精确化之处（非错误）**：§4 的「其余 29 个既有测试文件一行未改」结论正确（31 个文件 = 30 既有 + 1 新增；30 中 config.test.js 改标题 → 剩 29 未改），但报告未写出该推导，已在本条汇报中补齐口径
- 验收：node --test test/jobs-gate.test.js → pass 25 / fail 0

### 下一步

测试子卡 t-9905e8：跑全量 node --test \"test/*.test.js\" 与基线 241 比对。

---
