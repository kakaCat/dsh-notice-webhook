# 拆分计划（REQ-260930155231-0862）

> 目标 + 做法一句话：**在既有 `dsh-notice-webhook` 插件上叠加三层——渠道适配（6 个 app 各自的报文与业务错误码）、目标清单（自有文件 + RPC + 可嵌入选择器）、多目标路由（扇出 + 逐目标过滤 + 绑定替代默认组）；静态配置声明 Config schema（schemastery），目标清单走自有文件与自写设置页（rail + 详情卡 + 会话绑定页）。**
> 本计划须**人批准**后才能落任务卡（`reqboard_decompose`）。

## 编号口径

| 编号 | 出自 | 指什么 |
|---|---|---|
| FR-x | [requirement.md](../requirement.md) 功能点表 | 需求条款（FR-1 … FR-10） |
| TC-x | [design/test-cases.md](../design/test-cases.md) 用例表 | 测试用例（TC-1 … TC-21） |
| UC-x | [design/use-cases.md](../design/use-cases.md) 场景总览 | 用户场景（UC-1 … UC-5） |
| t-x | 本文档任务表 | 任务（计划 key：`t1`、`t2a`、`t2b`、`t3` … `t17`） |

**本需求的编号约定**（避免"悬空引用"误判）：design/interfaces.md **未启用** `I-x` 编号，接口在覆盖对照里按**条目名**引用（渠道适配器契约 / 渠道报文契约 / Host RPC / Host Service / 客户端服务 / 插件 Config）；「页面/模块」列写**模块文件路径**。

## 改动盘点

**新增**：

| 文件 | 职责 |
|---|---|
| `src/channels/index.js` | 渠道注册表：`channel → adapter`；未知渠道返回错误不抛异常 |
| `src/channels/{wecom,feishu,dingtalk,slack,discord,custom}.js` | 单渠道纯函数：`buildRequest` + `isSuccess`（含加签与业务码判定） |
| `src/targets.js` | 目标清单存储与 CRUD（原子写、坏文件不覆盖、字段校验） |
| `src/outcomes.js` | 每目标最近 5 次投递结果（内存） |
| `src/rpc.js` | 设置页用的 Host RPC（含 revision 栅栏） |
| `client.js` | 客户端半：设置页（目标页 + 会话绑定页）、可嵌入选择器、客户端服务 |
| `test/*.test.js`（9 份） | 各模块单测与端到端 |

**修改**：

| 文件 | 改什么 |
|---|---|
| `package.json` | 加依赖 `@deepseek-ai/schemastery@3.18.4`；加 `exports["./client"]` 与 `dsh.client` 段 |
| `src/config.js` | 增加 schemastery `Config` 导出（含 `.volatile()` 标记），保留 `normalizeConfig` 作为兜底 |
| `src/bindings.js` | 新增 `targetBindings` 段（双读单写）；解绑时同时清旧 url 绑定 |
| `src/router.js` | 从"单地址解析"升级为"目标集合解析 + 逐目标过滤 + 去重 + 绑定替代默认组" |
| `src/service.js` | 升到 v2：新增 `bindTargets/unbindTargets/listBindings/listTargets/resolveAll`，**旧方法一个不删** |
| `index.js` | 接线：targets + rpc + 渠道 + 多目标路由 + legacy 映射 |
| `README.md` | 补多渠道、设置页、选择器与服务契约 |

**删除**：无（既有行为全部保留）。

## 任务表

