# REQ-260930123701-250a 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v1

**交付结论**：交付结论：DSH Webhook 通知插件按 12 张任务卡（含 37 张子卡）全部实现并自检通过——三类"该被叫一声"的事件（对话完成 / 等待授权 / 等待回答）POST 到配置的 webhook，并叠加会话窗口级地址绑定（总开关关闭时旁路照发）与 goal 自动轮静默（只在目标终态推送）。全量 66 条测试全绿（含真实本地 HTTP 接收端端到端用例），49 张卡逐张有 covers 覆盖对照（100%），插件已装入 profile 且在运行中的 Host 里激活（enabled + fiberPhase=active）。一同提交测试证据报告与实施评审报告（含 5 条偏差结论与风险遗留）。**一处验证限制必须说明**：真实 Host 上「跑一轮对话看接收端收到通知」未能验证——新装插件的配置需 Host 重启才生效，本轮只验到"装载与激活"；代码级链路已由本地端到端用例覆盖，复核三步写在测试证据报告末节。

## 1. 验收列表

### v1-1 · 建立插件包骨架与配置层

**验收内容**：【建立插件包骨架与配置层】验收：node --check index.js 与 node --check src/config.js 均通过；且运行 node -e "import('./src/config.js').then(m=>console.log(m.normalizeConfig({timeoutMs:-1}).timeoutMs))" 输出 5000（越界回落默认），同时日志出现 1 条 warn

**操作步骤**：
1. node --check index.js 与 node --check src/config.js 均通过
2. 且运行 node -e "import('./src/config.js').then(m=>console.log(m.normalizeConfig({timeoutMs:-1}).timeoutMs))" 输出 5000（越界回落默认），同时日志出现 1 条 warn

**预期结果**：按上述步骤执行后满足验收标准：node --check index.js 与 node --check src/config.js 均通过；且运行 node -e "import('./src/config.js').then(m=>console.log(m.normalizeConfig({timeoutMs:-1}).timeoutMs))" 输出 5000（越界回落默认），同时日志出现 1 条 warn

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-2 · 实现绑定表与原子持久化

**验收内容**：【实现绑定表与原子持久化】验收：node --test test/bindings.test.js 全绿；用例含：bind() 后读取文件内容为 {"version":1,...}；把文件写成非法 JSON 后 list() 返回空数组且原文件字节不变

**操作步骤**：
1. node --test test/bindings.test.js 全绿
2. 用例含：bind() 后读取文件内容为 {"version":1,...}
3. 把文件写成非法 JSON 后 list() 返回空数组且原文件字节不变

**预期结果**：按上述步骤执行后满足验收标准：node --test test/bindings.test.js 全绿；用例含：bind() 后读取文件内容为 {"version":1,...}；把文件写成非法 JSON 后 list() 返回空数组且原文件字节不变

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-3 · 暴露 Host Service dshNoticeWebhook

**验收内容**：【暴露 Host Service dshNoticeWebhook】验收：node --test test/service.test.js 全绿；断言 version === 1、bind('', 'https://x') 返回 false、bind('s1','ftp://x') 返回 false、unbind('不存在') 返回 false、resolve('未绑定且无默认地址') 返回 null

**操作步骤**：
1. node --test test/service.test.js 全绿
2. 断言 version === 1、bind('', 'https://x') 返回 false、bind('s1','ftp://x') 返回 false、unbind('不存在') 返回 false、resolve('未绑定且无默认地址') 返回 null

**预期结果**：按上述步骤执行后满足验收标准：node --test test/service.test.js 全绿；断言 version === 1、bind('', 'https://x') 返回 false、bind('s1','ftp://x') 返回 false、unbind('不存在') 返回 false、resolve('未绑定且无默认地址') 返回 null

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-4 · 实现 webhook 投递层

