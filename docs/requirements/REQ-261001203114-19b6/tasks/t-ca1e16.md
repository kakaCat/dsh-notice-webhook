# t-ca1e16 前端：设置页「关心事件」与保存语义

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
前端：设置页「关心事件」与保存语义

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：ui
- 端侧：frontend

## 得到什么结果
跑 node --test test/client-render.test.js test/client-service.test.js test/client-hooks.test.js 退出码 0；跑 grep -c "turn/error" client.js 期望 ≥2；断言 EVENT_IDS.length===5，且全勾时提交载荷为 {events:[],eventsMode:'all'}、取消勾选「会话中断」后为 {events:[4 项],eventsMode:'explicit'}。

## 实施方案（implementation）
client.js：EVENTS 在「对话完成」之后插入 { id:'turn/error', label:'会话中断', field:'turn/error' }；save() 计算 allChecked（勾选集合 == EVENT_IDS）→ 全勾提交 {events: [], eventsMode:'all'}，否则提交 {events: 勾选, eventsMode:'explicit'}；selectTarget() 回显口径不变（events 空 = 全勾）。不改布局/样式/图标/renderTargetPicker 契约。

## 上游产出摘要（dependsSummary）
- 数据契约：目标事件语义 eventsMode 与事件清单

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:51:17.078Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

这一步做完，设置页多了一项「会话中断」，而且「全选」终于等于真的全收——以后插件再新增通知类型，用户不用手动回来补勾。

### 完成项

- EVENTS 在「对话完成」之后新增「会话中断」项（EVENT_IDS 变 5 项，新建目标默认全勾）
- save() 改为：全勾 → 提交 events: [] + eventsMode 'all'；未全勾 → 提交勾选列表 + 'explicit'
- selectTarget 回显口径不变（events 为空 = 全勾），并补注释说明依赖后端载入时的归一化
- 验收：node --test test/client-render.test.js test/client-service.test.js test/client-hooks.test.js 全绿；grep -o turn/error client.js 命中 2 处

### 改动文件

- `client.js`

---
