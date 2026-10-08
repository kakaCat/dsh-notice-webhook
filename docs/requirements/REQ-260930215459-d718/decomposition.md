# 拆分计划（REQ-260930215459-d718）

> 目标 + 做法一句话：**新增一张渠道元数据表作单点真相（每个渠道填什么、拼成什么、去哪拿），
> 把 URL 组装从界面挪到 Host（`composeUrl`/`parseKey` 两个纯函数），目标改存 `key` 并把
> `targets.json` 升 v2（同时落派生 url 以保回滚），界面按 `prototype.html` 逐元素复刻并换上
> dsh-im 的品牌图标、加「只填 key」与「怎么拿 key」说明浮层。**
> 本计划须**人批准**后才能落任务卡（`reqboard_decompose`）。

## 编号口径

| 编号 | 出自 | 指什么 |
|---|---|---|
| FR-x | [requirement.md](../requirement.md) 功能点表 | 需求条款（FR-1 … FR-6） |
| TC-x | [design/test-cases.md](../design/test-cases.md) | 测试用例（TC-1 … TC-21） |
| UC-x | [design/use-cases.md](../design/use-cases.md) | 用户场景（UC-1 … UC-5） |
| t-x | 本文档任务表 | 任务（计划 key：`t1`…`t12`，含拆解卡 `t9a`/`t9b`） |

**编号约定**：设计文档未启用 `I-x`；接口按**条目名**引用（渠道元数据表 / `composeUrl` / `parseKey` / Host RPC / 客户端组件面 / 说明浮层）。

## 改动盘点

**新增**：

| 文件 | 职责 |
|---|---|
| `src/channels/meta.js` | 渠道元数据表（`input`/`keyLabel`/`urlPrefix`/`keyPattern`/`secret`/`help`）+ 校验工具 |
| `test/channels.meta.test.js` | 元数据完整性、`composeUrl`/`parseKey` 互逆、反解失败不抛 |
| `test/compat.v3.test.js` | v1→v2 反解迁移、反解失败直投、回滚模拟、坏文件口径 |

**修改**：

| 文件 | 改什么 |
|---|---|
| `src/channels/{wecom,dingtalk,feishu,slack,discord,custom}.js` | 各加 `composeUrl` / `parseKey`（纯函数）；**`buildRequest`/`isSuccess` 不动** |
| `src/targets.js` | `TargetRecord` 加 `key`；`targets.json` 升 v2；保存时一并落派生 `url`；校验按渠道 `keyPattern` |
| `index.js` | 投递前用 `composeUrl(target)` 组装地址；读 v1 文件时反解升级 |
| `src/rpc.js` | `/state` 追加 `channelMeta` 与目标 `key`；`POST /targets` 收 `key`（与 url 冲突时以 key 为准 + warn） |
| `client.js` | 图标表（5 个 dsh-im glyph + 通用）、rail 三段、card-head/content-head/动作区、key 字段、说明浮层、事件网格调序、谁在用 chips、最近投递分列、绑定页复用图标 |
| `README.md` | 配置口径改为「只填 key」；补迁移与回滚说明；图标来源署名 |
| `docs/architecture/notification-plugin.md` | 记录「组装点迁移」与「渠道元数据单点真相」两条决策 |
| 既有用例（受影响者） | 按新数据模型更新；**每处理由记入测试报告** |

**删除**：无。

## 任务表

