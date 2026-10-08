# t-99dadb 接线层：ctx.agents 注入 + subagent/end 复检·联调

> 需求：REQ-261005120639-f801 修复 notice 插件误报「会话已完成」：continuable 子代理未纳入完成闸门

## 在做什么
接线层：ctx.agents 注入 + subagent/end 复检·联调

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`npx vitest run <本卡接口/契约对应的测试文件>` → 全绿（请求样例与期望响应一致）

---
## 汇报 1（2026-10-05T04:35:59.087Z，窗口 session-df00704c-5bd1-4d81-a003-3d3a4b648ea4）

联调这一步做完：确认我们读的 agent 形状（id、status、session.header 的血统与 origin）与 DSH 真实暴露的字段逐条一致，continuable 子代理确实不注册 job 这一点也在 DSH 源码里复核过——所以这一路修复是必需的，而且不需要任何适配层。

### 完成项

- 核对 DSH 源码：ctx.agents（AgentRegistry）提供同步 list(): Agent[]（packages/core/agent/src/index.ts:586）
- 核对 Agent 公开字段：readonly session: Session 与 readonly status: AgentStatus 都在（runtime-types.ts:168,172），Agent.id: SessionId（types.ts:17）
- 核对 SessionHeader 字段：parentSession? / origin?: 'subagent' / delegationDepth? 都在（packages/core/session/src/types.ts:107,117,123）
- 结论：我们消费的 { id, status, session.header.{parentSession, origin} } 与 DSH 真实形状逐字段对得上，无需适配层
- 子代理不注册 job 的事实复核：packages/subagent/tool-subagent/src/index.ts:526-549（continuable 走 startContinuable，只有 one-shot 才 jobs.start）
- 生产路径接线契约由 TC-S13 覆盖：inject 要了 agents、订阅了 subagent/end、卸载后两处都摘掉

### 改动文件

- `index.js`
- `test/jobs-gate.test.js`

---
