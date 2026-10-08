---
title: 实施自评审 · 通知去噪（REQ-261002150038-344a）
requirement_refs: [REQ-261002150038-344a]
updated: 2026-10-02
---

# 实施自评审

> 谁写的：本需求的实施窗口（agent）。**这是一份自评审，不是独立第三方评审**——
> 它的作用是交代「我按什么口径验的、哪里出过错、哪条结论我不完全有把握」，供人工验收时挑刺。

## 1. 结论

- 需求 5 条 FR 全部落地，**无范围蔓延**（未加功能、未改配置键、未动落盘与契约版本）。
- 设计与实现**逐行对账无偏离**：真值表 14/14、轮次行为 9/9、「任务」口径 6/6、卡片字段集与不变项全对。
- 全量 `node --test "test/*.test.js"` → **307 / 0**（基线 288），用例只增不减。
- 交付**可以验收**；但有 §4 的两条遗留需要人知道。

## 2. 逐条 FR 自评

| FR | 落点 | 证据 | 自评 |
|---|---|---|---|
| FR-1 注入轮识别 | `src/source.js` + `test/source.test.js` | 14 行真值表逐行打印，偏离 0 | 达标 |
| FR-2 完成意图静默 / 中断照推 | `src/goal.js` + `test/goal.auto.test.js` | 9 行行为表 + 端到端 silent/0 条、error/1 条 | 达标 |
| FR-3 注入文本不进「任务」 | `src/payload.js` + `test/payload.test.js` | 6 行口径表 + 报文实测「任务=人的话」 | 达标 |
| FR-4 卡片删「类型」行 | `src/channels/feishu.js` + `client.js` | 卡片报文实测无「类型」；预览两区断言；文本渠道仍带标记 | 达标 |
| FR-5 回归与文档同步 | README + `tests/verification-report.md` | 307/0；报告含数字对照与回滚路径 | 达标 |

## 3. 评审中抓到的问题（含我自己的错）

| # | 问题 | 性质 | 处置 |
|---|---|---|---|
| 1 | 联调脚本首版把 `user/message` 的返回值当成判定结果（`action=ignored`） | **我的脚本 bug**，不是产品缺陷 | 改为取 `turn/end` 的返回值，结论不变（silent/0 条） |
| 2 | 客户端预览断言按 markdown 原文（含 `**`）写，实际渲染已去星号 | 我的断言写错 | 改按渲染后文本断言；区域拼接改为无分隔连接 |
| 3 | 端到端里飞书目标 `key: 'abc'` 被格式校验拒绝 → `no-targets` | 用例构造问题 | 改为「只给完整地址的遗留形态」并加 `saved.ok` 断言 |
| 4 | 验收报告 §5 回滚清单漏写「测试必须一起回退」 | **报告不准确** | 已补正（5 个既有测试文件 + 1 个新文件） |
| 5 | `test/e2e.multi.test.js` 首次全量出现 4/5 超时 | 既有并发偶发（该文件注释早有记录） | 未改该文件（超范围）；后续 4 次全量复跑均 307/0，已在验收报告如实登记 |

## 4. 遗留与不确定性（请人工重点看）

1. **真机未验**：本次只有本地 HTTP 接收端；真实飞书群 / 企微群里的卡片外观与「自动续跑不再响」未在真机确认——
   该插件的 Host 半要**重启 Host** 才加载，客户端的 `client.js` 刷新页面即可。
2. **口径的取舍**：「非 direct human 即注入」意味着 DSH 将来若用新的 `source.kind` 表示真人输入，
   会被默认静默（宁可漏推、不刷屏）。判定是单点函数，改动成本低，但**这是有意识的偏向**。
3. `test/e2e.multi.test.js` 的并发偶发仍在（未修），若它再次出现，与本需求无关。

## 5. 回归方式（复核者可直接跑）

```bash
node --test "test/*.test.js"          # 期望 tests 307 / pass 307 / fail 0
node --test test/e2e.local.test.js    # 期望 6 / 0（含 TC-24…TC-27）
node -e "import('./src/source.js').then(m=>console.log(m.isHumanSource(undefined), m.isHumanSource({kind:'user'}), m.isHumanSource({kind:'dive'})))"
# 期望输出：true true false
```
