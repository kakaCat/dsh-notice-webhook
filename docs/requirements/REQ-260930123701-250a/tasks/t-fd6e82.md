# t-fd6e82 建立插件包骨架与配置层

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
建立插件包骨架与配置层

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --check index.js 与 node --check src/config.js 均通过；且运行 node -e "import('./src/config.js').then(m=>console.log(m.normalizeConfig({timeoutMs:-1}).timeoutMs))" 输出 5000（越界回落默认），同时日志出现 1 条 warn

## 实施方案（implementation）
新增 package.json（type: module、dsh.bundle.patch 指向 ./cordis.patch.yml、不引第三方依赖）；新增 cordis.patch.yml 用 insert 写一条 id: dsh-notice-webhook 的装载行；新增 index.js 只导出 apply(ctx, config) 做接线；新增 src/config.js 提供 DEFAULTS 与 normalizeConfig（类型不符或越界回落默认值并写一条 warn）。

## 上游产出摘要（dependsSummary）
- （无依赖）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T05:33:50.141Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

插件的「门牌 + 旋钮」立起来了：现在多了一个能被 DSH 装载的包，以及一组带安全默认值的配置项——写错类型或数值越界时会自动落回默认值并留一条警告，不会让插件跑偏或加载失败。

### 完成项

- 新增可被 DSH 装载的插件包清单（Host-only，无第三方依赖）
- 新增 bundle 装载补丁，声明默认通道与总开关两项配置
- 新增插件入口 apply(ctx, config)，只做接线、不含业务判定
- 新增配置层：18 项默认值 + 取值规整（类型不符/越界回落默认并告警）
- 验收：node --check 两个文件通过；越界值实测回落 5000 并输出 1 条 warn

### 改动文件

- `package.json`
- `cordis.patch.yml`
- `index.js`
- `src/config.js`

---
