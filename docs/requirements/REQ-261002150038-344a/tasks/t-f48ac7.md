# t-f48ac7 口径契约：isHumanSource 纯函数与真值表

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
口径契约：isHumanSource 纯函数与真值表

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/source.test.js → 全绿且用例数 ≥ 5；node -e "import('./src/source.js').then(m=>console.log(m.isHumanSource(undefined), m.isHumanSource({kind:'user'}), m.isHumanSource({kind:'dive'})))" → 输出 `true true false`。

## 实施方案（implementation）
新增 src/source.js：export function isHumanSource(source) —— source 缺失 / source.kind 缺失 / kind === 'user' → true；非对象 / 数组 / 其余 kind（goal、dive、plugin、未来新增）/ 非字符串 kind → false（见 design/interfaces.md §1 真值表，实现即契约）。新增 test/source.test.js 覆盖 TC-1…TC-5（undefined/null、{}、{kind:'user'}、{kind:'goal'|'dive'|'plugin'}、{kind:'brand-new'|42|'user' 非对象|数组}）。本卡不改任何既有文件。

## 上游产出摘要（dependsSummary）
- （无依赖）

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-10-02T07:06:55.586Z，窗口 session-eda4a33c-31bc-4d31-901d-5a9c640287bf）

这一步做完，插件有了唯一一条「谁在说话」的判定函数，后面两张卡共用它，注入来源从此默认安静。

### 完成项

- 新增 src/source.js：isHumanSource 唯一口径（缺失或 kind==='user' 算人，其余算注入）
- 新增 test/source.test.js：TC-1…TC-5 覆盖真值表全部行
- 复核 14/14 行与 design/interfaces.md §1 一致，无偏离
- 单文件 5 绿；全量 293 绿 / 0 失败
- 未改动任何既有文件（零回归风险）

### 改动文件

- `src/source.js`
- `test/source.test.js`

### 下一步

t2 自动轮静默（GoalTracker 接入）与 t3 任务字段（PromptTracker 接入）。

---
