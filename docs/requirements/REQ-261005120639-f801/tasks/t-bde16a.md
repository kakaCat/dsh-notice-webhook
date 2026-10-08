# t-bde16a 接线层：ctx.agents 注入 + subagent/end 复检

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
接线层：ctx.agents 注入 + subagent/end 复检

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/jobs-gate.test.js 退出码 0；grep -n "subagent/end" index.js 命中接线与 dispose 两处。接线层断言：注入假 agents 后 handle(turn/end) → action:'dropped' / reason:'subagent-running' 且接收端 0 条；子代理转 idle + observeSubagentEnd() + 推进宽限 → 接收端恰好 1 条且与基线完成报文逐字段相等（忽略 at）；宽限内 turn/start → 0 条补发；jobAwareComplete:false 与不注入 agents → action:'sent'。

## 实施方案（implementation）
index.js：createNotifier 增 options.subagents（单测注入假件，生产由接线层传）；handle() 抑制分支返回 {action:'dropped', reason: verdict.reason, intent, jobIds: verdict.jobIds, subagentIds: verdict.subagentIds}；apply() 增 ctx.inject(['agents'], agentsCtx => agentsCtx.effect(() => runtime.gate.attachSubagents(agentsCtx.agents))) 与 ctx.on('subagent/end', () => { try { runtime.gate.observeSubagentEnd() } catch (error) { logger?.warn?.(...) } })；dispose() 先摘 offSubagentEnd 再 runtime.dispose()。

## 上游产出摘要（dependsSummary）
- 判定层：闸门看两路活（job + subagent 后代）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-05T04:36:32.405Z，窗口 session-df00704c-5bd1-4d81-a003-3d3a4b648ea4）

接线层这一步做完：插件真正接上了子代理这条事实源——过去它只看得见后台 job，所以 agent 派出去的子代理还在跑时也会报「会话已完成」；现在子代理在跑就不报，子代理结束才补一条真的完成通知。

### 完成项

- 插件在真实运行时主动订阅子代理结算事件（subagent/end），子代理一结束就复检该不该补发完成通知
- 插件在真实运行时主动获取 agent 注册表（ctx.inject([agents])），拿不到就自动降级为旧行为，不影响既有 job 判定
- 抑制结果里带上原因码与 id 列表，排障能直接看出是被后台 job 还是被子代理压住
- 卸载时三处新接线（agents / subagent/end）全部摘掉，不留悬挂监听
- 本卡 4 张子卡（研发/联调/复核/测试）全部完成：jobs-gate 38/38、全量 320/320 全绿
- 验收锚点 grep -n subagent/end index.js 命中接线与 dispose 两处

### 改动文件

- `index.js`
- `test/jobs-gate.test.js`

---
