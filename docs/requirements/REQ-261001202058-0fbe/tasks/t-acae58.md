# t-acae58 接线：主链路插入闸门 + ctx.inject(['jobs']) + 补发通路

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
接线：主链路插入闸门 + ctx.inject(['jobs']) + 补发通路

## 解决什么问题
前一张卡做出了「要不要压住这条完成通知」的判断，但判断本身不会改变任何行为——通知还是照发。
这张卡把判断真正接进通知链路：每轮开始记一笔、每轮结束时问一次、被压住的那条等后台活干完自动补上。
同时接上 DSH 的后台任务信息源；接不上（或用户把开关关掉）时，行为与升级前一模一样。

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
**人会看到的变化**：后台还在跑时群里不再出现「会话已完成」；活干完（且会话确实闲下来）后自动补上那一条，
补的内容与正常通知一字不差（包括「你说了什么」）。没接上后台任务信息源时，通知照旧发，只多一条提示日志。

工程验收口径：跑 `node --test test/jobs-gate.test.js` 退出码 0；接线层断言逐条通过：注入假 registry 后 handle(turn/end) 返回 action:'dropped'/reason:'job-running' 且本地接收端 0 条；settle + 推进宽限 → 接收端恰好 1 条且与基线报文逐字段相等（忽略 at）；宽限内 turn/start → 0 条补发、随后该轮 turn/end → 1 条 sent；jobAwareComplete:false 与不注入 jobs 两种情形均 action:'sent'。

## 实施方案（implementation）
index.js：createNotifier 接受可选 options.jobs/jobGraceMs/clock/timers 并建闸门，闸门的 deliver 接到 dispatch(session, intent, now, {prompt})；handle() 内 turn/start → gate.noteTurnStart(会话 id)，完成意图且非 goal 自动轮静默后再过闸门，抑制时返回 {action:'dropped', reason:'job-running', intent, jobIds}；deliverToTarget 改为 extra.prompt ?? prompts.take(session)（补发时该轮 prompt 已被 clear，必须用捕获值）；apply() 增 ctx.inject(['jobs'], jobCtx => jobCtx.effect(() => runtime.gate.attach(jobCtx.jobs)))，dispose 顺序为先注销监听与计时器再清状态；补接线层用例 TC-3/4/5/10/11/12/15/16/18/19。

## 上游产出摘要（dependsSummary）
- 配置契约：新增 volatile 开关 jobAwareComplete
- 判定闸门模块 src/jobs.js（纯内存 + 判定层单测）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:36:52.566Z，窗口 session-b04b5777-de03-4582-8e15-756f94d43cf8）

接线完成：从这一刻起，后台还在跑就不会再收到「会话已完成」，活干完自动补上那一条（内容与正常通知一字不差）；没有后台任务信息源时行为与升级前完全一样。

### 完成项

- 把判断接进主链路：turn/start 记轮次起点、turn/end 判完成意图后过闸门、被压住时返回 drop(job-running) 并留 pending
- 接通 DSH 后台任务信息源（ctx.inject(['jobs']) 可选依赖），服务不在/形状不符自动降级为旧行为
- 补发通路打通：job 全部结算 + 宽限到点且无新轮次 → 经**同一条** dispatch 补发，复用渠道打包与过滤；被抑制那一轮的「你说了什么」从捕获值回填
- 清理纪律：dispose 顺序为先摘接线与计时器再清状态；闸门幂等 dispose，无悬挂计时器（TC-14b 断言）
- 四张子卡全部 done：研发（t-f468d1）/ 联调（t-ce6b74，真 HTTP 接收端三条链路）/ 复核（t-1e395e，结论无偏离）/ 测试（t-cbf134，全量 266/266）
- 父卡验收（接线层 6 条断言）逐条达成：drop 时接收端 0 条、补发恰好 1 条且与基线逐字段相等、换轮次不重复、双 job 等最后一个、开关关闭与未接服务均照常发

### 改动文件

- `index.js`
- `test/jobs-gate.test.js`

### 下一步

t4 兼容回归卡（全量 + 降级等价报告）、t5 排障文档卡（drop 原因码）、t6 e2e 联调卡。

---