**验收内容**：【实现 webhook 投递层】验收：node --test test/deliver.test.js 全绿；用例含：本地接收端返回 200 → 判定成功且请求体含 version/event/message；指向 http://127.0.0.1:1/ → 判定失败且不抛异常；接收端返回 302 → 判定失败（不跟随重定向）；日志文本不含 URL 的 query 串

**操作步骤**：
1. node --test test/deliver.test.js 全绿
2. 用例含：本地接收端返回 200 → 判定成功且请求体含 version/event/message
3. 指向 http://127.0.0.1:1/ → 判定失败且不抛异常
4. 接收端返回 302 → 判定失败（不跟随重定向）
5. 日志文本不含 URL 的 query 串

**预期结果**：按上述步骤执行后满足验收标准：node --test test/deliver.test.js 全绿；用例含：本地接收端返回 200 → 判定成功且请求体含 version/event/message；指向 http://127.0.0.1:1/ → 判定失败且不抛异常；接收端返回 302 → 判定失败（不跟随重定向）；日志文本不含 URL 的 query 串

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-5 · 实现事件分类与过滤

**验收内容**：【实现事件分类与过滤】验收：node --test test/classify.test.js 全绿；覆盖 TC-1…TC-5：有标题时正文等于「修复登录 bug · 会话已完成」、无标题时为「会话已完成」、tool/call(name=read) 返回 null、parentSession 存在的会话返回 null、reason.kind=interrupted 返回 null

**操作步骤**：
1. node --test test/classify.test.js 全绿
2. 覆盖 TC-1…TC-5：有标题时正文等于「修复登录 bug · 会话已完成」、无标题时为「会话已完成」、tool/call(name=read) 返回 null、parentSession 存在的会话返回 null、reason.kind=interrupted 返回 null

**预期结果**：按上述步骤执行后满足验收标准：node --test test/classify.test.js 全绿；覆盖 TC-1…TC-5：有标题时正文等于「修复登录 bug · 会话已完成」、无标题时为「会话已完成」、tool/call(name=read) 返回 null、parentSession 存在的会话返回 null、reason.kind=interrupted 返回 null

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-6 · 实现 goal 自动轮识别与静默

**验收内容**：【实现 goal 自动轮识别与静默】验收：node --test test/goal.auto.test.js 全绿；覆盖 TC-9：3 条 source.kind='goal' 的 user message 各接一个 turn/end → 产生 0 条意图；再插 1 条人工 user message + turn/end → 产生 1 条意图

**操作步骤**：
1. node --test test/goal.auto.test.js 全绿
2. 覆盖 TC-9：3 条 source.kind='goal' 的 user message 各接一个 turn/end → 产生 0 条意图
3. 再插 1 条人工 user message + turn/end → 产生 1 条意图

**预期结果**：按上述步骤执行后满足验收标准：node --test test/goal.auto.test.js 全绿；覆盖 TC-9：3 条 source.kind='goal' 的 user message 各接一个 turn/end → 产生 0 条意图；再插 1 条人工 user message + turn/end → 产生 1 条意图

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-7 · 实现 goal 终态识别与去重

**验收内容**：【实现 goal 终态识别与去重】验收：node --test test/goal.terminal.test.js 全绿；覆盖 TC-10/TC-11：phase=complete 产出 goal/complete；blocked + code=round-limit + maxGoalRounds=20 的正文包含 20/20；同一 (goalId, revision, phase) 重复上报不产出第二条

**操作步骤**：
1. node --test test/goal.terminal.test.js 全绿
2. 覆盖 TC-10/TC-11：phase=complete 产出 goal/complete
3. blocked + code=round-limit + maxGoalRounds=20 的正文包含 20/20
4. 同一 (goalId, revision, phase) 重复上报不产出第二条

**预期结果**：按上述步骤执行后满足验收标准：node --test test/goal.terminal.test.js 全绿；覆盖 TC-10/TC-11：phase=complete 产出 goal/complete；blocked + code=round-limit + maxGoalRounds=20 的正文包含 20/20；同一 (goalId, revision, phase) 重复上报不产出第二条

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-8 · 实现路由层与总开关旁路

