# t-fb44a5 判定层：闸门看两路活（job + subagent 后代）·复核

> 需求：REQ-261005120639-f801 修复 notice 插件误报「会话已完成」：continuable 子代理未纳入完成闸门

## 在做什么
判定层：闸门看两路活（job + subagent 后代）·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
对照 `docs/requirements/<REQ>/design/` 逐条核对；`npx vitest run <相关测试文件>` → 全绿；无偏离时显式写明「无偏离」及依据

---
## 汇报 1（2026-10-05T04:34:14.074Z，窗口 session-df00704c-5bd1-4d81-a003-3d3a4b648ea4）

复核这一步做完：确认改动与设计逐条对得上（只读、同步、可降级、出站零变化），并当场修掉一个会让完成通知被静默丢掉的边界缺陷（宽限窗口内子代理被再次唤醒）；结论是「一处实现缺陷已修，其余无偏离」。

### 完成项

- 逐条核对设计：接口签名、pending 字段、三态原因码、pendingOf 快照、降级语义均与 design/interfaces.md 与 data-model.md 一致
- 不变量一：只读 —— grep 无 import / require / cancel / kill / followup，闸门从不动任何 job 或子代理
- 不变量二：同步 —— grep 无 await，agents.list() 同步调用，判定不阻塞会话
- 不变量三：降级 —— 两路都不可用仍返回 unavailable（既有语义）；只有一路可用时另一路照常工作；形状不符只告警一次
- 不变量四：无出站变化 —— 未触碰 src/classify.js、src/router.js、src/channels/**、src/payload.js 与出站版本号
- 发现并修掉一处真缺陷：宽限到点时若子代理又被唤醒（新 epoch），原写法先删 pending 再返回，会把这条完成通知静默丢掉；改为保留 pending 并允许下次复检重新起窗口
- 为上述修复补 TC-S9 用例锁定行为；复核后 node --test test/jobs-gate.test.js 34/34 全绿

### 改动文件

- `src/jobs.js`
- `test/jobs-gate.test.js`

---
