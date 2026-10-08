# t-f5f9e9 数据契约：目标事件语义 eventsMode 与事件清单·研发

> 需求：REQ-261001203114-19b6 会话异常中断通知：turn/end 按 reason 分类，error/interrupted 不再谎报完成

## 在做什么
数据契约：目标事件语义 eventsMode 与事件清单·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`npx vitest run <本卡改动涉及的测试文件>` → 全绿；并附 `git diff --stat` 摘要

---
## 汇报 1（2026-10-01T12:49:19.645Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

目标的「关心事件」有了**明确的两种语义**：「全收」（含未来新增事件）与「我明确只要这些」；新增的中断通知因此能到老目标，而主动取消勾选的用户也关得掉。

### 完成项

- EVENT_TYPES 追加 turn/error（既有四项顺序不变）
- 新增 LEGACY_ALL_EVENTS（改动前 UI「全选」写出的唯一形态）
- normalizeEvents(events, mode) 纯函数：all / explicit / 缺省推断三态，幂等、集合比较、顺序无关
- validateTarget 读取 input.eventsMode 并在输出中带上；未知事件仍按既有规则报错
- 验收探针：旧版全集→all+空列表；explicit 四项→原样保持；explicit 空→全不收；TARGET_FILE_VERSION 仍为 3

### 改动文件

- `src/targets.js`

---