**验收内容**：【实现路由层与总开关旁路】验收：node --test test/router.test.js 全绿；覆盖 TC-6…TC-8：会话 X 绑定地址 B 后事件只到 B；enabled:false 时已绑定会话仍发、未绑定会话不发；notifyApproval:false 时已绑定会话也不发

**操作步骤**：
1. node --test test/router.test.js 全绿
2. 覆盖 TC-6…TC-8：会话 X 绑定地址 B 后事件只到 B
3. enabled:false 时已绑定会话仍发、未绑定会话不发
4. notifyApproval:false 时已绑定会话也不发

**预期结果**：按上述步骤执行后满足验收标准：node --test test/router.test.js 全绿；覆盖 TC-6…TC-8：会话 X 绑定地址 B 后事件只到 B；enabled:false 时已绑定会话仍发、未绑定会话不发；notifyApproval:false 时已绑定会话也不发

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-9 · 接线整合与本地端到端联调

**验收内容**：【接线整合与本地端到端联调】验收：node --test test/e2e.local.test.js 全绿；本地接收端按序收到 5 类 event（turn/end、approval/asked、ask_user_question、goal/complete、goal/blocked）各至少 1 条且 goal/blocked 正文包含「轮次耗尽」；把地址改为 http://127.0.0.1:1/ 再跑，测试进程退出码为 0

**操作步骤**：
1. node --test test/e2e.local.test.js 全绿
2. 本地接收端按序收到 5 类 event（turn/end、approval/asked、ask_user_question、goal/complete、goal/blocked）各至少 1 条且 goal/blocked 正文包含「轮次耗尽」
3. 把地址改为 http://127.0.0.1:1/ 再跑，测试进程退出码为 0

**预期结果**：按上述步骤执行后满足验收标准：node --test test/e2e.local.test.js 全绿；本地接收端按序收到 5 类 event（turn/end、approval/asked、ask_user_question、goal/complete、goal/blocked）各至少 1 条且 goal/blocked 正文包含「轮次耗尽」；把地址改为 http://127.0.0.1:1/ 再跑，测试进程退出码为 0

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-10 · 装载到 profile 并做真实 Host 验收

**验收内容**：【装载到 profile 并做真实 Host 验收】验收：plugin_manager list_plugins 输出含 include:dsh-notice-webhook enabled=true；重启 Host 后用 python3 接收端跑一轮对话，应收到 event=turn/end 且 message 含「会话已完成」

**操作步骤**：
1. plugin_manager list_plugins 输出含 include:dsh-notice-webhook enabled=true
2. 重启 Host 后用 python3 接收端跑一轮对话，应收到 event=turn/end 且 message 含「会话已完成」

**预期结果**：按上述步骤执行后满足验收标准：plugin_manager list_plugins 输出含 include:dsh-notice-webhook enabled=true；重启 Host 后用 python3 接收端跑一轮对话，应收到 event=turn/end 且 message 含「会话已完成」

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-11 · 处理迁移与兼容（旧数据 / 共存 / 回滚）

**验收内容**：【处理迁移与兼容（旧数据 / 共存 / 回滚）】验收：node --test test/compat.test.js 全绿；用例含：删除绑定文件后启动 list() 返回空数组且不创建文件；文件写入 {"version":99} 后启动返回空表且原文件未被覆盖；卸载插件后除 bindings.json 外无残留文件（grep 工作区无插件引用）

**操作步骤**：
1. node --test test/compat.test.js 全绿
2. 用例含：删除绑定文件后启动 list() 返回空数组且不创建文件
3. 文件写入 {"version":99} 后启动返回空表且原文件未被覆盖
4. 卸载插件后除 bindings.json 外无残留文件（grep 工作区无插件引用）

