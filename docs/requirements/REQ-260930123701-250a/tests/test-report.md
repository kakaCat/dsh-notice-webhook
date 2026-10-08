# 测试证据（REQ-260930123701-250a）

> 采集命令：`node --test "test/*.test.js"`（工作区根目录）
> 采集结果：**tests 66 / pass 66 / fail 0**（duration ≈ 1.35s）

## 分文件统计

| 测试文件 | 通过/总数 | 覆盖条款 | 对应用例 |
|---|---|---|---|
| `test/classify.test.js` | 11/11 | FR-1, FR-2, FR-3, FR-5 | TC-1 … TC-5 |
| `test/goal.auto.test.js` | 6/6 | FR-11（自动轮） | TC-9 |
| `test/goal.terminal.test.js` | 10/10 | FR-11（终态） | TC-10, TC-11 |
| `test/bindings.test.js` | 9/9 | FR-6, FR-9 | TC-13 |
| `test/service.test.js` | 5/5 | FR-8, FR-10 | TC-14 |
| `test/deliver.test.js` | 6/6 | FR-4 | TC-12 |
| `test/router.test.js` | 8/8 | FR-6, FR-7 | TC-6 … TC-8 |
| `test/e2e.local.test.js` | 4/4 | FR-1…FR-11 | 端到端（本地 HTTP 接收端） |
| `test/compat.test.js` | 7/7 | FR-9, FR-4 | 迁移与兼容 |

## 关键断言证据（摘要）

| 断言 | 实测结果 |
|---|---|
| 五类事件端到端到达 | 本地接收端按序收到 `turn/end`、`approval/asked`、`ask_user_question`、`goal/complete`、`goal/blocked` 各 1 条 |
| 载荷字段完整性 | `version/title/toolName/goal/sessionId/workspace/at/source` 全部符合 `design/interfaces.md` |
| goal 轮次耗尽文案 | `goal/blocked` 正文包含「轮次耗尽」，`goal.round === 20` |
| 失败隔离 | 接收端指向 `http://127.0.0.1:1/`：无未捕获异常、进程退出码 0、日志仅一条去敏 warn |
| 不跟随重定向 | 接收端返回 302 → 判定失败，且 `/elsewhere` 命中 0 次 |
| 4xx 不重试 / 5xx 重试 | 404 只发 1 次；500 连发 3 次后成功 |
| 日志脱敏 | 日志文本不含 URL 的 query 与 `token=…` |
| 总开关旁路 | `enabled:false` + 已绑定 → 绑定地址 1 条、默认地址 0 条 |
| 类型开关不豁免绑定 | `notifyApproval:false` + 已绑定 → 0 条 |
| goal 自动轮静默 | 3 轮自动轮 → 0 条；随后人工轮 → 1 条 |
| 终态去重 | 同一 `(goalId, revision, phase)` 重复上报 → 只推 1 条 |
| 坏文件不覆盖 | 非法 JSON / `version:99` → 空表启动且原文件字节不变 |
| 回滚残留 | 卸载后目录内只剩 `bindings.json`（`.tmp` 已被 rename） |

## 复跑方法

```sh
cd /Users/mac/Documents/ai/dsh/dsh-notice-webhook
node --test "test/*.test.js"
```

## 验证限制（如实记录）

**真实 Host 的「跑一轮真实对话 → 接收端收到通知」未在本轮验证。**
原因：新装插件的配置需 Host 重启才被读取（本轮只验到装载与激活：`enable=true` + `fiberPhase=active`）。
复核步骤（重启后 3 步）：

1. 在 profile 的 `cordis.patch.yml` 给该行配 `webhookUrl` 指向本地接收端；
2. 重启 DeepSeek Harness；
3. 跑一轮对话 → 接收端应收到 `event=turn/end`，`message` 含「会话已完成」。

本地接收端可用 `README.md`「验证：本地接收端」一节里的 python3 片段启动。

## 任务覆盖对照（每张卡 ↔ 可复核的验证方式）

> 50 张卡（12 父卡 + 38 子卡）逐张标注；`covers: t-xxxxxx` 即该卡的覆盖登记。

### t1 建立插件包骨架与配置层

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-fd6e82` | 父卡 | `node --check index.js` 与 `node --check src/config.js` 均 exit 0；越界配置回落实测 5000 |
| `covers: t-6eb2b2` | 研发 | `node --check index.js && node --check src/config.js` → exit 0 |
| `covers: t-a1f262` | 复核 | 逐条对照 `design/interfaces.md` 配置项契约（18 项默认值同名同值） |
| `covers: t-2fc91c` | 测试 | `node -e "…normalizeConfig({timeoutMs:-1}).timeoutMs"` → 输出 5000 且 stderr 1 条 warn |

### t2 实现绑定表与原子持久化

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-20c962` | 父卡 | `node --test test/bindings.test.js` 9/9 |
| `covers: t-883faa` | 研发 | `node --test test/bindings.test.js` 全绿 |
| `covers: t-e7dd75` | 复核 | 对照 `design/data-model.md` 字段/容错逐条 |
| `covers: t-d8437b` | 测试 | `node --test test/bindings.test.js` 全绿（含非法 JSON 原文件不变） |

