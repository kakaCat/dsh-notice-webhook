# t-33a9df 处理迁移与兼容（旧数据 / 共存 / 回滚）·测试

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
处理迁移与兼容（旧数据 / 共存 / 回滚）·测试

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/compat.test.js 全绿（7 条，含 version:99 时不覆盖原文件）

## 汇报 1（2026-09-30T06:12:41.221Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

测试段完成：七条兼容用例全绿——升级不会被旧文件或坏文件绊倒，卸载后不留脏东西，与 dsh-notice 各过各的。

### 完成项

- node --test test/compat.test.js 7/7 全绿
- 用例证据：文件缺失不创建；version=99 空表且原文件不变；写入失败内存仍生效并告警；卸载残留仅 bindings.json；不碰 dsh-notice 触发目录；初始绑定不覆盖运行时绑定

---
