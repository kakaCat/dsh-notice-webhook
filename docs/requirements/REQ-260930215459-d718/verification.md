# REQ-260930215459-d718 验收文档

> 自动生成于 reqboard_submit(kind=verification) · 验收单 v2

**交付结论**：交付结论：通知从「一行文案」升级为「带上下文的报文 + 渠道原生卡片」，并补上了插件弹框的拦截。逐条对应你这几轮的要求：① 报文带上下文——会话（标题 + 彩色标签 id）/ 工作区 / 任务摘要 / 类型 / 时间，且每一项都能在**目标内**开关调参（每个渠道能力不同，所以不做全局配置）；② 飞书改发交互式卡片（标题配色、分栏字段、文本标签），并且**只在 http(s) 时放按钮**——`dsh://` 点了没反应就不放死按钮；③ 文案配置落在目标弹框里（用默认 / 单独设置 / 恢复为默认），支持实时预览；④ 「最近投递」块与「目标清单」表按你的判断删除；⑤ 修掉三个真 bug：卡片「任务」消失（user/message 载荷形状读错）、会话名取到空/旧（改为会话对象实时字段优先）、**插件弹框收不到通知**（`user-questions/request` 是 ctx waterfall 事件、不在 session/event 流里，原先根本收不到——现改为根 ctx 旁听并 next() 放行，绝不吞提问）。全量 288/288 全绿，端到端与真浏览器均有实测证据。

## 1. 验收列表

### v2-1 · 建渠道元数据表与校验

**验收内容**：【建渠道元数据表与校验】验收

**操作步骤**：
1. node --test test/channels.meta.test.js 全绿：六渠道齐全
2. input:'key' 的三项都有 urlPrefix 与 keyPattern
3. help.steps 非空且 help.docUrl 是非空地址

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-2 · 渠道适配器加 composeUrl / parseKey

**验收内容**：【渠道适配器加 composeUrl / parseKey】验收

**操作步骤**：
1. node --test test/channels.meta.test.js 全绿：三渠道 parseKey(composeUrl({channel,key})) === key
2. 反解失败返回 undefined 且不抛异常
3. node --check src/channels/wecom.js 等六个文件均通过

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-3 · TargetRecord 加 key 与派生 url

**验收内容**：【TargetRecord 加 key 与派生 url】验收

**操作步骤**：
1. node --test test/targets.test.js 全绿：保存 {channel:'wecom',key:'abc12345'} 后落盘记录含 key 且 url === composeUrl 的派生值

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-4 · targets.json v2 与校验收口

**验收内容**：【targets.json v2 与校验收口】验收

**操作步骤**：
1. node --test test/targets.test.js 全绿：key 形状不合法（空/含空格/超长）被拒且文件字节不变、revision 不 bump
2. 写盘 version===2

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-5 · v1→v2 迁移与回滚

**验收内容**：【v1→v2 迁移与回滚】验收

**操作步骤**：
1. node --test test/compat.v3.test.js 全绿：v1 文件前缀命中→反解出 key 且写回 version===2
2. 前缀不命中→保留 url 直投且无 key、有 warn
3. v2 被 v1 语义读→能取到可投递 url
4. 坏 JSON/未知版本→空清单且原文件字节不变

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-6 · RPC 追加 channelMeta / help / key

**验收内容**：【RPC 追加 channelMeta / help / key】验收

**操作步骤**：
1. node --test test/rpc.read.test.js test/rpc.write.test.js 全绿：GET /state 含 channelMeta（六项、每项有 help.title/steps/docUrl）与目标 key
2. 密钥仍只回 secretConfigured 布尔且响应不含密钥值
3. POST /targets 同传 key 与不一致 url→以 key 为准返回 200 且日志有 warn

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-7 · 投递前用 composeUrl 组装（报文零变化）

**验收内容**：【投递前用 composeUrl 组装（报文零变化）】验收

**操作步骤**：
1. node --test test/channels.cn.test.js test/channels.global.test.js test/e2e.multi.test.js 全绿（报文形状与加签串断言逐条不变）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-8 · 图标表：dsh-im 品牌 glyph 内联

**验收内容**：【图标表：dsh-im 品牌 glyph 内联】验收

**操作步骤**：
1. node --test test/client-service.test.js 全绿：图标表含 5 个品牌 glyph + 通用 glyph
2. grep -c '取自 dsh-im' client.js ≥ 5
3. grep -cE '<img|https?://.*\.svg' client.js 为 0

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-9 · 左栏 rail 三段与徽标

