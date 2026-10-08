# t-6d63df 升级 Host Service 到 v2·联调

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
升级 Host Service 到 v2·联调

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/service.v2.test.js 全绿（7/7）；grep -c 'bindTargets\|unbindTargets\|listBindings' src/service.js ≥ 3（新方法已接线）

## 汇报 1（2026-09-30T09:37:27.753Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

联调段完成：服务注册/卸载与"消费方拿到服务后真的能改道"两条链路跑通。

### 完成项

- 联调验证：createService 工厂 + provideService 注册/卸载（fake ctx 往返）
- 联调验证：消费方拿服务后 bindTargets 可改道（bindings 落盘可复现）
- 验证要点：旧消费方校验 version===2 时用新方法、===1 时用旧方法

---
