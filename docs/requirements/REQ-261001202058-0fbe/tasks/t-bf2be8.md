# t-bf2be8 判定闸门模块 src/jobs.js（纯内存 + 判定层单测）·研发

> 需求：REQ-261001202058-0fbe 后台 job 运行中不再推「会话已完成」

## 在做什么
判定闸门模块 src/jobs.js（纯内存 + 判定层单测）·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`node --test test/jobs-gate.test.js` → 全绿（本包无 vitest：package.json 的 scripts 只有 `node --test`）；证据附判定过滤实现行号（src/jobs.js 的 owner/status/startedAt 三重过滤）与 16 条判定层用例清单。

---
## 汇报 1（2026-10-01T12:32:44.188Z，窗口 session-b04b5777-de03-4582-8e15-756f94d43cf8）

研发生效：插件从此能自己判断「这一轮是不是把活交给了还在跑的后台 job」——判定结果只有「压住」和「照常发」两种，拿不准时一律照常发；补发的时机由结算事件 + 宽限窗口决定，全程只读 DSH 的 job 列表。

### 完成项

- 新增 src/jobs.js（222 行）：isJobRegistryLike() 形状校验 + createJobGate() 的 attach/detach/noteTurnStart/gate/observe/pendingOf/dispose，纯内存、零 I/O、零第三方依赖
- 判定式落地（src/jobs.js:181-184）：owner===sessionId、status 属于 {running,stopping}（模块级 LIVE_STATUS:19）、startedAt >= 最近 turn/start 三重过滤；LIVE_STATUS 用 Set 常量化
- 保守取向落地：形状不符 → reason 'unavailable' + 一次性 warn；无轮次起点 → 'no-turn-start'；list 抛错/未返回数组 → reason 'error' 且照旧发；observe 内的畸形事件（output 无 job 字段、无 owner）直接返回不抛异常（src/jobs.js:109）
- 计时器与时钟全部注入（graceMs/clock/setTimer/clearTimer/deliver），宽限窗口在单测里瞬时推进，不碰全局 setTimeout
- test/jobs-gate.test.js 扩到 282 行 / 16 条用例：TC-2 降级只告警一次、TC-3 抑制 + pending + prompt、TC-4/5 别人的 job 与已结算不算、TC-6 stopping、TC-7 常驻 job 不静音、TC-8 无起点保守、TC-9 同毫秒边界、TC-13 killed/removed 等价、TC-14 多 job 全结算才补发 + dispose 无悬挂计时器、TC-2b/2c/8b 畸形事件与异常路径
- 验收：node --test test/jobs-gate.test.js → tests 16 / pass 16 / fail 0；node --check src/jobs.js 通过

### 改动文件

- `src/jobs.js`
- `test/jobs-gate.test.js`

### 下一步

复核子卡 t-d4d793：对照 design/interfaces.md §2 与 data-model.md §3 逐条核对；随后 t3 把它接进 index.js 主链路。

---
