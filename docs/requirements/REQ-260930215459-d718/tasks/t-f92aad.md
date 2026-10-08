# t-f92aad targets.json v2 与校验收口·研发

> 需求：REQ-260930215459-d718 通知设置页按原型重做并借鉴 dsh-im 图标

## 在做什么
targets.json v2 与校验收口·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/targets.test.js 全绿；grep -c 'TARGET_FILE_VERSION = 2' src/targets.js ≥ 1；node --check src/targets.js 通过

## 汇报 1（2026-09-30T14:26:38.231Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：v2 存储与校验收口。

### 完成项

- TARGET_FILE_VERSION 升 2，读写按 v2
- 非法 key 拒写且文件字节不变
- test/targets.test.js 16/16 全绿

### 改动文件

- `src/targets.js`
- `test/targets.test.js`

---