| 计划 key | 任务 id | 标题 | 覆盖条款 | 落点 | 阶段 | 端侧 | 依赖 | 工作量 | 验收标准 | 子卡段 |
|---|---|---|---|---|---|---|---|---|---|---|
| t1 | （落库后回填） | 声明插件 Config schema 与双半包清单 | FR-8, FR-9 | 插件 Config + `package.json` / `src/config.js` | implement | backend | — | S | `node --test test/config.test.js` 全绿：Config 解析出全部默认值、`.volatile()` 字段集合与设计一致、越界值回落默认 | dev,review（skipIntegration） |
| t2a | （落库后回填） | 实现渠道注册表与三国内渠道 | FR-1 | 渠道适配器契约 + `src/channels/{index,wecom,feishu,dingtalk}.js` | implement | backend | — | M | `node --test test/channels.cn.test.js` 全绿：企微/飞书/钉钉报文形状与加签正确，`errcode!=0`/`code!=0` 判失败 | dev,review（skipIntegration） |
| t2b | （落库后回填） | 实现 Slack / Discord / 通用三渠道 | FR-1, FR-9 | `src/channels/{slack,discord,custom}.js` | implement | backend | t2a | M | `node --test test/channels.global.test.js` 全绿：Slack `{text}`、Discord `{content}`、通用渠道保持 v1 契约且自定义头原样带上 | dev,review（skipIntegration） |
| t3 | （落库后回填） | 实现目标清单存储与 CRUD | FR-2, FR-7, FR-9 | 数据契约 + `src/targets.js` | implement | backend | — | M | `node --test test/targets.test.js` 全绿：CRUD、非法字段拒写且不落盘、非法 JSON/未知 version 时不覆盖原文件 | dev,review（skipIntegration） |
| t4 | （落库后回填） | 实现投递结果存储（内存） | FR-10 | `src/outcomes.js` | implement | backend | — | S | `node --test test/outcomes.test.js` 全绿：每目标保留最近 5 条、超限淘汰最旧、`reason` 不含密钥明文 | dev,review（skipIntegration） |
| t5 | （落库后回填） | 升级绑定存储：targetBindings 段 | FR-5, FR-9 | 数据契约 + `src/bindings.js` | implement | backend | t3 | M | `node --test test/bindings.v2.test.js` 全绿：读写 `targetBindings`、旧 `bindings` 段仍被维护、旧版本读新文件不报错（回滚安全） | dev,review（skipIntegration） |
| t6 | （落库后回填） | 升级 Host Service 到 v2 | FR-5, FR-8, FR-9 | Host Service + `src/service.js` | implement | backend | t3, t5 | M | `node --test test/service.v2.test.js` 全绿：`version===2`、`unbindTargets` 等价于 `bindTargets(sid,[])`、`listBindings` 展开目标、旧四方法行为不变 | （默认模板） |
| t7a | （落库后回填） | 实现 RPC 只读端点与状态投影 | FR-2, FR-10 | Host RPC + `src/rpc.js` | implement | backend | t3, t5, t6 | M | `node --test test/rpc.read.test.js` 全绿：`GET /state` 返回 targets/bindings/defaults/outcomes/secrets，且密钥只回"是否已配置" | （默认模板） |
| t7b | （落库后回填） | 实现 RPC 写入端点与 revision 栅栏 | FR-2, FR-8 | Host RPC + `src/rpc.js` | implement | backend | t7a | M | `node --test test/rpc.write.test.js` 全绿：过期 revision 返回 409 且清单不变；合法写入返回新 revision；校验失败 400 不落盘 | （默认模板） |
| t8a | （落库后回填） | 实现目标集合解析与替代默认组 | FR-5, FR-6 | `src/router.js` | implement | backend | t2b, t3, t5 | M | `node --test test/router.resolve.test.js` 全绿：绑定非空→只发绑定目标；绑定为空/不存在→默认组；总开关只作用于默认组 | dev,review（skipIntegration） |
| t8b | （落库后回填） | 实现逐目标过滤与去重 | FR-3, FR-4 | `src/router.js` | implement | backend | t8a | M | `node --test test/router.filter.test.js` 全绿：`events` 白名单生效、空数组=全收、同 channel+url 去重只发一次 | dev,review（skipIntegration） |
| t9 | （落库后回填） | 接线主链路与 legacy 等价映射 | FR-9 | `index.js` | implement | fullstack | t4, t7b, t8b | M | `node --test test/e2e.multi.test.js` 全绿：五类事件按目标集合投递；只配 `webhookUrl` + 老 `bindings.json` 时报文仍为 v1 契约 | （默认模板） |
| t10 | （落库后回填） | 客户端半：设置页骨架与目标页 | FR-2 | 设置页 + `client.js` | implement | frontend | t7b | M | 打开 设置 → Webhook 通知 页面：出现左渠道 rail（含图标与数量徽标）与右详情卡；控制台无报错；`grep -c 'settings.section' client.js` ≥ 1 | （默认模板） |
| t11 | （落库后回填） | 客户端半：目标编辑与动作 | FR-2, FR-7, FR-8 | `client.js` | implement | frontend | t10 | M | 打开 设置 → Webhook 通知 → 新增目标 表单：填 `ftp://x` 保存被拒绝并显示行内错误，`targets.json` 未被修改（`grep -c '"version": 1'` 不变）；合法保存后 rail 徽标 +1 且无需刷新 | （默认模板） |
| t12 | （落库后回填） | 客户端半：事件过滤网格与全局开关 | FR-4, FR-8 | `client.js` | implement | frontend | t10 | S | 打开 设置 → Webhook 通知 → 详情卡「关心事件」：勾选后保存 → `GET /state` 返回该目标 `events` 与勾选一致；全局开关改动后立即生效且不重启 | dev,review（skipIntegration） |
| t13 | （落库后回填） | 客户端半：会话绑定页与解绑 | FR-5 | `client.js` | implement | frontend | t7b, t10 | M | 打开 设置 → Webhook 通知 → 会话绑定 标签：列表按会话显示绑定目标与「解绑」；解绑后该会话回落默认组（`node --test test/e2e.multi.test.js` 对应断言通过） | （默认模板） |
| t14 | （落库后回填） | 可嵌入选择器与客户端服务 | FR-5, FR-8 | 客户端服务 + `client.js` | implement | frontend | t10 | M | `node --test test/client-service.test.js` 全绿：`version===1`、`renderTargetPicker` 返回非空 element、服务缺失时返回 null；宿主示例（测试内 mock 宿主）能拿到勾选结果 | （默认模板） |
| t15 | （落库后回填） | 兼容与回滚收尾 | FR-9 | `src/bindings.js` / `src/targets.js` | implement | backend | t9 | M | `node --test test/compat.v2.test.js` 全绿：老配置等价映射、坏文件不覆盖、卸载后除 `targets.json`/`bindings.json` 外无残留 | dev,review（skipIntegration） |
| t16 | （落库后回填） | 装载到 profile 并做真实 Host 验收 | FR-1, FR-2, FR-5, FR-8 | `package.json` + profile 清单 | test | fullstack | t11, t12, t13, t14, t15 | M | `plugin_manager list_plugins` 含 `include:dsh-notice-webhook` 且 enabled=true/fiberPhase=active；打开 设置 → Webhook 通知 页面可见；真实会话投递按目标集合落到本地接收端（需重启 Host 时如实记录） | （默认模板） |
| t17 | （落库后回填） | 更新 README（多渠道 / 配置页 / 服务契约） | FR-1, FR-2, FR-5 | `README.md` | doc | doc | t16 | S | `grep -c 'schemastery' README.md` ≥ 1 且 `grep -c 'renderTargetPicker' README.md` ≥ 1；含渠道表、配置页说明、选择器用法三段 | dev,review（skipIntegration） |