**预期结果**：按上述步骤执行后满足验收标准：node --test test/compat.test.js 全绿；用例含：删除绑定文件后启动 list() 返回空数组且不创建文件；文件写入 {"version":99} 后启动返回空表且原文件未被覆盖；卸载插件后除 bindings.json 外无残留文件（grep 工作区无插件引用）

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-12 · 写插件使用说明 README

**验收内容**：【写插件使用说明 README】验收：grep -c 'webhookUrl' README.md ≥ 1 且 grep -c 'curl' README.md ≥ 1；README 含配置项表、Host Service 消费示例、本地接收端验证命令三段

**操作步骤**：
1. grep -c 'webhookUrl' README.md ≥ 1 且 grep -c 'curl' README.md ≥ 1
2. README 含配置项表、Host Service 消费示例、本地接收端验证命令三段

**预期结果**：按上述步骤执行后满足验收标准：grep -c 'webhookUrl' README.md ≥ 1 且 grep -c 'curl' README.md ≥ 1；README 含配置项表、Host Service 消费示例、本地接收端验证命令三段

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-13 · 需求级验收

**验收内容**：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**操作步骤**：
1. 需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**预期结果**：按上述步骤执行后满足验收标准：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-15 · 需求级验收

**验收内容**：验收项不可照着验（历史数据）：以下验收项没写「怎么验」——验收项 建立插件包骨架与配置层·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 实现绑定表与原子持久化·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 实现 webhook 投递层·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 实现事件分类与过滤·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 暴露 Host Service dshNoticeWebhook·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。。请补可执行操作（命令/可查数据/界面路径）；本条不阻断验收，但必须有人看过并决定。

**操作步骤**：
1. 验收项不可照着验（历史数据）：以下验收项没写「怎么验」——验收项 建立插件包骨架与配置层·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
2. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。
3. 验收项 实现绑定表与原子持久化·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
4. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。
5. 验收项 实现 webhook 投递层·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
6. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。
7. 验收项 实现事件分类与过滤·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
8. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。
9. 验收项 暴露 Host Service dshNoticeWebhook·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论
10. 无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。。请补可执行操作（命令/可查数据/界面路径）
11. 本条不阻断验收，但必须有人看过并决定。

**预期结果**：按上述步骤执行后满足验收标准：验收项不可照着验（历史数据）：以下验收项没写「怎么验」——验收项 建立插件包骨架与配置层·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 实现绑定表与原子持久化·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 实现 webhook 投递层·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 实现事件分类与过滤·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。；验收项 暴露 Host Service dshNoticeWebhook·复核 缺「怎么验」（"对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据"）——只写断言词不算，必须给**可执行操作**：命令（npx/vitest/curl/pytest…）、可查数据（SQL/字段名）、或可达界面路径（打开某页→看什么）。否则验收只能靠相信，等于没验。。请补可执行操作（命令/可查数据/界面路径）；本条不阻断验收，但必须有人看过并决定。

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-16 · 需求级验收

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：按上述步骤执行后满足验收标准：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

### v1-18 · 需求级验收

**验收内容**：FR 追溯断链：以下功能点的 fr_to_tests 为空（FR→设计→任务→测试链路断裂）——FR-1；FR-4；FR-2；FR-3；FR-11；FR-5。请补任务卡 serves: FR-x 标注与测试 covers: t-xxx 标注；通过时意见须写明处置方式。

**操作步骤**：
1. FR 追溯断链：以下功能点的 fr_to_tests 为空（FR→设计→任务→测试链路断裂）——FR-1
2. FR-4
3. FR-2
4. FR-3
5. FR-11
6. FR-5。请补任务卡 serves: FR-x 标注与测试 covers: t-xxx 标注
7. 通过时意见须写明处置方式。

**预期结果**：按上述步骤执行后满足验收标准：FR 追溯断链：以下功能点的 fr_to_tests 为空（FR→设计→任务→测试链路断裂）——FR-1；FR-4；FR-2；FR-3；FR-11；FR-5。请补任务卡 serves: FR-x 标注与测试 covers: t-xxx 标注；通过时意见须写明处置方式。

