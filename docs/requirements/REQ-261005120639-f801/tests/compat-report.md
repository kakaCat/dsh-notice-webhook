# 兼容与回归报告 · REQ-261005120639-f801

> 结论：**新增行为全部落在「完成闸门」内部，既有对外契约零变化**；唯一触碰的既有断言是 2 处内部诊断码
> （`no-jobs` → `no-work`）。全量 `320 / pass 320 / fail 0`（开工前基线 `307 / pass 307`，只增不减）。

## 1. 基线对比

| 时点 | 命令 | 结果 |
|---|---|---|
| 开工前 | `npm test` | tests 307 / pass 307 / fail 0 |
| t1 后 | `npm test` | tests 315 / pass 315 / fail 0 |
| t2 后 | `npm test` | tests 320 / pass 320 / fail 0 |
| 收口 | `node --test "test/*.test.js"` | tests 320 / pass 320 / fail 0 |

## 2. 唯一触碰的既有断言（2 处）

`src/jobs.js` 的 `gate()` 在「两路都没有活」时的**内部诊断码**由 `no-jobs` 改名为 `no-work`
（该字段只进日志与测试，不进任何出站报文）。对应两处既有断言同步更新：

| 文件:行 | 改动前 | 改动后 | 说明 |
|---|---|---|---|
| `test/jobs-gate.test.js:193`（TC-4 别的会话的 job 都不算） | `reason:'no-jobs'` | `reason:'no-work'` | 语义不变：没有活 → 照发 |
| `test/jobs-gate.test.js:214`（TC-7 常驻 job 不参与抑制） | `reason:'no-jobs'` | `reason:'no-work'` | 语义不变：常驻 job 不静音该会话 |

**逐字保留**、未改一处的既有语义：`'unavailable'`（两路都不可用）、`'no-turn-start'`（无轮次起点）、
`'error'`（job 源判定抛错）、`'job-running'`（只有未结算 job 时）。
校验命令与结果：`grep -rn "no-jobs" test/ src/` → **0 命中**。

## 3. 降级路径与旧行为等价（证据 = 用例名 + 断言）

| 降级场景 | 用例 | 断言 |
|---|---|---|
| 两路事实源都没有 | `TC-2 job 服务形状不符：降级为「不抑制」，且只告警一次` / `TC-S5 只有一路可用时，另一路照常工作` | `{suppressed:false, reason:'unavailable'}`；`handle()` 返回 `action:'sent'` |
| 没有 job 服务（老组合） | `TC-16 接线：没注入 job 服务（降级）→ 照常发，且只留一条降级 warn` | `action:'sent'` + 接收端 1 条；生产路径不主动 attach，无端告警 |
| job 服务形状不符 | `TC-16b` | `action:'sent'` + 恰好 1 条降级 warn |
| 没有 agents 服务（新组合降级） | `TC-S12` | `action:'sent'`（子代理这一路不判定，job 路不受影响） |
| agents 形状不符 / `list()` 抛错 / 非数组 | `TC-S6` | 不抛异常、按「没活」处理、warn 只报一次 |
| 总开关关闭 | `TC-15`（job）/ `TC-S12`（子代理） | `jobAwareComplete:false` → `action:'sent'`，抑制与补发都不发生 |

## 4. 明确未改动的对外面（回归靠既有测试）

`src/classify.js`（终态分类表）、`src/router.js`、`src/goal.js`、`src/payload.js`、`src/bindings.js`、
`src/targets.js`、`src/outcomes.js`、`src/rpc.js`、`src/deliver.js`、`src/channels/**`、`client.js`、
`src/config.js`（**无新增键**）、`package.json`（**无新增依赖**）、出站 v1 报文契约。

印证：
- `TC-10/18/19` 断言「补发报文与正常投递逐字段一致（忽略 `at`）」；
- `TC-S10` 用**真 HTTP 接收端**复算同一条链路，结论相同；
- 全量 320 条既有 + 新增用例无一条失败（含 `compat*.test.js` / `e2e.*.test.js` / `client-*.test.js`）。

## 5. 残余风险（明示，不隐藏）

1. **子代理结算事件不可达的组合**：若 `subagent/end` 在某组合下收不到、且父会话始终没被唤醒，
   这次补发不会发生（不引入轮询是有意取舍）。缓解：父会话被唤醒时新轮次的 `turn/end` 会正常通知；
   该事件与 `session/event` 走同一条派发路径（后者已被现网验证可达）。
2. **长命子代理**：子代理卡在授权/长任务上时，父会话的「已完成」会一直被压住——这正是「还有活」的语义；
   使用者仍能从子代理自身的界面看到它在跑。
3. **`agents.list()` 形状漂移**（DSH 升级）：形状不符即整路降级照发，不会误抑制（`TC-S6` 锁定）。

## 6. 覆盖标注（本报告覆盖的任务卡）

判定层（`test/jobs-gate.test.js` 的 TC-S1…TC-S9 + TC-1…TC-14）覆盖：

- covers: t-200413
- covers: t-776b2f
- covers: t-fb44a5
- covers: t-405c41

回归与降级（本报告 §1–§4 的命令与输出）覆盖：

- covers: t-1809aa
- covers: t-23a870
- covers: t-23d4c6
- covers: t-30dd89

文档口径（本报告与 `docs/guides/operations.md`、`docs/architecture/*.md` 的锚点核对）覆盖：

- covers: t-d94488
- covers: t-07352e
- covers: t-9c31b2

