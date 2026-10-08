# t-5cbf4c 出站报文：中断意图的 reason / error 与事件元数据

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
出站报文：中断意图的 reason / error 与事件元数据

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
跑 node -e "import('./src/channels/custom.js').then(m=>{const b=m.buildPayload({intent:{kind:'interrupt',event:'turn/error',message:'x',reason:'error',error:{code:'MALFORMED_RESPONSE',message:'m'}},session:{},title:null,now:0,contextText:null});const c=m.buildPayload({intent:{kind:'complete',event:'turn/end',message:'y'},session:{},title:null,now:0,contextText:null});console.log(JSON.stringify(b.reason),JSON.stringify(b.error),Object.keys(c).includes('reason'),c.version)})" 期望："error" {"code":"MALFORMED_RESPONSE","message":"m"} false 1；跑 node --test test/payload.test.js test/channels.meta.test.js 退出码 0。

## 实施方案（implementation）
src/channels/custom.js 的 buildPayload() 仅当 intent.kind==='interrupt' 时追加 reason: intent.reason 与 error: intent.error ?? null（非中断事件键集合逐字节不变）；src/payload.js 的 EVENT_META 增 'turn/error': { title:'⚠️ 会话中断', color:'red' }；五个渠道适配器零改动。

## 上游产出摘要（dependsSummary）
- 分类契约：turn/end 终态决策表（纯函数）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-01T12:51:16.972Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

这一步做完，接收端能按事件类型分流，并从结构化字段拿到错误码与详情——正文只留短码，不再把报错原文塞进消息刷屏。

### 完成项

- custom.buildPayload：仅中断意图追加 reason 与 error（非中断事件键集合逐字节不变）
- payload.js EVENT_META 增 'turn/error' → 「⚠️ 会话中断」/ 红色
- 五个渠道适配器零改动（只消费正文与上下文）
- 验收：中断报文 reason='error'、error={code,message}、version=1；完成报文不含 reason/error

### 改动文件

- `src/channels/custom.js`
- `src/payload.js`

---
