# t-f66dc8 接线层：ctx.agents 注入 + subagent/end 复检·复核

> 需求：REQ-261005120639-f801 修复 notice 插件误报「会话已完成」：continuable 子代理未纳入完成闸门

## 在做什么
接线层：ctx.agents 注入 + subagent/end 复检·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
对照 `docs/requirements/<REQ>/design/` 逐条核对；`npx vitest run <相关测试文件>` → 全绿；无偏离时显式写明「无偏离」及依据

---
## 汇报 1（2026-10-05T04:36:13.351Z，窗口 session-df00704c-5bd1-4d81-a003-3d3a4b648ea4）

复核这一步做完：接线与既有 job 接线同构、异常隔离与清理顺序都对，结论「无偏离」；另记下一条残余风险（若子代理结算事件某组合下收不到且父会话没被唤醒，则补发不会发生），留到验收材料里明示。

### 完成项

- 对照设计逐条核对：options.subagents 注入、handle() 返回 reason/jobIds/subagentIds、ctx.inject([agents])、ctx.on(subagent/end)、dispose 顺序，全部与 design/interfaces.md §2 一致
- 接线模式与既有 ctx.inject([jobs]) 完全同构（服务就绪才回调、effect 负责回收），没有引入新的生命周期写法
- 异常隔离复核：subagent/end 回调 try/catch 兜住，未捕获异常不会打断子代理结算或会话
- 清理顺序复核：先摘 jobs/agents/subagent/end 三处接线，再 runtime.dispose() 清 pending 与计时器，最后摘既有 session/event 与提问订阅
- 结论：无偏离（依据 = design/interfaces.md §2 与 §4 的接线契约 + TC-S13 生产路径断言）
- 记录一条残余风险：若 subagent/end 事件在某组合下不被投递、且父会话始终没被唤醒，则这次补发不会发生；缓解是父会话被唤醒时新轮次的 turn/end 会正常通知，且该事件与 session/event 走同一条派发路径（已被验证可达）

### 改动文件

- `index.js`

---
