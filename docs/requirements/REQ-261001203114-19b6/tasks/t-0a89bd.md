# t-0a89bd 分类契约：turn/end 终态决策表（纯函数）·研发

> 需求：REQ-261001203114-19b6 会话异常中断通知：turn/end 按 reason 分类，error/interrupted 不再谎报完成

## 在做什么
分类契约：turn/end 终态决策表（纯函数）·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`npx vitest run <本卡改动涉及的测试文件>` → 全绿；并附 `git diff --stat` 摘要

---
## 汇报 1（2026-10-01T12:49:19.532Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

turn/end 的结论改由**终态**决定：只有 completed 说「会话已完成」，error/interrupted/未知终态走「会话异常中断（错误码）」并带结构化错误事实，aborted/blocked/max-tokens/forked 静默但绝不谎报完成。

### 完成项

- 决策表纯函数 decideTurnEnd(reason, skipReasons) 落地：7 行判定顺序，aborted 提前到第 1 条（否则 turn-aborted 不可达）
- errorFacts()：code 缺省 UNKNOWN，message 单行化 + 截断 200
- silentReasonOf() 给出 turn-skipped / turn-aborted / turn-not-notifiable 三种静默码
- Classifier.classify 的 turn/end 分支改为查表，产出 reason/error 两个新字段
- 验收探针：8 种终态输出与分类表逐行一致（completed→complete；error/interrupted/weird→interrupt；其余→null）

### 改动文件

- `src/classify.js`

---
