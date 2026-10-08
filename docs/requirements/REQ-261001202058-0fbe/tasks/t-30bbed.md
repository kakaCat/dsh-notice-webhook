# t-30bbed 判定闸门模块 src/jobs.js（纯内存 + 判定层单测）

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
判定闸门模块 src/jobs.js（纯内存 + 判定层单测）

## 解决什么问题
通知插件过去只有「这一轮结束了」一个信号，没法知道这一轮其实是**把活交给了后台 job**。
这张卡给出这个判断能力：问一次 DSH「本会话还有没有本轮拉起、还没跑完的后台 job」，
有就先把完成通知压住，等最后一个 job 跑完、并且会话确实闲下来，再补一条真完成。

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
**人会看到的变化**：后台还在跑的时候，群里不再收到「会话已完成」；等活真的干完才收到那一条。
判断本身是只读的、拿不准时一律照常发通知（宁可误报，绝不漏报）。

工程验收口径：跑 `node --test test/jobs-gate.test.js` 退出码 0；判定层断言逐条通过：本轮 running job → suppressed:true 且 jobIds 含该 id；startedAt < since（常驻 job）→ suppressed:false；无 turn/start → reason:'no-turn-start'；settle 后推进计时器 → deliver 恰好 1 次；两个 job 需全部 settle 才触发；dispose() 后推进计时器 → 0 次且无未捕获异常。

## 实施方案（implementation）
按 design/interfaces.md §2 实现 isJobRegistryLike() 与 createJobGate({logger, graceMs, clock, setTimer, clearTimer, deliver})，成员 attach/detach/noteTurnStart/gate/observe/pendingOf/dispose 与错误语义逐条对齐；判定式按 design/data-model.md §3（owner===sid、status∈{running,stopping}、startedAt>=最近 turn/start 三重过滤）；observe() 只认 settled/removed 且必须判 event?.job 存在（output 事件没有 job 字段）；所有异常吞掉 + warn。在 test/jobs-gate.test.js 建假 registry（list 返回副本 + 测试侧 settle/remove 助手）/假时钟/假计时器，并写判定层用例 TC-2、3、6、7、8、9、13、14。

## 上游产出摘要（dependsSummary）
- （无依赖）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:33:30.680Z，窗口 session-b04b5777-de03-4582-8e15-756f94d43cf8）

判断能力就位：插件现在能分辨「这一轮真的收工了」和「这一轮只是把活挂到后台」。判定只读、拿不准就照常发通知，因此最坏情况退化成升级前的行为。

### 完成项

- 交付 src/jobs.js（222 行，纯内存判定闸门）+ test/jobs-gate.test.js 的 16 条判定层用例（文件共 282 行）
- 判定层验收逐条达成：本轮 running → suppressed:true 且 jobIds 含该 id；常驻 job（startedAt < since）→ suppressed:false；无 turn/start → reason 'no-turn-start'；settle + 推进计时器 → deliver 恰好 1 次；两个 job 需全部 settle；dispose 后推进计时器 → 0 次且无未捕获异常
- 三张子卡全部 done：研发（t-bf2be8）/ 复核（t-d4d793，结论无偏离）/ 测试（t-e5e744，全量 257/257 绿）
- 子卡模板验收口径按本包工具链修订过（模板抄的 npx vitest / tsc 在本包不存在，改判为 node --test + node --check）

### 改动文件

- `src/jobs.js`
- `test/jobs-gate.test.js`

### 下一步

t3 接线：index.js 里把闸门插进 handle()、接上 ctx.inject(['jobs'])、打通补发通路（extra.prompt），并在 t1/t2 之间收口。

---
