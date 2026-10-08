# t-3f6aed 「怎么拿 key」说明浮层

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
「怎么拿 key」说明浮层

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：frontend

## 得到什么结果
node --test test/client-service.test.js 全绿：help 存在时可展开且含 steps/docUrl；help 缺失时不渲染入口；不调用 window.open；Esc 可关

## 实施方案（implementation）
client.js：新增 HelpPopover({help})，挂在 key 字段（或字段 label）旁的 ? 按钮；就地展开（popover）显示标题+有序步骤+「官方文档 ↗」链接（href=docUrl，新窗口）；再次点击或点空白/Esc 收起；help 缺失则整个入口不渲染；带 aria-expanded。验证：test/client-service.test.js 增浮层用例。

## 上游产出摘要（dependsSummary）
- 详情卡字段区：key 输入 / 加签 chip / 事件网格 / 谁在用 / 最近投递

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T14:53:50.322Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t10 完成：填写 key 的地方多了一个「?」——点开就在页面上看到「去哪建机器人、复制哪个字段、加签怎么开」，还能点官方文档；内容由后端下发，不用跳出去翻文档。

### 完成项

- client.js 新增 HelpPopover：? 按钮就地展开 help.title + 有序步骤 + 「官方文档 ↗」（docUrl 为空则不渲染外链）
- 可访问性：aria-expanded + Esc 关闭；不调用 window.open（链接用 href + target=_blank）
- help 缺失时整个入口不渲染（不留空面板）
- 挂在 key 字段 label 旁（url 渠道挂在「地址」label 旁）；client-service.test.js 增至 20 条全绿

### 改动文件

- `client.js`
- `test/client-service.test.js`

---
