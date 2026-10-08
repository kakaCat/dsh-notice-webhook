# t-e5d3cb 实现 Slack / Discord / 通用三渠道·测试

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
实现 Slack / Discord / 通用三渠道·测试

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/channels.global.test.js 全绿（ℹ pass 4 / fail 0）；其中「custom v1 契约字段逐项正确」用例断言 version=1 与 headers 透传

## 汇报 1（2026-09-30T09:18:14.697Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

测试段完成：4 条用例全绿。

### 完成项

- node --test test/channels.global.test.js 4/4 全绿
- 证据：Slack {text}、Discord {content}（204 成功）、custom v1 契约字段逐项正确、缺 title/session 回落 null

---