| 计划 key | 任务 id | 标题 | 覆盖条款 | 落点 | 阶段 | 端侧 | 依赖 | 工作量 | 验收标准 | 子卡段 |
|---|---|---|---|---|---|---|---|---|---|---|
| t1 | （落库后回填） | 建渠道元数据表与校验 | FR-2, FR-3 | 渠道元数据表 + `src/channels/meta.js` | implement | backend | — | M | `node --test test/channels.meta.test.js` 全绿：六渠道齐全；`input:'key'` 的三项都有 `urlPrefix` 与 `keyPattern`；`help.steps` 非空 | dev,review（skipIntegration） |
| t2 | （落库后回填） | 渠道适配器加 composeUrl / parseKey | FR-2 | `src/channels/*.js` | implement | backend | t1 | M | `node --test test/channels.meta.test.js` 全绿：三渠道 `parseKey(composeUrl(x)) === x`；反解失败返回 `undefined` 且不抛；`node --check src/channels/*.js` 通过 | dev,review（skipIntegration） |
| t3a | （落库后回填） | TargetRecord 加 key 与派生 url | FR-2 | `src/targets.js` | implement | backend | t1, t2 | M | `node --test test/targets.test.js` 全绿：保存 `{channel:'wecom',key}` 后落盘含 `key` 且 `url` 等于派生值 | dev,review（skipIntegration） |
| t3b | （落库后回填） | targets.json v2 与校验收口 | FR-2, FR-6 | `src/targets.js` | implement | backend | t3a | M | `node --test test/targets.test.js` 全绿：`key` 形状不合法被拒且文件不变、revision 不动；写盘 `version===2` | dev,review（skipIntegration） |
| t4 | （落库后回填） | v1→v2 迁移与回滚（单列兼容卡） | FR-6 | `src/targets.js` + `index.js` | implement | backend | t3b | M | `node --test test/compat.v3.test.js` 全绿：前缀命中→反解升级；不命中→保留 url 直投 + warn；v2 被旧语义读仍可取到可投递 url | dev,review（skipIntegration） |
| t5 | （落库后回填） | RPC 追加 channelMeta / help / key | FR-2, FR-3 | Host RPC + `src/rpc.js` | implement | backend | t3b | M | `node --test test/rpc.read.test.js test/rpc.write.test.js` 全绿：`/state` 含 `channelMeta`（六项含 help）与目标 `key`；密钥仍只回布尔；同传 key+url 不一致时以 key 为准返回 200 | （默认模板） |
| t6 | （落库后回填） | 投递前用 composeUrl 组装（报文零变化） | FR-6 | `index.js` | implement | backend | t2, t3b | M | `node --test test/channels.cn.test.js test/channels.global.test.js test/e2e.multi.test.js` 全绿（**报文与加签断言逐条不变**） | dev,review（skipIntegration） |
| t7 | （落库后回填） | 图标表：dsh-im 品牌 glyph 内联 | FR-1 | `client.js` | implement | frontend | — | M | `node --test test/client-service.test.js` 全绿：5 个品牌 glyph + 通用 glyph；`grep -c '取自 dsh-im' client.js` ≥ 5；`grep -cE '<img\|https?://.*\.svg' client.js` 为 0 | dev,review（skipIntegration） |
| t8 | （落库后回填） | 左栏 rail 三段与徽标 | FR-4, FR-5 | `client.js` | implement | frontend | t5, t7 | M | `node --test test/client-service.test.js` 全绿：rail 含「全部目标/按渠道/默认组」三段；0 目标渠道仍在；`isDefault` 显示「默认」、被绑定显示「绑定」 | （默认模板） |
| t9a | （落库后回填） | 详情卡骨架：content-head / card-head / 动作区 | FR-4 | `client.js` | implement | frontend | t5, t7 | M | 打开 设置 → 通知：顶部见 `设置 › Webhook 通知` + 两个按钮；card-head 见 `id: <targetId>` 与「启用」；动作区删除在左、保存在右 | （默认模板） |
| t9b | （落库后回填） | 详情卡字段区：key 输入 / 加签 chip / 事件网格 / 谁在用 / 最近投递 | FR-2, FR-4 | `client.js` | implement | frontend | t1, t5, t9a | L→本卡为拆解后半 | 见验收标准 | （默认模板） |
| t10 | （落库后回填） | 「怎么拿 key」说明浮层 | FR-3 | `client.js` | implement | frontend | t1, t9b | M | `node --test test/client-service.test.js` 全绿：`help` 存在时可展开且含 `steps`/`docUrl`；缺失时不渲染入口；不调用 `window.open`；Esc 可关 | （默认模板） |
| t11 | （落库后回填） | 会话绑定页对齐原型 | FR-5 | `client.js` | implement | frontend | t7, t9b | S | 打开 设置 → 通知 → 会话绑定：表格列=会话/目标 chips/解绑；chips 用新品牌图标；悬空引用标红 | dev,review（skipIntegration） |
| t12 | （落库后回填） | 装载验收 + 文档更新 | FR-6 | `README.md` + `docs/architecture/notification-plugin.md` | test | fullstack | t4, t6, t8, t9b, t10, t11 | M | `plugin_manager list_plugins` 含 `include:dsh-notice-webhook` 且 active；`cordis_inspect_query(client, Slots, {root:settings.section})` 占用者 active；回滚模拟（AC-9）在 `test/compat.v3.test.js` 中通过；`grep -c '只填 key\|渠道元数据' README.md` ≥ 1 | （默认模板） |

> 计划 key 共 **14** 张卡：`t1`、`t2`、`t3a`、`t3b`、`t4`、`t5`、`t6`、`t7`、`t8`、`t9a`、`t9b`、`t10`、`t11`、`t12`（其中 `t3a/t3b` 与 `t9a/t9b` 是 L 卡的拆解，L 不许直接落卡）。

## 覆盖对照

