# t-ce5f74 升级 Host Service 到 v2·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
升级 Host Service 到 v2·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/service.v2.test.js 全绿（7/7）；grep -c 'SERVICE_VERSION = 2' src/service.js ≥ 1；node --check src/service.js 通过

## 汇报 1（2026-09-30T09:36:25.481Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：service v2 落盘，7 条用例全绿。

### 完成项

- 落地 src/service.js v2（版本 2 + 五个新方法）
- 落地 test/service.v2.test.js 并跑绿 7/7

### 改动文件

- `src/service.js`
- `test/service.v2.test.js`

---
