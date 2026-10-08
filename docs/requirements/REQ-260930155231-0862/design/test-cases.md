---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10]
---

# 测试用例设计（REQ-260930155231-0862）

> 每个用例标注 `validates: FR-x`；任务键（`covers: t-xxx`）在拆分阶段落库后回填。
> 渠道与路由全部是纯函数，**绝大多数用例不需要网络**。

## 功能测试用例 `serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10`

### TC-1：企业微信报文与业务码 `validates: FR-1` `serves: FR-1`

**测试目标**：`wecom` 渠道报文形状正确，且 HTTP 200 + `errcode!=0` 判定失败。

**步骤**：
1. `buildRequest` 一个 `wecom` 目标 + 一条完成通知；
2. `isSuccess(200, {errcode: 0})`；
3. `isSuccess(200, {errcode: 310000, errmsg: 'keywords not in content'})`。

**预期**：请求体等于 `{"msgtype":"markdown","markdown":{"content":"会话已完成"}}`；步骤 2 为 ok；步骤 3 为 not ok 且 `reason` 含平台 errmsg。

### TC-2：飞书报文与可选加签 `validates: FR-1, FR-7` `serves: FR-1`

**步骤**：无 `secretRef` 时 `buildRequest`；再给一个能取到 secret 的目标 `buildRequest`。

**预期**：无密钥时 body 只有 `msg_type`/`content`；有密钥时 body 额外含 `timestamp` 与 `sign`，且 `sign` 随 `now` 变化（同一 secret 不同时间戳 → 不同签名）。

### TC-3：钉钉报文与加签拼进 query `validates: FR-1, FR-7` `serves: FR-1`

**预期**：body 为 `msgtype=markdown` 且含 `title`；有 secret 时 `url` 含 `timestamp=` 与 `sign=` 两个 query 参数；`secretRef` 为空时 url 不带这两者。

### TC-4：Slack / Discord 最小报文 `validates: FR-1` `serves: FR-1`

**预期**：Slack body 为 `{"text":"<正文>"}`；Discord body 为 `{"content":"<正文>"}`；Discord `isSuccess(204, undefined)` 为 ok。

### TC-5：通用自定义渠道保持 v1 契约 `validates: FR-1, FR-9` `serves: FR-1`

**预期**：body 解析后含 `version/event/message/title/toolName/goal/sessionId/workspace/at/source`，且 `version === 1`；`target.headers` 原样进入请求头。

### TC-6：未知渠道不炸 `validates: FR-1` `serves: FR-1`

**预期**：目标 `channel: 'nope'` → `buildRequest` 返回 `{ error }`（不抛异常），该目标被跳过，其余目标照常。

### TC-7：业务错误码计入失败原因 `validates: FR-1, FR-10` `serves: FR-1, FR-10`

**步骤**：本地接收端对钉钉目标返回 200 + `{"errcode":310000,"errmsg":"token is not exist"}`。

**预期**：该目标结果为 `ok:false`，`reason` 含 `310000` 或平台 errmsg；其他目标不受影响。

### TC-8：多目标扇出互不影响 `validates: FR-3` `serves: FR-3`

**步骤**：目标 A 指向本地接收端、目标 B 指向 `http://127.0.0.1:1/`；触发一条通知。

**预期**：A 收到 1 条；B 结果为失败且有原因；测试进程退出码 0（无未捕获异常）。

### TC-9：逐目标事件过滤 `validates: FR-4` `serves: FR-4`

**步骤**：目标 A `events:["approval/asked"]`；目标 B `events:[]`；分别触发完成事件与授权事件。

**预期**：完成事件只到 B；授权事件到 A 和 B。

### TC-10：窗口绑定多目标与回落 `validates: FR-5` `serves: FR-5`

**步骤**：会话 X 绑 A+B；会话 Y 不绑；各触发一条。

**预期**：X 的事件到 A 与 B（且不到默认组）；Y 的事件只到默认组。

### TC-11：总开关只作用于默认组 `validates: FR-6` `serves: FR-6`

**步骤**：`enabled:false`；X 已绑定 A；Y 未绑定；各触发一条。

**预期**：X 的仍到 A；Y 的不到默认组。

### TC-12：同渠道同地址去重 `validates: FR-3` `serves: FR-3`

**步骤**：两个目标（不同 id、同 `channel` + 同 `url`）都启用；触发一条。

**预期**：该地址只收到 1 条。

### TC-13：密钥不回显 `validates: FR-7` `serves: FR-7`

**步骤**：目标含 `secretRef`；调用 `GET /state` 与 `listTargets()`；让该目标投递失败。

**预期**：两处返回都只有"是否已配置"（不带值）；日志与 `reason` 中 grep 不到密钥明文。

### TC-14：保存即时生效 `validates: FR-8` `serves: FR-8`

**步骤**：通过 RPC 新增一个指向本地接收端的目标（**不重启**）；触发一条通知。

