# t-8afa35 可嵌入选择器与客户端服务·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
可嵌入选择器与客户端服务·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

grep -c 'renderTargetPicker' client.js ≥ 2；node --test test/client-service.test.js 全绿（8/8）

## 汇报 1（2026-09-30T11:54:57.824Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：选择器与客户端服务落盘，8 条用例全绿。

### 完成项

- 落地 TargetPicker + TargetPickerHost（自取数据、内部兜错）
- 落地客户端服务注册（version 1 + renderTargetPicker + 卸载失效）
- 落地 test/client-service.test.js 并跑绿 8/8

### 改动文件

- `client.js`
- `test/client-service.test.js`

---