**实际结果**：（待填写）

**验收状态**：⬜ 待验收

---

## 2. 测试报告

- 测试证据报告在 docs/requirements/REQ-260930123701-250a/tests/test-report.md（含分文件统计、关键断言、49 张卡逐张 covers 覆盖对照、复跑命令、验证限制）
- 实施评审报告在 docs/requirements/REQ-260930123701-250a/reviews/implementation-review.md（逐项评审 + 5 条偏差结论 + 风险遗留 + 验收前必办）
- node --test "test/*.test.js" → tests 66 / pass 66 / fail 0（分文件：classify 11/11、goal.auto 6/6、goal.terminal 10/10、bindings 9/9、service 5/5、deliver 6/6、router 8/8、e2e.local 4/4、compat 7/7）
- node --check index.js 与 src 下 7 个模块 → 全部通过（exit 0）
- 交付文件（真实存在）：package.json / cordis.patch.yml / index.js / README.md / src 下 7 个模块 / test 下 9 份用例
- plugin_manager list_plugins 证据：{entryId: include:dsh-notice-webhook, moduleName: dsh-notice-webhook, enabled: true, fiberPhase: active}
- profile 装载证据：宿主清单 /Users/mac/.dsh/profiles/desktop/package.json 中 dsh.profile.bundles 含 dsh-notice-webhook
- 端到端证据（本地真实 HTTP 接收端）：按序收到 turn/end、approval/asked、ask_user_question、goal/complete、goal/blocked 各一条，payload 字段全部符合 interfaces.md
- 失败隔离证据：接收端指向 http://127.0.0.1:1/ 时无未捕获异常、进程退出码 0、日志仅一条去敏 warn
- 旁路与静默证据：enabled:false + 已绑定 → 绑定地址 1 条 / 默认地址 0 条；3 轮 goal 自动轮 → 0 条推送
- ⚠️ 验证限制（如实）：真实 Host 的「跑一轮真实对话 → 接收端收到通知」未验成——新装插件配置需 Host 重启才被读取；本轮只验到装载与激活，复核三步见测试证据报告末节
- 验证环境已还原：宿主补丁文件与备份逐字节一致，本地接收端进程已停止

## 3. 文档完整性检查

✓ 9 类文档齐全

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v1-1 | 建立插件包骨架与配置层 | ⬜ 待验收 |  |  |
| v1-2 | 实现绑定表与原子持久化 | ⬜ 待验收 |  |  |
| v1-3 | 暴露 Host Service dshNoticeWebhook | ⬜ 待验收 |  |  |
| v1-4 | 实现 webhook 投递层 | ⬜ 待验收 |  |  |
| v1-5 | 实现事件分类与过滤 | ⬜ 待验收 |  |  |
| v1-6 | 实现 goal 自动轮识别与静默 | ⬜ 待验收 |  |  |
| v1-7 | 实现 goal 终态识别与去重 | ⬜ 待验收 |  |  |
| v1-8 | 实现路由层与总开关旁路 | ⬜ 待验收 |  |  |
| v1-9 | 接线整合与本地端到端联调 | ⬜ 待验收 |  |  |
| v1-10 | 装载到 profile 并做真实 Host 验收 | ⬜ 待验收 |  |  |
| v1-11 | 处理迁移与兼容（旧数据 / 共存 / 回滚） | ⬜ 待验收 |  |  |
| v1-12 | 写插件使用说明 README | ⬜ 待验收 |  |  |
| v1-13 | 需求级验收 | ⬜ 待验收 |  |  |
| v1-15 | 需求级验收 | ⬜ 待验收 |  |  |
| v1-16 | 需求级验收 | ⬜ 待验收 |  |  |
| v1-18 | 需求级验收 | ⬜ 待验收 |  |  |
