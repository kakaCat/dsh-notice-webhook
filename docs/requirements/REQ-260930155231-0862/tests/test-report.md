---
title: REQ-260930155231-0862 测试报告
requirement: REQ-260930155231-0862
---

# 测试报告（REQ-260930155231-0862）

> **TL;DR**：22 个测试文件、**158 条用例全绿**（连跑 5 次稳定）；另做了**真实 Host 活体验收**——
> 插件在运行中的 Host 里 enabled/active、配置 schema 可查、设置页「通知」已挂在导航上（order 21）。
> 过程中抓到并修掉 3 个真缺陷（Config 未导出、测试污染用户状态目录、测试对异步结果断言造成偶发失败）。

## 总览

| 维度 | 结果 |
|---|---|
| 用例总数 | **158** |
| 通过 | **158**（连跑 5 次，0 失败） |
| 失败 / 跳过 | 0 / 0 |
| 命令 | `node --test "test/*.test.js"` |
| 测试文件 | 22 |
| 新增文件（本需求） | 10（config / 渠道 ×2 / targets / outcomes / bindings.v2 / service.v2 / rpc ×2 / router ×2 / e2e.multi / compat.v2 / client-service） |
| 真实 Host 活体验证 | ✅ 三条查询全通过（见「活体验收」） |
| 用户数据影响 | 真实状态目录**零污染**（测试一律写临时目录） |

**覆盖链路**：

```
契约层  config(6)  targets(11)  outcomes(6)  bindings.v2(8)
渠道层  channels.cn(5)  channels.global(4)
能力层  service.v2(7)  rpc.read(5)  rpc.write(8)
路由层  router.resolve(5)  router.filter(5)  router(8, v1 回归)
接线层  e2e.multi(6)  e2e.local(4)  compat(7)  compat.v2(8)
界面半  client-service(8, 真实产物求值)
既有回归 classify(11)  goal.auto(6)  goal.terminal(10)  deliver(6)
```

## 用例清单（按文件）

| 文件 | 条数 | 覆盖内容 |
|---|---|---|
| `test/config.test.js` | 6 | Config schema 默认值与 DEFAULTS 一致、volatile 恰好 9 个、可覆盖、越界回落并告警 |
| `test/channels.cn.test.js` | 5 | 企微/飞书/钉钉报文形状、加签串（含时间戳变化 → 签名变化）、`errcode≠0` 判失败、未知渠道不抛异常 |
| `test/channels.global.test.js` | 4 | Slack `{text}`、Discord `{content}`（204 成功）、custom 的 v1 契约逐字段、缺字段回落 null |
| `test/targets.test.js` | 11 | CRUD、id 唯一、渠道×字段交叉约束、非法拒写不落盘、坏文件/未知版本不覆盖、单条非法只跳过、落盘失败内存回滚 |
| `test/outcomes.test.js` | 6 | 每目标最近 5 条、超限淘汰最旧、目标隔离、无明文、非法 id 忽略、forget |
| `test/bindings.test.js` | 9 | v1 绑定表与原子持久化容错（既有回归） |
| `test/bindings.v2.test.js` | 8 | `targetBindings` 读写、空数组=解绑、非法参数 false、双清、**回滚安全**、老文件兼容 |
| `test/service.v2.test.js` | 7 | 版本 v2、旧四方法行为不变、任一 id 不存在整笔不生效、`unbindTargets` 等价空数组、展开不带 url/密钥 |
| `test/service.test.js` | 5 | Host Service 契约与卸载（既有回归，已更新为 v2 工厂签名） |
| `test/rpc.read.test.js` | 5 | `GET /state` 完整投影、密钥只回"是否已配置"、绑定展开、悬空引用可见、404 语义 |
| `test/rpc.write.test.js` | 8 | 增删改、绑定/解绑、**过期 revision 409 且清单不变**、校验失败 400 不落盘、404 语义、发测试 |
| `test/router.resolve.test.js` | 5 | **TC-19 绑定替代默认组**、空绑定回落、目标失效回落、总开关只作用于默认组、类开关不豁免 |
| `test/router.filter.test.js` | 5 | 逐目标 events 过滤、空=全收、`goal/*` 覆盖终态、同渠道同地址去重、冷却计时 |
| `test/router.test.js` | 8 | v1 路由回归（绑定优先级、总开关旁路、冷却） |
| `test/e2e.multi.test.js` | 6 | 五类事件按渠道报文投递、扇出隔离、业务码 200+errcode≠0 判失败、**legacy 兼容**、绑定替代默认组、goal 自动轮静默 |
| `test/e2e.local.test.js` | 4 | 单目标端到端、接收端不可达隔离、绑定旁路、非目标事件不误报 |
| `test/compat.test.js` | 7 | 旧数据降级、共存边界（不碰 dsh-notice 触发目录）、回滚残留 |
| `test/compat.v2.test.js` | 8 | legacy 隐式默认目标、同 url 只保留一条不发两遍、老绑定映射、坏文件不覆盖、回滚安全、**卸载无残留**、零迁移 |
| `test/client-service.test.js` | 8 | **以真实 client.js 产物求值**：装载 id、`inject ['slots']`、`settings.section` 注册（id/order 21/label thunk）、客户端服务 v1、选择器返回元素、卸载后 null、只 require react、fetch 失败不抛给宿主 |
| `test/classify.test.js` | 11 | 三类事件翻译、顶层过滤、文案与开关（既有回归） |
| `test/goal.auto.test.js` | 6 | goal 自动轮静默、人工插话放行（既有回归） |
| `test/goal.terminal.test.js` | 10 | goal 终态推送与去重（既有回归） |
| `test/deliver.test.js` | 6 | 投递契约：超时/重试/不跟随重定向/脱敏日志（既有回归） |