> 计划 key 共 **20** 张卡：`t1`、`t2a`、`t2b`、`t3`、`t4`、`t5`、`t6`、`t7a`、`t7b`、`t8a`、`t8b`、`t9`…`t17`。
> 其中 `t2a/t2b`、`t7a/t7b`、`t8a/t8b` 是**L 卡的拆解**（L 不许直接落卡）：渠道层、RPC 层、路由层各自拆成"基础能力 + 上层能力"两张。

## 覆盖对照

| 需求条款 | 接口（interfaces.md 条目） | 页面/模块（模块文件） | 测试用例 | 接收任务 | 完整性 |
|---|---|---|---|---|---|
| FR-1 | 渠道适配器契约 + 渠道报文契约 | `src/channels/*.js` | TC-1, TC-2, TC-3, TC-4, TC-5, TC-6, TC-7 | t2a, t2b | ✅ |
| FR-2 | Host RPC | `src/targets.js`, `src/rpc.js`, `client.js` | TC-14, TC-16, TC-17, TC-18, TC-21 | t3, t7a, t7b, t10, t11 | ✅ |
| FR-3 | 渠道报文契约 | `src/router.js` | TC-8, TC-12 | t8b | ✅ |
| FR-4 | 插件 Config + Host RPC | `src/router.js`, `client.js` | TC-9 | t8b, t12 | ✅ |
| FR-5 | Host Service + 客户端服务 | `src/bindings.js`, `src/service.js`, `client.js` | TC-10, TC-19, TC-20, TC-21 | t5, t6, t8a, t13, t14 | ✅ |
| FR-6 | 插件 Config | `src/router.js` | TC-11, TC-19 | t8a | ✅ |
| FR-7 | 数据契约 | `src/targets.js`, `src/rpc.js`, `client.js` | TC-2, TC-3, TC-13 | t3, t7a, t11 | ✅ |
| FR-8 | 插件 Config + Host RPC | `src/config.js`, `src/rpc.js`, `client.js` | TC-14, TC-17 | t1, t7b, t11, t12 | ✅ |
| FR-9 | 渠道报文契约 + 数据契约 | `src/bindings.js`, `index.js` | TC-5, TC-15, TC-16 | t5, t9, t15 | ✅ |
| FR-10 | Host RPC | `src/outcomes.js`, `src/rpc.js` | TC-7, TC-13, TC-21 | t4, t7a | ✅ |
| **合计** | 6 类接口条目 | 12 个模块文件 | 21 个用例 | 20 张卡 | **10/10 条款有主** |