| 需求条款 | 接口（设计条目） | 页面/模块 | 测试用例 | 接收任务 | 完整性 |
|---|---|---|---|---|---|
| FR-1 | 客户端组件面（`ChannelIcon`） | `client.js` | TC-1, TC-2, TC-3, TC-5 | t7, t8, t9a, t11 | ✅ |
| FR-2 | 渠道元数据表 + `composeUrl`/`parseKey` + Host RPC | `src/channels/meta.js`, `src/targets.js`, `src/rpc.js`, `client.js` | TC-6, TC-7, TC-9, TC-10, TC-11, TC-16 | t1, t2, t3a, t3b, t5, t9b | ✅ |
| FR-3 | 渠道元数据表（`help`）+ 说明浮层 | `src/channels/meta.js`, `src/rpc.js`, `client.js` | TC-16, TC-18, TC-19 | t1, t5, t10 | ✅ |
| FR-4 | 客户端组件面（`ChannelRail`/`ConnectionField`） | `client.js` | TC-4, TC-5 | t8, t9a, t9b | ✅ |
| FR-5 | 客户端组件面 | `client.js` | TC-4, TC-5 | t8, t11 | ✅ |
| FR-6 | `composeUrl`/`parseKey` + 数据模型 + 迁移矩阵 | `src/targets.js`, `index.js`, `src/channels/*.js` | TC-8, TC-12, TC-13, TC-14, TC-15, TC-17, TC-20, TC-21 | t3b, t4, t6, t12 | ✅ |
| **合计** | 5 类接口条目 | 6 个模块文件 | 21 个用例 | 14 张卡 | **6/6 条款有主** |

**反向核对**：设计的六个契约块（渠道元数据 / `composeUrl`·`parseKey` / 数据模型 v2 / Host RPC / 客户端组件面 / 说明浮层）全部被认领；21 条用例全部出现在覆盖对照，无孤儿用例；UC-1…UC-5 由 TC 与 t12 的真实装载验收体现，不单独落卡。

## 批次与依赖

```
批次 1（契约与数据，可并行）：
   t1 渠道元数据 ──▶ t2 composeUrl/parseKey ──┬──▶ t3a ──▶ t3b ──┬──▶ t4 迁移与回滚
   t7 图标表（独立）                          │                  ├──▶ t5 RPC 追加
                                              └──────────────────┼──▶ t6 投递接 composeUrl
批次 2（界面）：
   t5 + t7 ──▶ t8 rail 三段
   t5 + t7 ──▶ t9a 详情卡骨架 ──▶ t9b 字段区 ──┬──▶ t10 说明浮层
   t7 + t9b ──▶ t11 绑定页
批次 3（验收与文档）：
   t4, t6, t8, t9b, t10, t11 ──▶ t12 装载验收与文档
```

**依赖顺序自检**：所有 `depends_on` 均指向**前面已定义**的 key（无前向引用、无自依赖、无悬空）。

## 风险与回滚

| 风险 | 应对 |
|---|---|
| key 反解误判（用户手改过 url） | 只按渠道固定前缀反解；不命中即保留 url 直投 + warn（TC-13），绝不猜 |
| 改数据模型把已验收的投递行为带歪 | 硬边界卡 t6 只允许改「地址来源」，报文与加签由 TC-20 逐条守 |
| 界面改动误伤既有插槽/选择器契约 | 选择器契约 v1 与返回值不变（TC-18/19 覆盖），t12 用活体插槽查询复验 |
| 图标借鉴的署名与来源 | 每个 glyph 注释标 `取自 dsh-im` + `<GlyphName>`；README 与 `THIRD_PARTY_NOTICES` 记来源（t7/t12） |
| 回滚丢投递能力 | v2 同时落派生 `url`；回滚模拟用例 TC-14/AC-9 必须过 |

---

## 追加切片（2026-09-30 用户裁定并入）：通知报文上下文 + 飞书富卡片

设计见 [design/notify-payload.md](design/notify-payload.md)。三张卡，先说人话：

| key | 标题 | phase | side | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| t15 | 通知里带上「谁的会话、在哪、说了什么、怎么结束」 | implement | backend | — | `node --test test/payload.test.js` 全绿：字段开关与顺序、摘要截断、跳过 goal 自动轮、工作区形态、时间格式、模板占位符、缺字段降级逐项有用例 |
| t16 | 飞书通知变成卡片，底部一键回到 DSH | implement | backend | t15 | `node --test test/channels.feishu.test.js` 全绿：报文为 `interactive` 卡片，标题按事件配色，分栏含会话与摘要，按钮 `url === 'dsh://open'`，且业务码判定仍为 `code === 0` |
| t17 | 这批改动不碰其它五个渠道（回归 + 文档） | test | fullstack | t16 | `node --test "test/*.test.js"` 全绿，且企微/钉钉/Slack/Discord/自定义的报文断言**一字未改**（`git diff` 仅新增用例、未改既有断言）；README 与架构文档补「报文可配置」「飞书卡片」两节 |

覆盖对照（本批）：t15 t16 t17