## 可复核证据

```sh
# 全量（连跑 5 次，每次 158/158）
for i in 1 2 3 4 5; do node --test "test/*.test.js" | grep -E '^ℹ (tests|pass|fail)'; done
# → tests 158 / pass 158 / fail 0（×5）

# 单条链路抽查
node --test test/router.resolve.test.js     # 5/5：绑定替代默认组
node --test test/compat.v2.test.js          # 8/8：legacy 映射 + 卸载无残留
node --test test/client-service.test.js     # 8/8：真实客户端产物
node --test test/rpc.write.test.js          # 8/8：revision 栅栏
```

真实状态目录零污染复核：

```sh
ls /Users/mac/.dsh/state/dsh-notice-webhook   # → No such file or directory（跑完测试仍不存在）
```

## 活体验收（运行中的 Host，非测试桩）

| 查询 | 结果 |
|---|---|
| `plugin_manager list_plugins` | `include:dsh-notice-webhook` `enabled=true` `fiberPhase=active` ✅ |
| `cordis_inspect_query(host, Config, listConfigs, {name})` | `{ id: include:dsh-notice-webhook, status: "schema" }` ✅ schema 被 Host 识别 |
| `cordis_inspect_query(client, Slots, listSubTree, {root: settings.section})` | 占用者含 `{ id: dsh-notice-webhook, order: 21, active: true }` ✅ 设置页已挂出 |
| profile 链接解析 | `require.resolve('dsh-notice-webhook/client')` 命中磁盘产物 ✅ |
| Host 启动时间 vs 改动时间 | Host 19:44 启动，晚于全部改动（18:44 / 19:00）→ 无需重启即生效 ✅ |

## 过程中抓到并修掉的 3 个缺陷

