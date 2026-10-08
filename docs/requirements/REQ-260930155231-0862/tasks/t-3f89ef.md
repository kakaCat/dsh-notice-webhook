# t-3f89ef 客户端半：目标编辑与动作

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
客户端半：目标编辑与动作

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：frontend

## 得到什么结果
打开 设置 → Webhook 通知 → 新增目标 表单：填 ftp://x 保存被拒并显示行内错误，targets.json 未被修改；合法保存后 rail 徽标 +1 且无需刷新

## 实施方案（implementation）
在 client.js 实现表单（渠道切换时字段可见性变化）与动作：保存 POST /targets、删除 /targets/delete、启停开关（乐观更新+失败回滚）、发送测试 /test；错误行内展示，409 提示刷新并保留已填内容。验证：打开设置页操作并看行内错误与徽标变化。

## 上游产出摘要（dependsSummary）
- 客户端半：设置页骨架与目标页

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T10:54:05.952Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t11 完成：目标能在页面上真正增删改与发测试了——填错地址当场行内报错且不落盘，两个人同时改会提示刷新并保留你填的内容。

### 完成项

- client.js 实现表单（渠道切换时字段可见性变化：加签/自定义头按渠道出现）
- 动作：保存 POST /targets、删除 /targets/delete、启停（乐观更新）、发送测试 /test
- 错误行内展示；409 刷新最新状态并保留用户已填内容
- test/client-service.test.js 8/8 绿

### 改动文件

- `client.js`

---
