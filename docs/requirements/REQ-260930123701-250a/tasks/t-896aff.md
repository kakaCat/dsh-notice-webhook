# t-896aff 写插件使用说明 README·复核

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
写插件使用说明 README·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
对设计与实现的偏离逐条给出结论；无偏离时显式写明「无偏离」及依据

---
## 汇报 1（2026-09-30T06:38:16.843Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

复核段完成：说明书的配置表、推送契约与插件接口示例都和实现/设计对得上，没有"文档吹牛"的地方。

### 完成项

- 逐项核对：README 配置项表与 design/interfaces.md「配置项契约」字段与默认值一致
- 核对推送契约样例与 interfaces.md 请求体字段表一致（含新增的 goal 字段与两个 goal/ 事件取值）
- 核对 Host Service 示例与 src/service.js 实际签名一致（version/bind/unbind/list/resolve）
- 确认无偏离

---