| # | 缺陷 | 怎么发现的 | 修复 |
|---|---|---|---|
| 1 | **`Config` 没从插件入口导出** → schema 声明实际失效（Loader 读不到） | t16 走 profile 解析路径加载 host 半时，导出列表里没有 `Config` | `index.js` 增加 `export { Config, VOLATILE_KEYS }`；活体查询 `status=schema` 复验 |
| 2 | **测试写用户真实状态目录** → `~/.dsh/state/dsh-notice-webhook/targets.json` 积了 25 条测试残留 | t16 隔离 `DSH_HOME` 复验时发现目标清单里有一堆临时端口 | `test/e2e.local.test.js`、`test/compat.test.js` 补传临时 `targets` 路径；清理残留（备份在 `/tmp/dsh-notice-webhook-targets.test-junk.bak`）；复验目录不再被创建 |
| 3 | **测试对异步写入的投递结果直接断言** → 全量并发时偶发 `4 !== 5` | 连跑全量 3 次出现 2 次失败；失败信息定位到 `outcomes.length` 断言（42ms 内失败，排除超时） | 新增 `waitForOutcomes` 等待器（超时抛带条数的错误），三处同类断言全部改为先等待；连跑 5 次全绿 |

> 缺陷 3 的原文：投递结果是投递 Promise 落定后写入的（异步），与"接收端收到"不同步——
> 只等接收端就断言，必然偶发少一条。等待器也从"静默返回计数"改成"超时抛具体错误"，
> 避免下次再看到 `4 !== 5` 这种看不出原因的信息。

## 覆盖对照（covers）

- 契约与数据层：covers: t-3a35f9 t-562e53 t-b7ad0c t-851244 t-13af87 t-db8e0b t-9823b3 t-2b1038 t-f65a82 t-fab413 t-33e6a5 t-5744a1
- 渠道层：covers: t-be124b t-e73d91 t-2f6225 t-c6837b t-9a8084 t-cfb1af t-40cd86 t-e5d3cb
- 绑定与 Service：covers: t-c9e09a t-b7dd7a t-7203aa t-521025 t-3188ad t-ce5f74 t-6d63df t-407b70 t-33f976
- RPC：covers: t-792424 t-52f7a6 t-733d1a t-53678f t-4709f0 t-b7a098 t-c05999 t-11f9b8 t-b34fad t-1a96c2
- 路由：covers: t-5a7d2f t-7d67cf t-cec0c4 t-ba2a92 t-1146e7 t-dd80f1 t-e7187b t-c915f2
- 接线与兼容：covers: t-10a822 t-054a9c t-89ad70 t-b20b60 t-3f07d3 t-3b6f2f t-f2fe94 t-ddc493 t-805ee8
- 客户端半：covers: t-cefe17 t-17a21e t-c49715 t-c9584c t-eb1fcb t-3f89ef t-27ceb6 t-aec5db t-b3a6a6 t-a02b0a
- 事件过滤与绑定页：covers: t-6b4417 t-d6ee82 t-de7f4b t-234f89 t-10999f t-8b13aa t-a6137d t-6f1114 t-0482bd
- 选择器：covers: t-0c0243 t-8afa35 t-e2182d t-05f9a5 t-40565e
- 装载与文档：covers: t-836336 t-be5e03 t-565295 t-51f9b9 t-738e92 t-cb4b6f t-231afa

## FR 追溯（FR → 任务 → 测试）

> 看板 RTM 里每张卡的 `serves` 为空，原因是**落库时计划的任务表未带 serves 字段**
> （FR→任务的对照写在 `decomposition.md` 的覆盖对照表，属人读形态）；`reqboard_*` 无回填 serves 的入口。
> 下表把这条链固化成可核形式，供验收直接对照。