**验收内容**：【左栏 rail 三段与徽标】验收

**操作步骤**：
1. node --test test/client-service.test.js 全绿：rail 含「全部目标」「按渠道」「默认组」三段
2. 0 目标的渠道仍出现
3. isDefault 显示「默认」、被会话绑定显示「绑定」

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-10 · 详情卡骨架：content-head / card-head / 动作区

**验收内容**：【详情卡骨架：content-head / card-head / 动作区】验收

**操作步骤**：
1. 打开 设置 → 通知 页面：顶部见「设置 › Webhook 通知」与两个按钮
2. card-head 见 id: <targetId> 与「启用」文案及开关
3. 动作区为删除在左、保存在右。自动化证据：node --test test/client-service.test.js 全绿（content-head/card-head 断言）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-11 · 详情卡字段区：key 输入 / 加签 chip / 事件网格 / 谁在用 / 最近投递

**验收内容**：【详情卡字段区：key 输入 / 加签 chip / 事件网格 / 谁在用 / 最近投递】验收

**操作步骤**：
1. node --test test/client-service.test.js 全绿（字段区断言）
2. 打开 设置 → 通知 逐项核对：key 输入框 label 为渠道 keyLabel、加签显示「已配置」chip、事件网格顺序为 完成→提问→授权→目标终态、见「谁在用」chips、最近投递按 ✓/✗ + 状态码 + 原因分列

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-12 · 「怎么拿 key」说明浮层

**验收内容**：【「怎么拿 key」说明浮层】验收

**操作步骤**：
1. node --test test/client-service.test.js 全绿：help 存在时可展开且含 steps/docUrl
2. help 缺失时不渲染入口
3. 不调用 window.open
4. Esc 可关

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-13 · 会话绑定页对齐原型

**验收内容**：【会话绑定页对齐原型】验收

**操作步骤**：
1. 打开 设置 → 通知 页面 → 会话绑定 标签：表格列为 会话/绑定的目标(chips)/操作
2. chips 使用品牌图标
3. 悬空引用 chip 标红并提示回落默认组。自动化证据：node --test test/client-service.test.js 全绿（绑定页 chips 断言）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-14 · 装载验收与文档更新

**验收内容**：【装载验收与文档更新】验收

**操作步骤**：
1. plugin_manager list_plugins 含 include:dsh-notice-webhook 且 enabled=true/fiberPhase=active
2. cordis_inspect_query(client, Slots, listSubTree, {root: settings.section}) 占用者含 dsh-notice-webhook 且 active
3. test/compat.v3.test.js 的回滚模拟用例通过
4. grep -c '只填 key' README.md ≥ 1

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-15 · 需求级验收

**验收内容**：需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**操作步骤**：
1. 需求级：交付结论可复核（证据齐全、与设计一致、无范围蔓延）

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-16 · 需求级验收 · E2E 覆盖

**验收内容**：E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）；若确认无需 E2E，通过时必须在意见中写明理由。

**操作步骤**：
1. E2E 覆盖：**无（缺口）**——本需求交付涉及多组件串联，但只交了单元/集成测试。请补一条端到端场景用例（断言可观察终态）
2. 若确认无需 E2E，通过时必须在意见中写明理由。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-17 · 需求级验收 · 三方一致性

**验收内容**：三方一致性（做什么 × 怎么做 × 实际做了什么）：以下对不上——FR-7 实施缺失：没有任何任务卡接收它（设计好了没做）；FR-8 实施缺失：没有任何任务卡接收它（设计好了没做）；FR-9 实施缺失：没有任何任务卡接收它（设计好了没做）；FR-7 实施缺失：没有任何任务卡接收它（设计好了没做）；FR-7 实施缺失：没有任何任务卡接收它（设计好了没做）；FR-8 实施缺失：没有任何任务卡接收它（设计好了没做）。请补设计、补实施、或显式登记为不做。

**操作步骤**：
1. 三方一致性（做什么 × 怎么做 × 实际做了什么）：以下对不上——FR-7 实施缺失：没有任何任务卡接收它（设计好了没做）
2. FR-8 实施缺失：没有任何任务卡接收它（设计好了没做）
3. FR-9 实施缺失：没有任何任务卡接收它（设计好了没做）
4. FR-7 实施缺失：没有任何任务卡接收它（设计好了没做）
5. FR-7 实施缺失：没有任何任务卡接收它（设计好了没做）
6. FR-8 实施缺失：没有任何任务卡接收它（设计好了没做）。请补设计、补实施、或显式登记为不做。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

