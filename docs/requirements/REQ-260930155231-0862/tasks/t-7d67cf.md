# t-7d67cf 实现目标集合解析与替代默认组·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
实现目标集合解析与替代默认组·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/router.resolve.test.js 全绿（5/5）；grep -c 'resolveGroup' src/router.js ≥ 1；node --check src/router.js 通过

## 汇报 1（2026-09-30T10:09:44.822Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：目标集合解析落盘，5 条用例全绿。

### 完成项

- 落地 src/router.js 多目标解析
- 落地 test/router.resolve.test.js 并跑绿 5/5

### 改动文件

- `src/router.js`
- `test/router.resolve.test.js`

---