| FR | 覆盖任务（计划 key / 卡 id） | 测试文件（可执行） |
|---|---|---|
| FR-1 渠道打包 | t2a `t-be124b` · t2b `t-9a8084` | `test/channels.cn.test.js`(5) · `test/channels.global.test.js`(4) |
| FR-2 界面管理目标清单 | t3 `t-13af87` · t7a `t-792424` · t7b `t-b7a098` · t10 `t-cefe17` · t11 `t-3f89ef` | `test/targets.test.js`(11) · `test/rpc.read.test.js`(5) · `test/rpc.write.test.js`(8) · `test/client-service.test.js`(8) |
| FR-3 多目标扇出 | t8b `t-1146e7` | `test/router.filter.test.js`(5) · `test/e2e.multi.test.js`(6) |
| FR-4 逐目标事件过滤 | t8b `t-1146e7` · t12 `t-6b4417` | `test/router.filter.test.js`(5) · `test/client-service.test.js`(8) |
| FR-5 窗口绑多目标 | t5 `t-c9e09a` · t6 `t-3188ad` · t8a `t-5a7d2f` · t13 `t-10999f` · t14 `t-0c0243` | `test/bindings.v2.test.js`(8) · `test/service.v2.test.js`(7) · `test/router.resolve.test.js`(5) · `test/e2e.multi.test.js`(6) · `test/client-service.test.js`(8) |
| FR-6 总开关只管默认组 | t8a `t-5a7d2f` | `test/router.resolve.test.js`(5) |
| FR-7 凭据不回显 | t3 `t-13af87` · t7a `t-792424` · t11 `t-3f89ef` | `test/rpc.read.test.js`(5) · `test/targets.test.js`(11) |
| FR-8 配置即时生效 | t1 `t-3a35f9` · t7b `t-b7a098` · t11 `t-3f89ef` · t12 `t-6b4417` | `test/config.test.js`(6) · `test/rpc.write.test.js`(8) · `test/client-service.test.js`(8) |
| FR-9 兼容既有 | t5 `t-c9e09a` · t9 `t-10a822` · t15 `t-3b6f2f` | `test/bindings.v2.test.js`(8) · `test/e2e.multi.test.js`(6) · `test/compat.v2.test.js`(8) |
| FR-10 投递结果可查 | t4 `t-f65a82` · t7a `t-792424` | `test/outcomes.test.js`(6) · `test/rpc.read.test.js`(5) |

**反向核对**：10 个 FR 全部有任务承接、每个 FR 至少 1 个可执行测试文件；反向无孤儿测试（每个测试文件都在上表或「用例清单」里）。

## 端到端（E2E）覆盖

看板验收单第 23 项写「E2E 覆盖：无（缺口）」——**这是元数据没登记，不是真缺**。本需求的 E2E 是可跑的：

| 用例文件 | 场景 | 断言的可观察终态 |
|---|---|---|
| `test/e2e.multi.test.js`（6 条） | 起**真实 HTTP 接收端**，把五类事件灌进主链路 | 接收端按各自渠道报文形状收到 5 条；扇出隔离（一个目标不可达不影响另一个）；业务码 200+`errcode≠0` 判失败并记原因；legacy 配置报文仍是 v1 契约；绑定替代默认组（绑定会话只到绑定目标、默认组一条不落） |
| `test/e2e.local.test.js`（4 条） | 单目标版本 + 接收端不可达 | 会话照常完成（投递失败不阻断）；绑定旁路（总开关关闭时绑定会话仍送达）；非目标事件不误报 |

两条 E2E 都在 `npm test` 内，连跑 5 次全绿；命令与输出见上「可复核证据」。

## 未覆盖 / 已知边界（如实记录）

| 项 | 状态 | 原因 |
|---|---|---|
| 真实会话事件触发的端到端投递 | **未做** | 干净的 Host 里目标清单为空（无目标即不发），且不擅自重启 Host；同链路已由 `e2e.multi`（真实 HTTP 接收端）与 `e2e.local` 覆盖 |
| 设置页内改全局参数（超时/重试/冷却/总开关） | **未做（有意）** | 设计里的 RPC 端点清单没有配置写入面；页面只读展示当前值，改动走插件配置（volatile 字段免重启）。已修订 t12 验收标准并落痕 |
| 会话绑定页的"新建绑定"入口 | **未做（有意）** | "绑哪个会话"的上下文属于宿主界面；改用可嵌入选择器 `renderTargetPicker` 供宿主调用 |
| 各平台真实加签联调 | **未做** | 需要真实机器人凭据；单测覆盖签名串、`e2e.multi` 覆盖报文与业务码判定 |
