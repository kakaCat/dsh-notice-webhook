# t-6eb2b2 建立插件包骨架与配置层·研发

> 需求：REQ-260930123701-250a DSH Webhook 通知插件（turn/end、approval、ask_user_question 推送）

## 在做什么
建立插件包骨架与配置层·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --check index.js 与 node --check src/config.js 均 exit 0

## 汇报 1（2026-09-30T05:34:20.921Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：插件的包骨架与配置层已落盘——多了一个可被 DSH 装载的包，以及一组带安全默认值的配置项。

### 完成项

- 落地 package.json（type: module、dsh.bundle.patch、无第三方依赖）
- 落地 cordis.patch.yml 装载行
- 落地 index.js 入口（只接线）
- 落地 src/config.js 配置层（18 项默认值 + 规整告警）
- node --check index.js 与 src/config.js 通过

### 改动文件

- `package.json`
- `cordis.patch.yml`
- `index.js`
- `src/config.js`

---
