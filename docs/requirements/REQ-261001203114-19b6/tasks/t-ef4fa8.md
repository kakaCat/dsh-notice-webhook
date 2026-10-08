# t-ef4fa8 迁移与兼容（单列）：老记录归一化 + 版本不变 + 回滚可读

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
迁移与兼容（单列）：老记录归一化 + 版本不变 + 回滚可读

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：test
- 端侧：backend

## 得到什么结果
跑 node --test test/targets-events.test.js 退出码 0（T6-1…T6-12 全绿）；跑 node -e "import('./src/targets.js').then(m=>{console.log(JSON.stringify(m.normalizeEvents(undefined,'explicit')),m.TARGET_FILE_VERSION)})" 期望：{"events":[],"eventsMode":"explicit"} 3；并断言新写入文件每条记录含 eventsMode、version===3、既有字段一字未改。

## 实施方案（implementation）
锁定三条路径：① 老记录（events 恰为 LEGACY_ALL_EVENTS 且无 mode）载入后归一化为 {events:[],eventsMode:'all'}，老目标开箱即收中断；② 老客户端（提交显式四项、无 mode）推断为全收；③ 旧版本读新文件：按白名单只取已知字段、忽略 eventsMode、events:[] 在旧语义里同样是全收，version 仍为 3。结果写入 docs/requirements/REQ-261001203114-19b6/tests/compat-report.md。

## 上游产出摘要（dependsSummary）
- 接线：开关、类型过滤与静默留痕

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:51:17.178Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

这一步做完，升级可以放心：老目标不用改配置就收得到中断通知，主动取消勾选的用户关得掉，装回旧版本也不会丢目标。

### 完成项

- 三条兼容路径逐一验证并留下证据命令：老记录（旧版全集 → 全收，开箱即收中断）、老客户端（显式四项 → 推断全收）、旧版本读新文件（忽略 eventsMode、events: [] 仍是全收）
- 回滚安全性核对：文件版本仍为 3、无新增顶层键、无字段改名（T6-7/T6-8 断言）
- 配置默认值变更影响面：未手写 skipReasons 的用户 interrupted 由静默转推送；手写过的原样保留
- 出站兼容性如实登记：只认 turn/end 的老接收端收不到中断（README 已明示）
- 报告落盘 docs/requirements/REQ-261001203114-19b6/tests/compat-report.md

### 改动文件

- `docs/requirements/REQ-261001203114-19b6/tests/compat-report.md`

---
