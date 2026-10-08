# t-9fbd01 v1→v2 迁移与回滚·研发

> 需求：REQ-260930215459-d718 通知设置页按原型重做并借鉴 dsh-im 图标

## 在做什么
v1→v2 迁移与回滚·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/compat.v3.test.js 全绿；grep -c 'migrateV1Record' src/targets.js ≥ 2；node --check src/targets.js 通过

## 汇报 1（2026-09-30T14:29:55.485Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：迁移与回滚双双落地，6 条用例全绿。

### 完成项

- src/targets.js：v1 读取路径增 migrateV1Record + 读成功后立即落 v2
- src/channels/meta.js：composeUrlFor 增遗留回落分支
- 新增 test/compat.v3.test.js 6/6 全绿

### 改动文件

- `src/targets.js`
- `src/channels/meta.js`
- `test/compat.v3.test.js`

---
