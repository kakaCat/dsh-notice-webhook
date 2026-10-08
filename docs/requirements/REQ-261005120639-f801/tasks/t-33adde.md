# t-33adde 接线层：ctx.agents 注入 + subagent/end 复检·测试

> 需求：REQ-261005120639-f801 修复 notice 插件误报「会话已完成」：continuable 子代理未纳入完成闸门

## 在做什么
接线层：ctx.agents 注入 + subagent/end 复检·测试

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`pnpm test` → 失败数 ≤ 开工前基线；`npx tsc --noEmit` → 错误数 ≤ 基线（贴汇总输出）

---
## 汇报 1（2026-10-05T04:36:25.302Z，窗口 session-df00704c-5bd1-4d81-a003-3d3a4b648ea4）

测试这一步做完：接线层 4 条新用例全绿，全量 320/320 通过、相对本卡开工前只增不减；「子代理在跑就不报完成、子代理结束后补一条真的完成」这条链路已经有端到端（真 HTTP 接收端）证据。

### 完成项

- node --test test/jobs-gate.test.js → tests 38 / pass 38 / fail 0（其中 TC-S* 共 13 条：9 条判定层 + 4 条接线层）
- npm test（全量）→ tests 320 / pass 320 / fail 0；相对 t2 开工前基线 316 只增 4 条，既有用例零失败
- 接线层断言覆盖：注入假 agents 后 turn/end 被压住且接收端 0 条、子代理结束后宽限到点恰好补发 1 条且与基线报文逐字段相等、宽限内新轮次不补发且新轮次正常投递 1 条、开关关闭与未注入 agents 都逐字回旧行为
- 生产路径断言（TC-S13）：inject 向 agents 服务要过、subagent/end 订阅上了、卸载后订阅摘掉
- 本仓无 TypeScript 工程，npx tsc --noEmit 不适用；以 node --test 汇总为准

### 改动文件

- `test/jobs-gate.test.js`
- `index.js`

---
