# t-3b6f2f 兼容与回滚收尾

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
兼容与回滚收尾

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：implement
- 端侧：backend

## 得到什么结果
node --test test/compat.v2.test.js 全绿：老配置等价映射、坏文件不覆盖、卸载后除 targets.json / bindings.json 外无残留

## 实施方案（implementation）
补齐 legacy 映射边界（legacy 与显式清单同 url 时只保留一条）、坏文件降级路径、卸载后目录残留检查；新增 test/compat.v2.test.js。验证：跑该测试全绿。

## 上游产出摘要（dependsSummary）
- 接线主链路与 legacy 等价映射

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T10:44:29.518Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

t15 完成：老配置不用改就能跑、坏文件只跳过不覆盖、卸载只需删掉一个目录即完全回滚且不碰会话数据——兼容与回滚三条路都有测试兜底。

### 完成项

- 交付 test/compat.v2.test.js 并跑绿 8/8（legacy 映射/坏文件/共存/卸载残留/零迁移/回滚安全）
- legacy 与显式清单同 url 只保留一条、不发两遍
- 卸载残留检查：状态目录只留 targets.json 与 bindings.json，无 .tmp
- 全量回归 158/158

### 改动文件

- `test/compat.v2.test.js`
- `index.js`

---
