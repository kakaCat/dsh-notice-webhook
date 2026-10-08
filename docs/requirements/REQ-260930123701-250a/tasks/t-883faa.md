# t-883faa 实现绑定表与原子持久化·研发

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
实现绑定表与原子持久化·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/bindings.test.js 全绿

## 汇报 1（2026-09-30T05:38:40.148Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：会话窗口到 webhook 的绑定关系现在能跨重启活下来，且坏文件只会被跳过、不会被覆盖——重启后绑定不会莫名消失。

### 完成项

- 落地 src/bindings.js：绑定表（Map）+ 原子写盘（tmp → rename）
- 读取容错四态：文件缺失 / 非法 JSON / 未知 version / 单条非法，均按空表或跳过且不覆盖原文件
- 参数校验收紧为「非空白字符串 + http/https 绝对地址」
- node --test test/bindings.test.js 9/9 通过

### 改动文件

- `src/bindings.js`
- `test/bindings.test.js`

---
