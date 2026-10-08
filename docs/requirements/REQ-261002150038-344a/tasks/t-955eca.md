# t-955eca 飞书卡片：删掉与标题重复的「类型」行

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
飞书卡片：删掉与标题重复的「类型」行

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：ui
- 端侧：backend

## 得到什么结果
node --test test/channels.feishu.test.js → 全绿；node -e 构造 buildCard 后打印 elements[0].fields 的标签拼接 → stdout 不含「类型」，且含 会话 / 工作区 / 任务 / 时间。

## 实施方案（implementation）
src/channels/feishu.js：buildCard() 里删掉 `if (typeof context?.title === 'string' && context.title.length > 0) fields.push(cardField('类型', context.title))` 及其注释；其余字段（会话 / 工作区 / 任务 / 详情 / 时间）顺序与 header（title、template）、按钮条件、idTag、无 context 的纯文本回落、buildRequest 加签一律不动。test/channels.feishu.test.js：把 `assert.ok(fields.includes('**类型**'), ...)` 翻转为 `assert.ok(!fields.includes('**类型**'), '卡片标题已给出事件，正文不再重复「类型」')`，并加强断言（fields 顺序为 会话→工作区→任务→时间、header 标题与配色、text_tag 短 id、dsh:// 无按钮、无 context 时仍是 msg_type:'text'）。

## 上游产出摘要（dependsSummary）
- （无依赖）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-02T07:11:56.096Z，窗口 session-eda4a33c-31bc-4d31-901d-5a9c640287bf）

这一步做完，飞书通知短了一行：标题已经说明是什么事，正文不再重复一遍——群里扫读更清爽。

### 完成项

- 飞书卡片正文删除与标题重复的「类型」行（src/channels/feishu.js）
- test/channels.feishu.test.js 两处断言翻转 + 新增字段顺序断言（会话 → 工作区 → 任务 → 时间）
- 真实报文核对：标题 ✅ 对话完成 / 配色 green / 正文四行、卡片 JSON 无「类型」
- 文本渠道仍保留「**类型**」行（边界成立）；无 context 仍回落纯文本
- 复核无偏离；全量 305 绿 / 0 失败

### 改动文件

- `src/channels/feishu.js`
- `test/channels.feishu.test.js`

### 下一步

t5 设置页预览与真卡片一致。

---