**反向核对**：

- design/interfaces.md 的六个契约块（渠道适配器 / 渠道报文 / Host RPC / Host Service / 客户端服务 / 插件 Config）全部被覆盖对照引用，无超范围设计；
- design/data-model.md 的 TargetRecord / targets.json / targetBindings / Outcome 由 t3、t5、t4 认领；
- design/frontend.md 的组件（ChannelRail / TargetCard / EventFilterGrid / BindingTable / TargetPicker）由 t10…t14 认领；
- design/test-cases.md 的 TC-1…TC-21 全部出现，无孤儿用例；
- design/use-cases.md 的 UC-1…UC-5 是场景说明，通过 TC 与真实 Host 验收体现，不单独落卡。

## 批次与依赖

```
批次 1（契约与数据，可并行）：
   t1 Config/包清单
   t2a 三国内渠道 ──▶ t2b 三海外/通用渠道
   t3 目标清单存储 ──┬──▶ t5 绑定存储 v2 ──┬──▶ t6 Host Service v2 ──▶ t7a ──▶ t7b
                     │                      └──▶ t8a ──▶ t8b
   t4 结果存储 ───────┘

批次 2（接线与客户端）：
   t4 + t7b + t8b ──▶ t9 接线/legacy 映射 ──▶ t15 兼容收尾
   t7b ──▶ t10 设置页骨架 ──┬──▶ t11 编辑与动作
                            ├──▶ t12 事件网格/全局开关
                            └──▶ t14 选择器与客户端服务
   t7b + t10 ──▶ t13 会话绑定页

批次 3（验收与文档）：
   t11, t12, t13, t14, t15 ──▶ t16 装载与真实 Host 验收 ──▶ t17 README
```

**依赖顺序自检**：本表按数组顺序落库，所有 `depends_on` 均指向**前面已定义**的 key（无前向引用、无自依赖、无悬空）。

## 覆盖完整性规则（自检）

1. **每行三格非空**：10 行 FR 的接口格、模块格、用例格全部有值；
2. **反向无孤儿**：设计六份文档的契约、数据结构、组件、用例均被认领；
3. **每个 FR 有主**：10/10 条款都有接收任务，无孤儿条款。

## 风险与回滚

| 风险 | 应对 |
|---|---|
| 工作区插件解析不到 `@deepseek-ai/schemastery` | 已核实该包**已公开发布**（3.18.4，`access: public`），与 dsh 内 vendored 版本同号；t1 首步即验证可解析，不可解析则**退回设计**改"手工校验"（不静默降级） |
| 客户端半在 Desktop 与 Web 行为不一致 | t16 在真实 Host 验收；`dsh.client.inject` 先最小化，缺服务时降级不报错 |
| 渠道加签口径与平台文档不符 | t2a/t2b 单测独立覆盖签名串；真实投递失败时把平台 errmsg 带进结果（t4/t7a 可见） |
| 绑定语义（替代 vs 叠加）被理解错 | t8a 的验收直接断言"绑定非空时不发默认组"（TC-19） |
| 回滚丢绑定 | t5 的验收断言"旧版本读新文件不报错"，t15 覆盖卸载无残留 |
