# t-f2fe94 兼容与回滚收尾·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
兼容与回滚收尾·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/compat.v2.test.js 全绿（8/8）；grep -c 'legacy' test/compat.v2.test.js ≥ 3

## 汇报 1（2026-09-30T10:45:31.718Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：兼容测试落盘，8 条全绿，全量 158/158。

### 完成项

- 落地 test/compat.v2.test.js 并跑绿 8/8
- 修 test 的隐式目标 id 断言（改用 channel+url 稳定性验证）
- 全量回归 158/158

### 改动文件

- `test/compat.v2.test.js`
- `index.js`

---
