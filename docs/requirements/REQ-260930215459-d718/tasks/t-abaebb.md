# t-abaebb TargetRecord 加 key 与派生 url·研发

> 需求：REQ-260930215459-d718 通知设置页按原型重做并借鉴 dsh-im 图标

## 在做什么
TargetRecord 加 key 与派生 url·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/targets.test.js 全绿；grep -c 'composeUrlFor' src/targets.js ≥ 1；node --check src/targets.js 通过

## 汇报 1（2026-09-30T14:23:20.821Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：目标存 key、地址派生落盘。

### 完成项

- src/targets.js：validateTarget 接受 key 并派生 url；遗留记录（有 url 无 key）放行直投
- test/targets.test.js 增至 16/16 全绿

### 改动文件

- `src/targets.js`
- `test/targets.test.js`

---
