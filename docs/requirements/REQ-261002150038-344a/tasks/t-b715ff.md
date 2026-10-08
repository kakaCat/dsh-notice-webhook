# t-b715ff 端到端、兼容与回归收尾（无数据迁移，验证回滚路径）·研发

> 需求：REQ-261002150038-344a 通知去噪：Dive 自动轮不推送 + 卡片删除重复的「类型」行

## 在做什么
端到端、兼容与回归收尾（无数据迁移，验证回滚路径）·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`npx vitest run <本卡改动涉及的测试文件>` → 全绿；并附 `git diff --stat` 摘要

---
## 汇报 1（2026-10-02T07:16:05.184Z，窗口 session-eda4a33c-31bc-4d31-901d-5a9c640287bf）

这一步做完，四条关键行为在真接收端上被端到端证明了一遍，用户的原始抱怨（自动跑刷屏 + 卡片重复行）有了可复核的证据链。

### 完成项

- test/e2e.local.test.js 新增 TC-24…TC-27：真 HTTP 接收端上验证「自动续跑不响 / 人插话就响且任务=人的话 / 注入轮报错仍叫 / 飞书卡片无类型行」
- README「为什么需要它」补全注入轮口径表（谁在说话 → 推不推 / 任务字段显示什么）
- 写 docs/requirements/REQ-261002150038-344a/tests/verification-report.md：数字对照（288→293→304→305→307）、逐条命令、行为证据、不变量核验、回滚路径
- node --test test/e2e.local.test.js → 6 passed / 0 failed；全量 pnpm test → tests 307 / pass 307 / fail 0
- 过程自纠两处：飞书目标 key 格式校验（改用整段 token）、key 渠道会被 composeUrl 改写地址（端到端改用只给完整地址的遗留形态）

### 改动文件

- `test/e2e.local.test.js`
- `README.md`
- `docs/requirements/REQ-261002150038-344a/tests/verification-report.md`

### 下一步

复核子卡：把验收报告与设计逐条对账。

---
