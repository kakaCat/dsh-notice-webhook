# t-e296cb 装载验收与文档更新

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
装载验收与文档更新

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：test
- 端侧：fullstack

## 得到什么结果
plugin_manager list_plugins 含 include:dsh-notice-webhook 且 enabled=true/fiberPhase=active；cordis_inspect_query(client, Slots, listSubTree, {root: settings.section}) 占用者含 dsh-notice-webhook 且 active；test/compat.v3.test.js 的回滚模拟用例通过；grep -c '只填 key' README.md ≥ 1

## 实施方案（implementation）
装载到 profile 后用 plugin_manager 与 cordis_inspect_query 复验双半；更新 README.md（配置口径改为只填 key、补迁移与回滚说明、图标来源署名）与 docs/architecture/notification-plugin.md（追加「组装点迁移」与「渠道元数据单点真相」两条决策）；THIRD_PARTY_NOTICES 记图标来源。验证：三条活体查询 + 回滚用例 + README grep。

## 上游产出摘要（dependsSummary）
- v1→v2 迁移与回滚
- 投递前用 composeUrl 组装（报文零变化）
- 左栏 rail 三段与徽标
- 「怎么拿 key」说明浮层
- 会话绑定页对齐原型

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T15:01:38.587Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t12 完成：插件在运行中的 Host 里仍是活的（Host 半 active、设置页「通知」已挂出），文档与第三方来源说明都补齐了；新的「只填 key」行为经独立进程走真实装载路径实测通过——要看到它生效需要重启 Host（客户端半刷新页面即可）。

### 完成项

- 活体验收：plugin_manager 含 include:dsh-notice-webhook enabled/active；cordis_inspect(client, Slots, settings.section) 占用者含本插件 active
- 回滚用例：test/compat.v3.test.js 的 TC-14 回滚模拟通过
- 文档：README 补「只填 key：地址前缀内置」与「老配置升级与回滚」两节；新增 THIRD_PARTY_NOTICES.md（图标来源+商标说明）；架构文档扩到 6 条决策 + 新增一条教训
- 未动运行中的 Host；Host 侧新行为用独立进程走 profile 装载路径实测（/state 回 channelMeta 六项与带 key 的目标）

### 改动文件

- `README.md`
- `THIRD_PARTY_NOTICES.md`
- `docs/architecture/notification-plugin.md`

---
