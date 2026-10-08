# t-f1e3ee 「任务」字段：注入正文不再冒充人的要求·研发

> 需求：REQ-261002150038-344a 通知去噪：Dive 自动轮不推送 + 卡片删除重复的「类型」行

## 在做什么
「任务」字段：注入正文不再冒充人的要求·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`npx vitest run <本卡改动涉及的测试文件>` → 全绿；并附 `git diff --stat` 摘要

---
## 汇报 1（2026-10-02T07:07:57.028Z，窗口 session-eda4a33c-31bc-4d31-901d-5a9c640287bf）

这一步做完，注入的正文不再冒充「任务」——卡片上那行只会是真人说的话，没人说话就整行消失。

### 完成项

- src/payload.js 的 PromptTracker 改用 isHumanSource（不再单点跳过 goal）
- 补上 payload.js 对 src/source.js 的导入与说明注释
- test/payload.test.js 增 TC-13…TC-16（注入不记、注入后取人的话、无 source 算人、渲染口径）
- node --test test/payload.test.js → 11 passed / 0 failed

### 改动文件

- `src/payload.js`
- `test/payload.test.js`

### 下一步

联调子卡：核验 promptTracker 在真实 notifier 报文里的表现。

---
