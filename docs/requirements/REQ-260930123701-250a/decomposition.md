# 拆分计划（REQ-260930123701-250a）

> 目标 + 做法一句话：**做一个 Host-only 的 Cordis 插件包 `dsh-notice-webhook`，把 DSH 会话的三类"该被叫一声"事件（对话完成 / 等待授权 / 等待回答）POST 到配置的 webhook，并在其上叠加两层——会话窗口级地址绑定（总开关关闭时旁路照发）与 goal 自动轮静默（只在目标终态推送）；契约见 design/interfaces.md，数据见 design/data-model.md。**
> 本计划须**人批准**后才能落任务卡（`reqboard_decompose`）。

## 编号口径

| 编号 | 出自 | 指什么 |
|---|---|---|
| FR-x | [requirement.md](../requirement.md) 功能点表 | 需求条款（FR-1 … FR-11） |
| TC-x | [design/test-cases.md](../design/test-cases.md) 用例表 | 测试用例（TC-1 … TC-14） |
| UC-x | [design/use-cases.md](../design/use-cases.md) 场景总览 | 用户场景（UC-1 … UC-3） |
| t-x | 本文档任务表 | 任务（计划 key 即 `t1` … `t11`） |

**本需求的两点编号约定**（与模板默认不同，先声明避免"悬空引用"误判）：

- design/interfaces.md **没有**启用 `I-x` 编号，接口在「覆盖对照」里按**条目名**引用（出站契约 / Host Service / 配置项契约）——这些条目名在 interfaces.md 中真实存在。
- 「页面/模块」列写**模块文件路径**（本插件是 Host-only，无 frontend.md / backend.md 编号体系，落点即文件）。

## 改动盘点

**新增**（本插件是新包，无存量代码，全部为新增）：

| 文件 | 内容 |
|---|---|
| `package.json` | 包清单：`type: module`、`dsh.bundle.patch` 指向加载补丁、无第三方依赖 |
| `cordis.patch.yml` | 装载行（`insert` 一条 `id: dsh-notice-webhook`） |
| `index.js` | `apply(ctx, config)`：只做接线，不含业务判定 |
| `src/config.js` | 默认值与取值规整（类型不符/越界回落默认 + warn） |
| `src/classify.js` | `session/event` → 通知意图；类型开关、顶层/中断/冷却过滤 |
| `src/goal.js` | goal 自动轮识别（静默）+ 终态识别（完成 / 阻塞 / 轮次耗尽） |
| `src/router.js` | 地址解析：绑定 > 默认 > 丢弃；总开关旁路语义 |
| `src/deliver.js` | POST JSON、超时、重试、重定向不跟随、脱敏日志 |
| `src/bindings.js` | 绑定表 + 原子持久化（tmp + rename）+ 读取容错 |
| `src/service.js` | `ctx.provide('dshNoticeWebhook', …)` |
| `test/*.test.js` | `node:test` 单测与本地端到端用例 |
| `README.md` | 安装、配置项表、webhook 契约与 curl 示例 |

**修改**：无（新包）。
**删除**：无。

## 任务表

