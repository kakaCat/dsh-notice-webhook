# t-8b13aa 客户端半：会话绑定页与解绑·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
客户端半：会话绑定页与解绑·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

grep -c 'BindingTable' client.js ≥ 2；node --test test/client-service.test.js 全绿（8/8）

## 汇报 1（2026-09-30T11:49:38.186Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：会话绑定页落盘。

### 完成项

- 落地 BindingTable（会话列 / 目标 chips / 解绑列）
- 悬空引用标红 + 空态引导文案
- 解绑二次确认与 404 兜底

### 改动文件

- `client.js`

---