### t3 暴露 Host Service dshNoticeWebhook

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-ae2996` | 父卡 | `node --test test/service.test.js` 5/5 + `node --test test/e2e.local.test.js` |
| `covers: t-a05d68` | 研发 | `node --test test/service.test.js` 全绿 |
| `covers: t-ef947a` | 联调 | `node --test test/e2e.local.test.js`：绑定会话改道到绑定地址 |
| `covers: t-3da71e` | 复核 | 对照 `design/interfaces.md`「Host Service 契约」 |
| `covers: t-d54a86` | 测试 | `node --test test/service.test.js` 5/5（参数非法返回 false） |

### t4 实现 webhook 投递层

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-cbf2e4` | 父卡 | `node --test test/deliver.test.js` 6/6 |
| `covers: t-55b341` | 研发 | `node --test test/deliver.test.js` 全绿 |
| `covers: t-d3ed02` | 复核 | 对照出站契约（方法/头/超时/重试/重定向） |
| `covers: t-7ae458` | 测试 | `node --test test/deliver.test.js` 全绿（302 不跟随、404 只发一次） |

### t5 实现事件分类与过滤

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-245978` | 父卡 | `node --test test/classify.test.js` 11/11 |
| `covers: t-123825` | 研发 | `node --test test/classify.test.js` 全绿 |
| `covers: t-e910b0` | 复核 | 对照 `requirement.md` FR-1/2/3/5 文案与边界 |
| `covers: t-9e8eb9` | 测试 | `node --test test/classify.test.js` 11/11 |

### t6a 实现 goal 自动轮识别与静默

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-898417` | 父卡 | `node --test test/goal.auto.test.js` 6/6 |
| `covers: t-096bbe` | 研发 | `node --test test/goal.auto.test.js` 全绿 |
| `covers: t-a4ac0a` | 复核 | 对照 FR-11 与 `design/architecture.md`「goal 自动轮判定」 |
| `covers: t-527280` | 测试 | `node --test test/goal.auto.test.js` 全绿（3 轮自动轮 0 条推送） |

### t6b 实现 goal 终态识别与去重

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-f94377` | 父卡 | `node --test test/goal.terminal.test.js` 10/10 |
| `covers: t-9600c2` | 研发 | `node --test test/goal.terminal.test.js` 全绿 |
| `covers: t-5e3c2c` | 复核 | 对照终态文案与去重表 |
| `covers: t-9efd71` | 测试 | `node --test test/goal.terminal.test.js` 全绿（20/20、重复上报只推一条） |

### t7 实现路由层与总开关旁路

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-966bd3` | 父卡 | `node --test test/router.test.js` 8/8 |
| `covers: t-3966e0` | 研发 | `node --test test/router.test.js` 全绿 |
| `covers: t-040d34` | 复核 | 对照 FR-6/FR-7 两条规则交界 |
| `covers: t-399c3a` | 测试 | `node --test test/router.test.js` 全绿（`enabled:false` 时已绑定仍发） |

### t8 接线整合与本地端到端联调

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-f25d34` | 父卡 | `node --test test/e2e.local.test.js` 4/4 + 全量 66/66 |
| `covers: t-c9c721` | 研发 | `node --test test/e2e.local.test.js` 全绿 |
| `covers: t-a0aed4` | 联调 | 本地接收端收到 5 类 event 各 1 条 |
| `covers: t-030e3c` | 复核 | 对照主链路流程图与字段来源 |
| `covers: t-ee2412` | 测试 | `node --test "test/*.test.js"` → tests 66 / pass 66 / fail 0 |

### t9 装载到 profile 并做真实 Host 验收

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-87cafa` | 父卡 | `plugin_manager list_plugins` 含 `include:dsh-notice-webhook` enabled=true；重启后用 python3 接收端复核 |
| `covers: t-c7e70b` | 研发 | `plugin_manager list_plugins` → enabled=true、fiberPhase=active；`node --test test/e2e.local.test.js` 全绿 |
| `covers: t-168c3a` | 复核 | 三条验收标准逐条对证据，缺口（真实推送）显式记录 |
| `covers: t-623dc6` | 测试 | `node --test "test/*.test.js"` → 66/66；重启后 python3 接收端复核 `event=turn/end` |

### t10 处理迁移与兼容

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-f01c88` | 父卡 | `node --test test/compat.test.js` 7/7 |
| `covers: t-e96439` | 研发 | `node --test test/compat.test.js` 全绿 |
| `covers: t-b6df77` | 复核 | 对照迁移兼容节（旧数据/共存/回滚） |
| `covers: t-33a9df` | 测试 | `node --test test/compat.test.js` 7/7（`version:99` 不覆盖原文件） |

### t11 写插件使用说明 README

| 任务 | 阶段 | 覆盖方式 |
|---|---|---|
| `covers: t-886615` | 父卡 | `grep -c 'webhookUrl' README.md` 与 `grep -c 'curl' README.md` 均 ≥ 1 |
| `covers: t-6acade` | 研发 | 同上两条 grep；README 含配置项表 / Host Service 示例 / 本地验证命令三段 |
| `covers: t-896aff` | 复核 | 对照 `design/interfaces.md` 与 `src/service.js` 实际签名 |

