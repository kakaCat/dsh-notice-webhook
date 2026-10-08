# t-6acade 写插件使用说明 README·研发

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
写插件使用说明 README·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

grep -c 'webhookUrl' README.md 与 grep -c 'curl' README.md 均 ≥ 1

## 汇报 1（2026-09-30T06:37:14.601Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：拿到这个插件的人现在有一份能照着做的说明书——怎么装、能配什么、推送长什么样、别的插件怎么接、怎么自己验一遍。

### 完成项

- 落地 README.md：装载步骤 + 配置项表（与 interfaces.md 一致）+ 推送契约与字段说明 + Host Service 消费示例 + 本地接收端验证命令
- 验收命令实测：grep -c webhookUrl = 1；grep -c curl = 1；配置项表标题 1 处；dshNoticeWebhook 示例 1 处；HTTPServer 验证段 1 处
- 另含「边界（本期不做）」与需求/设计文档索引，便于接手者自查

### 改动文件

- `README.md`

---
