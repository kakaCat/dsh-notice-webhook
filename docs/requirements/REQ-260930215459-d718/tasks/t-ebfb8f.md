# t-ebfb8f 「怎么拿 key」说明浮层·联调

> 需求：REQ-260930215459-d718 通知设置页按原型重做并借鉴 dsh-im 图标

## 在做什么
「怎么拿 key」说明浮层·联调

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/rpc.read.test.js 全绿（/state 的 channelMeta 含 steps 与 docUrl）；grep -c 'help' client.js ≥ 2

## 汇报 1（2026-09-30T14:54:59.863Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

联调段完成：浮层内容与后端下发的 help 对齐，含 null 分支。

### 完成项

- 联调：help 来自 /state 的 channelMeta（含 steps 与 docUrl），前端不硬编码
- 联调：docUrl 为 null（通用自定义）时不渲染外链（实测元数据 custom.help.docUrl === null）

---
