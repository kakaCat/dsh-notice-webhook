# t-1c0dc2 配置契约：新增 volatile 开关 jobAwareComplete

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
配置契约：新增 volatile 开关 jobAwareComplete

## 解决什么问题
升级后「会话已完成」的通知会先看后台还有没有活没干完。可万一有人怀疑「最近怎么没收到完成通知」，
需要一个**不用重启 Host、改一行配置就能立刻回到升级前行为**的开关——这样才能一眼分清
「是新判定把通知压住了」还是「真的漏发了」。

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
**人会看到的变化**：插件配置里多了 `jobAwareComplete`（默认开）。把它关掉，下一次通知行为与升级前完全一样；
配置不小心写歪（比如写成字符串）也只是回落默认并留一条告警，插件照常启动。

工程验收口径：跑 `node --test test/config.test.js` 退出码 0；跑 `node -e "import('./src/config.js').then(m=>{const c=m.Config({});console.log(c.jobAwareComplete.get(), m.VOLATILE_KEYS.includes('jobAwareComplete'))})"` 输出恰为 `true true`；normalizeConfig({jobAwareComplete:'yes'}) 返回 true 且 logger 收到 1 条 warn。

## 实施方案（implementation）
src/config.js 四处同进同出：DEFAULTS.jobAwareComplete=true、BOOLEAN_KEYS 增键、Config schema 增 jobAwareComplete: z.boolean().default(true).volatile()、VOLATILE_KEYS 增键；test/config.test.js:35 只把测试标题文案「恰好这 9 个」改成「恰好这 10 个」（该用例断言 schema volatile 集合与 VOLATILE_KEYS 相等，两侧同时新增即通过，零断言改动）；在 test/jobs-gate.test.js 落配置断言（默认值 true、非法值回落 + warn、volatile 集合成员）。

## 上游产出摘要（dependsSummary）
- （无依赖）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:30:21.710Z，窗口 session-b04b5777-de03-4582-8e15-756f94d43cf8）

插件多了一个「后台 job 判定」的总开关：怀疑完成通知被新判定压住时，改一行配置就能立刻回到升级前的行为（不用重启 Host）。配置写歪只回落默认 + 一条告警，插件照常启动。

### 完成项

- src/config.js 四处同进同出登记 jobAwareComplete：DEFAULTS=true、BOOLEAN_KEYS、Config schema（.default(true).volatile()）、VOLATILE_KEYS；并同步了 volatile 字段清单的注释
- test/config.test.js 仅改测试标题文案（恰好这 9 个 → 10 个），零断言改动：该用例比对 schema volatile 集合与 VOLATILE_KEYS 相等，两侧同时新增即通过
- 新增 test/jobs-gate.test.js 的配置契约段（TC-17 ×2 + TC-15）：默认 true、非法值回落 + 恰好一条 warn、关掉读得回来
- 验收命令实测：node --test test/config.test.js → 6 pass / 0 fail；node -e 探针输出 true true；node --test test/jobs-gate.test.js → 3 pass / 0 fail

### 改动文件

- `src/config.js`
- `test/config.test.js`
- `test/jobs-gate.test.js`

### 下一步

t2 判定闸门模块 src/jobs.js（纯内存 + 判定层单测）；随后 t3 接线 index.js。

---
