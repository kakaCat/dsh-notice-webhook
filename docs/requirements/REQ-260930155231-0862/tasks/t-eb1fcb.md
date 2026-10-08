# t-eb1fcb 客户端半：设置页骨架与目标页·测试

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
客户端半：设置页骨架与目标页·测试

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/client-service.test.js 全绿（ℹ pass 8 / fail 0）；其中「settings.section 注册」用例断言 id=dsh-notice-webhook 与 order=21

## 汇报 1（2026-09-30T10:52:55.671Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

测试段完成：8 条用例全绿，且验证了「除 react 外不 require 任何模块」这条 loader 约束。

### 完成项

- node --test test/client-service.test.js 8/8 全绿（真实产物求值）
- 证据：装载 id、inject ['slots']、settings.section 注册（id/order 21/label thunk）、服务 v1、选择器返回元素、卸载后 null、只 require react
- grep -c 'settings.section' client.js = 2（≥1）

---
