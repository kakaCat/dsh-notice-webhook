# t-8e7cc0 详情卡字段区：key 输入 / 加签 chip / 事件网格 / 谁在用 / 最近投递·研发

> 需求：REQ-260930215459-d718 通知设置页按原型重做并借鉴 dsh-im 图标

## 在做什么
详情卡字段区：key 输入 / 加签 chip / 事件网格 / 谁在用 / 最近投递·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/client-service.test.js 全绿；grep -c 'EventFilterGrid' client.js ≥ 2；node --check client.js 通过

## 汇报 1（2026-09-30T14:49:37.046Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：字段区与原型对齐。

### 完成项

- 字段区五处落盘：key/url 按元数据切换、加签 chip、事件网格调序、谁在用 chips、投递分列
- client-service.test.js 16/16 全绿

### 改动文件

- `client.js`
- `test/client-service.test.js`

---
