# 实施评审报告（REQ-261001202058-0fbe）

> 评审对象：6 张任务卡的交付物（`src/jobs.js` 新增、`index.js` 接线、`src/config.js` 新增配置键、
> `test/jobs-gate.test.js` 新增用例、`docs/guides/operations.md` 排障口径）
> 评审基准：`requirement.md`（6 条 FR）、`design/`（5 份设计文档）、`decomposition.md`（6 张卡）
> 评审方式：逐文件对照设计契约 + 跑通全部卡级验收命令 + 两份证据报告对账

## 结论

**建议通过验收**，附一条**建议人工核实项**（见「验收前建议人工核实」）。

- 6 条 FR 全部有实现对位，无孤儿条款、无超范围实现（`unreceived_clauses: []`）；
- 全量测试 **266/266 通过**（改动前基线 241/0；新增 25 条全绿），既有断言**零改写**；
- 出站 v1 报文契约零变更（补发报文与正常投递**逐字段相等**，有真 HTTP 接收端断言）；
- 两条降级路径（无 job 服务 / 开关关闭）逐条等于改动前行为。

## 逐项评审

| 评审项 | 结论 | 依据 |
|---|---|---|
| 接口契约：消费 `ctx.jobs` | ✅ 一致 | 只用 `list(caller)` 与 `events.subscribe`；形状校验拒绝缺方法/缺 events；`output` 事件（无 `job` 字段）先判存在再读（`src/jobs.js:104-118`） |
| 接口契约：`createJobGate` 成员 | ✅ 一致 | attach/detach/noteTurnStart/gate/observe/pendingOf/dispose 与 `design/interfaces.md §2` 逐项对齐，`reason` 四值齐备且全部落在「不抑制」分支 |
| 接口契约：`handle()` 返回 | ✅ 一致 | 抑制时 `{action:'dropped', reason:'job-running', intent, jobIds}`（`index.js:234-239`），其余返回形状未变 |
| 数据契约：新配置键 | ✅ 一致 | `jobAwareComplete` boolean/默认 true/`.volatile()`，四处登记同进同出；非法值回落 + 恰好一条 warn |
| 数据契约：进程内状态 | ✅ 一致 | `turnStarts` / `pending`（含 watched 集合）按会话清理；无落盘变更（`targets.json` / `bindings.json` 一字未动） |
| 迁移与兼容（FR-4/FR-5） | ✅ 一致 | `tests/compat-report.md`：既有 30 个测试文件 241 条用例天然走降级路径全部原样通过；回滚 = 改一行配置（热改）或卸载（零残留） |
| 失败隔离 | ✅ 一致 | 判定与事件回调全部 try/catch + warn；`apply` 的 handler 外层再兜一层；e2e 断言无未捕获异常、接收端 0 误发 |
| 出站契约不变（FR-5） | ✅ 一致 | 未触碰 `classify/router/deliver/payload/channels`；TC-18 用真接收端断言补发与基线报文逐字段相等（忽略 `at`） |
| 可观测（FR-6） | ✅ 一致 | 抑制走 `reason:'job-running'` + debug 日志（带 job id）；补发走 info 日志；`operations.md` 排查清单第 2 步与原因码表各一行 |
| 代码形态 | ✅ 合规 | Host-only、ESM、**零新增依赖**（`package.json` 未动）、无客户端半改动、无 `node:` 依赖进入判定模块 |

## 发现与偏差（逐条给结论）

| # | 偏差 / 发现 | 性质 | 结论 |
|---|---|---|---|
| 1 | 自动生成子卡的模板验收口径为 `npx vitest` / `npx tsc --noEmit`，与本包工具链（`node --test`，无 TypeScript、零 devDependencies）不符 | 工具模板与本仓不匹配 | **已逐张修订**（`reqboard_task_move(acceptance=…)`，共 10 张子卡），改为仓库真实命令；卡上留有修订说明 |
| 2 | `pending` 记录除设计列出的 `{session,intent,prompt,watched,timer}` 外另存 `jobIds` 数组 | 内部实现扩展，**行为零偏离** | 接受。仅用于日志与补发 meta，内容与 `watched` 等价 |
| 3 | `test/config.test.js` 的**测试标题文案**由「恰好这 9 个」改为「恰好这 10 个」 | 文档性改动，非断言改写 | 接受。该用例断言的是 schema volatile 集合与 `VOLATILE_KEYS` 相等，两侧同时新增即继续成立；已在兼容报告 §4 声明 |
| 4 | 子卡模板默认按「研发/联调/复核/测试」四段展开，其中「联调」段的验收在有真接收端用例时才成立 | 流程形态 | 接受。t3/t6 的联调段确实以真 HTTP 接收端承担，非空转 |
| 5 | **真实 Host（真 profile + 真 `ctx.jobs` + 真后台 job）内的联调未做** | **验证缺口，非代码缺陷** | **建议人工核实**（见下节）。测试内的 registry 是假件；`ctx.inject(['jobs'])` 只在假 ctx 上验证过就绪/回收 |

## 风险与遗留

| 项 | 影响 | 处置 |
|---|---|---|
| 真实 Host 未联调 | 「假 registry 下全绿」不等于「真 Host 下一定接上」 | 见下节人工核实步骤；即便接不上也只会退化为旧行为（有 warn 可查），不会更糟 |
| 宽限窗口（1500ms）内唤醒迟到 → 可能多一条通知 | 罕见（默认 `wakeup` 下 `turn/start` 在毫秒级） | 已在 `design/architecture.md §9` 记账；窗口可由 `jobGraceMs` 调大 |
| 常驻 job 所在那一轮不补发 | 与「活还没完」语义一致 | 已记账；FR-2 保证常驻 job 不静音**后续**轮次 |
| `turnStarts` 不做会话级回收 | 每条仅一个 number，与架构 §9 记账一致 | 已记账；`dispose` 时清空 |

## 验收前建议人工核实

1. 重启一次 Desktop Host 让新代码装载（会中断当前会话，请自行择时）；
2. 在任意会话里让 agent 起一个后台 job（如 `run_in_background` 的 bash`sleep 60`），本轮结束后：
   - Host 日志应出现 `[dsh-notice-webhook] jobs: 抑制完成通知：会话 … 仍有本轮 job 未结算（bash-N）`；
   - 群里**不应**出现「会话已完成」；
3. 等 job 跑完（agent 被唤醒并收尾那一轮结束）后：群里应收到**恰好一条**「会话已完成」；
4. 若第 2 步日志里看到的是 `job 服务不可用或形状不符…降级为旧行为`，说明该 profile 的组合里没有 job 服务——
   属预期降级，不是故障；此时可到看板反馈，走返工卡把降级原因查清。
