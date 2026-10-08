# t-ef947a 暴露 Host Service dshNoticeWebhook·联调

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
暴露 Host Service dshNoticeWebhook·联调

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/service.test.js 与 node --test test/e2e.local.test.js 均全绿，且后者断言绑定会话改道到绑定地址

## 汇报 1（2026-09-30T05:55:19.936Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

联调段完成：服务的注册/卸载与"消费方拿到服务后真的能改道"两条链路都跑通了，且插件在真实 Host 里是激活态。

### 完成项

- 联调验证：provideService 注册进 fake ctx 后可取回、dispose 后消失（test/service.test.js）
- 联调验证：createNotifier 产出的 service 可直接被 e2e 用例调用（bind 后事件改道到绑定地址，test/e2e.local.test.js 旁路用例）
- 真实 Host 侧已在 plugin_manager list_plugins 中确认插件行 enabled + fiberPhase=active

---
