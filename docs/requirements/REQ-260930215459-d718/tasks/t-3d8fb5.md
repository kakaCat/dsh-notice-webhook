# t-3d8fb5 渠道适配器加 composeUrl / parseKey

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
渠道适配器加 composeUrl / parseKey

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/channels.meta.test.js 全绿：三渠道 parseKey(composeUrl({channel,key})) === key；反解失败返回 undefined 且不抛异常；node --check src/channels/wecom.js 等六个文件均通过

## 实施方案（implementation）
在 src/channels/{wecom,dingtalk,feishu,slack,discord,custom}.js 各加两个纯函数：composeUrl(target)（input==='url' 时直接返回 target.url，否则 urlPrefix+key）、parseKey(url)（按前缀/路径末段反解，失败返回 undefined）。在 channels/index.js 导出统一入口 composeUrl/parseKey。严禁改 buildRequest/isSuccess。验证：新增 test/channels.meta.test.js 的互逆与失败用例。

## 上游产出摘要（dependsSummary）
- 建渠道元数据表与校验

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T14:18:47.216Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t2 完成：URL 的拼装与反解各有一个纯函数入口——填 key 的目标能拼出完整地址，老地址也能反解回 key；两者互为逆运算且失败时不抛异常（迁移敢用它的前提）。

### 完成项

- 六个适配器各加 composeUrl/parseKey 薄封装；实现集中在 meta.js（避免六份重复）
- channels/index.js 导出统一入口 composeUrl(target)/parseKey(channel,url) 与 channelMetaProjection
- test/channels.meta.test.js 增至 18/18：互逆、失败返回 undefined 不抛、未注册回落、封装与统一入口一致

### 改动文件

- `src/channels/meta.js`
- `src/channels/index.js`
- `src/channels/wecom.js`
- `src/channels/dingtalk.js`
- `src/channels/feishu.js`
- `src/channels/slack.js`
- `src/channels/discord.js`
- `src/channels/custom.js`
- `test/channels.meta.test.js`

---