| 计划 key | 任务 id | 标题 | 覆盖条款 | 落点（编号+文件） | 阶段 | 端侧 | 依赖 | 工作量 | 验收标准 | 子卡段 |
|---|---|---|---|---|---|---|---|---|---|---|
| t1 | （落库后回填） | 建立插件包骨架与配置层 | FR-1, FR-4 | 出站契约 + `package.json` / `cordis.patch.yml` / `index.js` / `src/config.js` | implement | backend | — | S | `node --check index.js` 与 `node --check src/config.js` 均通过；且 `node -e "import('./src/config.js').then(m=>console.log(m.normalizeConfig({timeoutMs:-1}).timeoutMs))"` 输出 `5000`（越界回落默认），同时日志出现 1 条 warn | dev, review（skipIntegration） |
| t2 | （落库后回填） | 实现绑定表与原子持久化 | FR-6, FR-9 | 数据契约 + `src/bindings.js` | implement | backend | t1 | M | `node --test test/bindings.test.js` 全绿；用例含：`bind()` 后文件内容为 `{"version":1,...}`；把文件写成非法 JSON 后 `list()` 返回空数组且原文件字节不变 | dev, review（skipIntegration） |
| t3 | （落库后回填） | 暴露 Host Service dshNoticeWebhook | FR-8, FR-10, FR-6 | Host Service + `src/service.js` | implement | backend | t2 | M | `node --test test/service.test.js` 全绿；断言 `version === 1`、`bind('', 'https://x')` 返回 `false`、`bind('s1','ftp://x')` 返回 `false`、`unbind('不存在')` 返回 `false`、`resolve('未绑定且无默认地址')` 返回 `null` | （默认模板） |
| t4 | （落库后回填） | 实现 webhook 投递层 | FR-4 | 出站契约 + `src/deliver.js` | implement | backend | t1 | M | `node --test test/deliver.test.js` 全绿；用例含：本地接收端返回 200 → 判定成功且请求体含 `version/event/message`；指向 `http://127.0.0.1:1/` → 判定失败且**不抛异常**；接收端返回 302 → 判定失败（不跟随重定向）；日志文本不含 URL 的 query 串 | dev, review（skipIntegration） |
| t5 | （落库后回填） | 实现事件分类与过滤 | FR-1, FR-2, FR-3, FR-5 | 配置项契约 + `src/classify.js` | implement | backend | t1 | M | `node --test test/classify.test.js` 全绿；覆盖 TC-1…TC-5：有标题时正文等于 `修复登录 bug · 会话已完成`、无标题时为 `会话已完成`、`tool/call(name=read)` 返回 `null`、`parentSession` 存在的会话返回 `null`、`reason.kind=interrupted` 返回 `null` | dev, review（skipIntegration） |
| t6a | （落库后回填） | 实现 goal 自动轮识别与静默 | FR-11 | 出站契约 + `src/goal.js` | implement | backend | t5 | M | `node --test test/goal.auto.test.js` 全绿；覆盖 TC-9：3 条 `source.kind='goal'` 的 user message 各接一个 `turn/end` → 产生 0 条意图；再插 1 条人工 user message + `turn/end` → 产生 1 条意图 | dev, review（skipIntegration） |
| t6b | （落库后回填） | 实现 goal 终态识别与去重 | FR-11 | 出站契约（`goal/complete`、`goal/blocked`）+ `src/goal.js` | implement | backend | t6a | M | `node --test test/goal.terminal.test.js` 全绿；覆盖 TC-10/TC-11：`phase=complete` 产出 `goal/complete`；`blocked` + `code=round-limit` + `maxGoalRounds=20` 的正文包含 `20/20`；同一 `(goalId, revision, phase)` 重复上报不产出第二条 | dev, review（skipIntegration） |
| t7 | （落库后回填） | 实现路由层与总开关旁路 | FR-6, FR-7 | 配置项契约（`enabled`）+ `src/router.js` | implement | backend | t2, t3, t5 | M | `node --test test/router.test.js` 全绿；覆盖 TC-6…TC-8：会话 X 绑定地址 B 后事件只到 B；`enabled:false` 时已绑定会话仍发、未绑定会话不发；`notifyApproval:false` 时已绑定会话也不发 | dev, review（skipIntegration） |
| t8 | （落库后回填） | 接线整合与本地端到端联调 | FR-1…FR-11 | `index.js` + `test/e2e.local.test.js` | implement | fullstack | t4, t6b, t7 | M | `node --test test/e2e.local.test.js` 全绿；本地接收端按序收到 5 类 `event`（`turn/end`、`approval/asked`、`ask_user_question`、`goal/complete`、`goal/blocked`）各至少 1 条，且 `goal/blocked` 正文包含「轮次耗尽」；把地址改为 `http://127.0.0.1:1/` 再跑，测试进程退出码为 `0`（无未捕获异常） | （默认模板） |
| t9 | （落库后回填） | 装载到 profile 并做真实 Host 验收 | FR-1, FR-4, FR-7 | `package.json` + profile 加载补丁 | test | backend | t8 | M | 用 plugin_manager `list_plugins` 能查到 `dsh-notice-webhook` 行且为启用态；在真实会话里跑完一轮对话后，本地接收端收到 `event=turn/end` 且 `message` 包含「会话已完成」；把该会话 `bind()` 到接收端 B 并设 `enabled:false` 后再跑一轮，只有 B 收到 | （默认模板） |
| t10 | （落库后回填） | 处理迁移与兼容（旧数据 / 共存 / 回滚） | FR-9, FR-4 | 数据契约（BindingsFile）+ `src/bindings.js` | implement | backend | t2 | S | `node --test test/compat.test.js` 全绿；用例含：删除绑定文件后启动 `list()` 返回空数组且**不创建**文件；文件写入 `{"version":99}` 后启动返回空表且原文件未被覆盖；卸载插件后除 `bindings.json` 外无残留文件（`grep` 工作区无插件引用） | dev, review（skipIntegration） |
| t11 | （落库后回填） | 写插件使用说明 README | FR-4, FR-6, FR-8 | 出站契约 / Host Service / 配置项契约 + `README.md` | doc | doc | t9 | S | `grep -c 'webhookUrl' README.md` ≥ 1 且 `grep -c 'curl' README.md` ≥ 1；README 含配置项表、Host Service 消费示例、本地接收端验证命令三段 | dev, review（skipIntegration） |