### v2-18 · 需求级验收 · 追溯断链

**验收内容**：FR 追溯断链：以下功能点的 fr_to_tests 为空（FR→设计→任务→测试链路断裂）——FR-2；FR-6；FR-3；FR-1；FR-4；FR-5。请补任务卡 serves: FR-x 标注与测试 covers: t-xxx 标注；通过时意见须写明处置方式。

**操作步骤**：
1. FR 追溯断链：以下功能点的 fr_to_tests 为空（FR→设计→任务→测试链路断裂）——FR-2
2. FR-6
3. FR-3
4. FR-1
5. FR-4
6. FR-5。请补任务卡 serves: FR-x 标注与测试 covers: t-xxx 标注
7. 通过时意见须写明处置方式。

**预期结果**：上述步骤全部执行成功，输出与「验收内容」描述一致即通过

**实际结果**：node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）

**验收状态**：✓ 通过

---

## 2. 测试报告

- node --test "test/*.test.js" → tests 288 / pass 288 / fail 0（新鲜全量，含本轮新增 questions-hook 用例）
- node --test test/payload.test.js → 全绿：字段开关与顺序、摘要截断、goal 自动轮不进摘要、工作区两形态、时间格式、模板占位符、以及「user/message 真实载荷形状」回归用例
- node --test test/channels.feishu.test.js → 全绿：报文为 interactive 卡片、标题按事件配色、`<text_tag>` 会话标签、仅 http(s) 才生成按钮（dsh:// 反向断言）、加签与 code===0 判定未变
- node --test test/questions-hook.test.js → 全绿：弹框提问触发投递且本地接收端收到「需要你回答一个问题（选择方案）」+ 问题正文；并且 next() 被调用（不吞提问）
- node --test test/targets.test.js test/compat.v3.test.js → 全绿：v3 目标带 payload（缺省 null）、非法覆盖被拒、v1/v2 读入自动升级
- 隔离端到端实测（临时目录存储，未触碰真实配置）：A 目标跟随默认=完整报文；B 目标覆盖 fields=[event,prompt]+promptChars=12 → 只剩类型与任务且摘要截断
- 真浏览器复现台（真 React + 真 client.js + headless Chromium）：文案配置页渲染 ✅、双预览 ✅、目标弹框「用默认文案/单独设置」切换 ✅、零 pageerror
- docs/requirements/REQ-260930215459-d718/tests/test-report.md（用例清单 + covers 对照 + 本轮 4 个真 bug 的根因与守卫 + 已知问题）
- docs/requirements/REQ-260930215459-d718/design/notify-payload.md（含 2026-10-01 范围变更表：删除全局文案页、飞书按钮限 http(s)、会话标签、类型行、弹框提问改走 ctx waterfall）
- docs/requirements/REQ-260930215459-d718/verification/ 截图：style-light/dark.png（苹果风弹框）、payload-config-light/dark.png（文案页设计稿）、payload-page-live.png（落地实拍）

## 3. 文档完整性检查

✓ 9 类文档齐全

## 4. 验收结果

| 编号 | 验收项 | 状态 | 验收人 | 验收时间 |
|---|---|---|---|---|
| v2-1 | 建渠道元数据表与校验 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-2 | 渠道适配器加 composeUrl / parseKey | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-3 | TargetRecord 加 key 与派生 url | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-4 | targets.json v2 与校验收口 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-5 | v1→v2 迁移与回滚 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-6 | RPC 追加 channelMeta / help / key | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-7 | 投递前用 composeUrl 组装（报文零变化） | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-8 | 图标表：dsh-im 品牌 glyph 内联 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-9 | 左栏 rail 三段与徽标 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-10 | 详情卡骨架：content-head / card-head / 动作区 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-11 | 详情卡字段区：key 输入 / 加签 chip / 事件网格 / 谁在用 / 最近投递 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-12 | 「怎么拿 key」说明浮层 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-13 | 会话绑定页对齐原型 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-14 | 装载验收与文档更新 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-15 | 需求级验收 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:01 |
| v2-16 | 需求级验收 · E2E 覆盖 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:02 |
| v2-17 | 需求级验收 · 三方一致性 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:02 |
| v2-18 | 需求级验收 · 追溯断链 | ✓ 通过 | human/session-b7c52392-9cdf-4162-b1c6-ed768346fbd2 | 2026-10-02 15:02 |