**预期**：本地接收端收到；`GET /state` 的 `revision` 递增。

### TC-15：老配置零改动兼容 `validates: FR-9` `serves: FR-9`

**步骤**：只给 Config 的 `webhookUrl` 与一份老 `bindings.json`（`sessionId → url`）启动。

**预期**：通知按 v1 契约发出到该地址；老绑定过的会话仍改道到绑定地址。

### TC-16：坏文件不覆盖 `validates: FR-2, FR-9` `serves: FR-2, FR-9`

**步骤**：把 `targets.json` 写成非法 JSON；再写成 `{"version":99}`；各启动一次。

**预期**：两次都按空清单启动、有 warn、**原文件字节不变**。

### TC-17：RPC 版本栅栏 `validates: FR-2, FR-8` `serves: FR-2`

**步骤**：用过期 `revision` 提交一次目标保存。

**预期**：返回 `409` 且带回最新状态；清单未被修改。

### TC-18：非法目标被拒且不落盘 `validates: FR-2` `serves: FR-2`

**步骤**：分别提交 `url:"ftp://x"`、`name:""`、`secretRef` 指向不存在的凭据。

**预期**：三种都返回 `400` + 原因；`targets.json` 未被修改。

### TC-19：绑定替代默认组（不叠加）`validates: FR-5, FR-6` `serves: FR-5, FR-6`

**测试目标**：会话一旦绑定目标，就**不再**发默认组——避免同一条通知发两遍。

**步骤**：目标 A、B 设为默认组；目标 C 不是默认组；会话 X 绑定 C；触发一条通知。再把 X 绑成 A+C，触发一条。

**预期**：

1. 只到 C（默认组 A/B **都不发**）；
2. 第二条只到 A 与 C，B 不发（绑定集合里没有它）。

**覆盖场景**：[x] 正常流程 [x] 边界值（绑定集合与默认组部分重叠）

### TC-20：三方解绑回落默认组 `validates: FR-5` `serves: FR-5`

**测试目标**：`unbindTargets` 与 `bindTargets(sid, [])` 等价，且解绑后立刻回落默认组。

**步骤**：

1. `bindTargets('X', ['C'])` → 触发一条 → 只到 C；
2. `unbindTargets('X')` → 触发一条 → 到默认组；
3. 再绑 C，改用 `bindTargets('X', [])` 解绑 → 触发一条 → 到默认组；
4. 对**从未绑定**的会话调 `unbindTargets` → 返回值。

**预期**：步骤 1 只到 C；步骤 2/3 都到默认组且不再到 C；步骤 4 返回 `false` 且不报错。

**覆盖场景**：[x] 正常流程 [x] 边界值（空绑定 = 解绑）[x] 异常处理（无绑定可解）

### TC-21：会话绑定列表与解绑 `validates: FR-5, FR-10` `serves: FR-5`

**测试目标**：绑定页的数据来自 `GET /state` 的 `bindings`，解绑走 `bindings/delete`，且 `revision` 栅栏生效。

**步骤**：

1. 建两个绑定 → `GET /state`；
2. 用**过期** `revision` 调 `bindings/delete`；
3. 用最新 `revision` 调 `bindings/delete`。

**预期**：

1. `bindings` 含两条，且每条都能展开出目标的名称与渠道（不必客户端再 JOIN）；目标被删的那条显示为悬空（`targets` 里带 `enabled:false` 或缺失标记）；
2. 返回 `409` + 最新状态，绑定未改变；
3. 返回 `ok` + 新 `revision`，该条从 `bindings` 消失。

**覆盖场景**：[x] 正常流程 [x] 边界值（悬空引用）[x] 异常处理（版本冲突）

## 测试覆盖度统计 `serves: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10`

| 需求条款 | 关联任务 | 测试用例 | 覆盖状态 |
|---|---|---|---|
| FR-1 | 拆分阶段回填 | TC-1…TC-6, TC-7 | ✅ |
| FR-2 | 拆分阶段回填 | TC-14, TC-16, TC-17, TC-18 | ✅ |
| FR-3 | 拆分阶段回填 | TC-8, TC-12 | ✅ |
| FR-4 | 拆分阶段回填 | TC-9 | ✅ |
| FR-5 | 拆分阶段回填 | TC-10, TC-19, TC-20, TC-21 | ✅ |
| FR-6 | 拆分阶段回填 | TC-11, TC-19 | ✅ |
| FR-7 | 拆分阶段回填 | TC-2, TC-3, TC-13 | ✅ |
| FR-8 | 拆分阶段回填 | TC-14, TC-17 | ✅ |
| FR-9 | 拆分阶段回填 | TC-5, TC-15, TC-16 | ✅ |
| FR-10 | 拆分阶段回填 | TC-7, TC-13 | ✅ |

**端到端验收**（人工）：按 requirement.md「验收标准（整体）」跑 9 步；接收端用 requirement 里的 python3 片段（它同时回 `errcode:0`，可用于正向路径）。