> 计划 key 共 **12** 张：t1–t5、**t6a**、**t6b**、t7–t11。
> 其中 goal 这条原本是 L 卡，按「L 不许直接落卡」拆成 t6a（自动轮静默）与 t6b（终态推送）两张，t6a → t6b 顺序依赖。

## 覆盖对照

| 需求条款 | 接口（interfaces.md 条目） | 页面/模块（模块文件） | 测试用例（test-cases.md） | 接收任务 | 完整性 |
|---|---|---|---|---|---|
| FR-1 | 出站契约（`event=turn/end`） | `src/classify.js` | TC-1（1） | t1, t5 | ✅ |
| FR-2 | 出站契约（`event=approval/asked`） | `src/classify.js` | TC-2（1） | t5 | ✅ |
| FR-3 | 出站契约（`event=ask_user_question`） | `src/classify.js` | TC-3, TC-4（2） | t5 | ✅ |
| FR-4 | 出站契约 + 响应与错误语义 | `src/deliver.js`, `src/config.js` | TC-12（1） | t1, t4, t9 | ✅ |
| FR-5 | 配置项契约（`onlyTopLevel`/`skipReasons`/`cooldownMs`） | `src/classify.js` | TC-4, TC-5（2） | t5 | ✅ |
| FR-6 | Host Service（`bind` / `resolve`） | `src/router.js`, `src/bindings.js` | TC-6（1） | t2, t3, t7 | ✅ |
| FR-7 | 配置项契约（`enabled`） | `src/router.js` | TC-7, TC-8（2） | t7, t9 | ✅ |
| FR-8 | Host Service（服务定义） | `src/service.js` | TC-14（1） | t3 | ✅ |
| FR-9 | 数据契约（BindingsFile） | `src/bindings.js` | TC-13（1） | t2, t10 | ✅ |
| FR-10 | Host Service（`list` / `resolve`） | `src/service.js`, `src/bindings.js` | TC-13, TC-14（2） | t3 | ✅ |
| FR-11 | 出站契约（`goal/complete`、`goal/blocked`） | `src/goal.js` | TC-9, TC-10, TC-11（3） | t6a, t6b | ✅ |
| **合计** | 6 类接口条目 | 8 个模块文件 | 14 个用例 | 12 张卡 | **11/11 条款有主** |

> **为什么「接收任务」列不写数量括号**：覆盖门禁的 `planKeysIn` 按 `[，,、\s|]` 切分单元格后只剥离首尾括号——`t5（1）` 会被切成 `t5（1` 从而认不出键（曾因此被门禁拦下 FR-2/3/5/8/10）。数量信息见「接口 / 模块 / 用例」三列与合计行。

**反向核对**（设计里的东西有没有人认领）：

- design/interfaces.md 的三个契约块（出站 / Host Service / 配置项）全部被覆盖对照引用，无超范围设计；
- design/data-model.md 的 BindingEntry / BindingsFile 由 t2、t10 认领；
- design/test-cases.md 的 TC-1…TC-14 全部在覆盖对照里出现，无孤儿用例；
- design/use-cases.md 的 UC-1…UC-3 是场景说明，不落卡（场景通过 TC 与真实 Host 验收体现）。

## 批次与依赖

```
批次 1（可并行）： t1 骨架/配置 ──┬─▶ t2 绑定表 ──┬─▶ t3 Host Service ──┐
                                  ├─▶ t4 投递层                    │
                                  └─▶ t5 分类/过滤 ──▶ t6a ──▶ t6b  │
                                                                   ▼
批次 2：                              t7 路由层（依赖 t2,t3,t5） ──▶ t8 接线+端到端
                                                                   │
批次 3：                    t10 迁移兼容（依赖 t2）                 ▼
                                                        t9 装载到 profile 验收
                                                                   │
批次 4：                                              t11 README 使用说明
```

**依赖顺序自检**：本表按数组顺序落库，所有 `depends_on` 均指向**前面已定义**的 key（无前向引用、无自依赖、无悬空引用）。

## 覆盖完整性规则（自检）

1. **每行三格非空**：11 行 FR 的接口格、模块格、用例格全部有值，无空行；
2. **反向无孤儿**：设计三份文档的契约/数据结构/用例均被认领（见上「反向核对」）；
3. **每个 FR 有主**：11/11 条款都有接收任务，无孤儿条款。

## 风险与回滚

| 风险 | 应对 |
|---|---|
| 真实 Host 验收发现事件名与源码假设不符（如 `goal/change` 载荷形状） | t9 是真实验收卡：不符则回 design 改契约、重新提交计划，不在实施阶段私改设计 |
| 装载后影响既有插件（与 dsh-notice 共存） | t10 覆盖共存验证；卸载即回滚（只留 `bindings.json`） |
| goal 自动轮判定误伤人工轮 | t6a 的 TC-9 明确断言人工轮仍推送；发版后若误伤，先查 `source.kind` 载荷 |
