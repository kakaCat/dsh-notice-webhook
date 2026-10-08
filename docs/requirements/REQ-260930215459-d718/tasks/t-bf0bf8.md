# t-bf0bf8 TargetRecord 加 key 与派生 url·复核

> 需求：REQ-260930215459-d718 通知设置页按原型重做并借鉴 dsh-im 图标

## 在做什么
TargetRecord 加 key 与派生 url·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/targets.test.js 全绿；grep -c 'key' src/targets.js ≥ 5；对照 docs/requirements/REQ-260930215459-d718/design/data-model.md §1 TargetRecord v2 逐条给出结论

## 汇报 1（2026-09-30T14:24:23.044Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

复核段完成：与数据模型契约一致。

### 完成项

- 对照 data-model.md §1 TargetRecord v2：字段、必填、约束逐条一致
- 核对「url 是派生值但必须落盘」与「遗留记录直投」两条规则
- 确认无偏离

---
