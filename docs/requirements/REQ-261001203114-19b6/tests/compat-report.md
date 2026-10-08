---
title: 迁移与兼容报告 · 会话异常中断通知
requirement_refs: [REQ-261001203114-19b6]
updated: 2026-10-01
---

# 迁移与兼容报告（t6）

> **结论**：三条兼容路径全部通过——**老记录开箱即收中断通知**、**用户明确取消勾选后关得掉**、**旧版本读新文件不丢目标**。
> 文件版本号**未变**（`targets.json` 仍 `version: 3`），只对单条记录追加了一个可选字段 `eventsMode`。

## 1. 老记录（本次改动前的目标清单）（serves: FR-5）

**场景**：改动前 UI 把「全选」写成显式四项 `['turn/end','ask_user_question','approval/asked','goal/*']`，且没有 `eventsMode`。
新增 `turn/error` 后，若照旧按白名单过滤，**所有既有目标都会把中断通知静默过滤掉**，而用户毫不知情。

**口径**：载入时把「恰等于旧版全集」的记录归一化为**全收**（`events: []` + `eventsMode: 'all'`，集合比较、顺序无关、幂等）。

**证据**：

```sh
node --test test/targets-events.test.js    # T6-2 用例：老文件写盘 → load → 断言 targetAccepts(turn/error) === true
node -e "import('./src/targets.js').then(m=>console.log(JSON.stringify(m.normalizeEvents(['turn/end','ask_user_question','approval/asked','goal/*'],undefined))))"
# 实际输出：{"events":[],"eventsMode":"all"}
```

## 2. 老客户端（不知道 `eventsMode` 的界面）（serves: FR-5）

| 老客户端提交 | 归一化结果 | 是否符合用户意图 |
|---|---|---|
| 显式四项（它眼里的「全选」） | `all` + 空列表 | ✅ 它不知道 `turn/error`，「全勾」就该包含新事件 |
| 少勾任意一项（例如只勾完成） | `explicit` + 该子集 | ✅ 尊重其手写选择 |

**证据**：`test/targets-events.test.js` 的 T6-1 / T6-5（`events: ['turn/end']` → `explicit`）。

## 3. 用户主动取消勾选「会话中断」（serves: FR-5）

**场景**：新界面里用户取消勾选「会话中断」→ 保存后的事件列表**恰好也是那四项**。
若只按"集合等于旧版全集"推断，会把他当成"全收"，等于**这个通知关不掉**。

**口径**：显式列表带 `eventsMode: 'explicit'`，载入时原样保持，永不自动追加。

**证据**：

```sh
node --test test/targets-events.test.js    # T6-4：save(explicit 四项) → 重新 load → targetAccepts('turn/error') === false
node -e "import('./src/targets.js').then(m=>console.log(JSON.stringify(m.normalizeEvents(['turn/end','ask_user_question','approval/asked','goal/*'],'explicit'))))"
# 实际输出：{"events":["turn/end","ask_user_question","approval/asked","goal/*"],"eventsMode":"explicit"}
```

## 4. 回滚（装回旧版本插件）（serves: FR-5）

| 关注点 | 事实 |
|---|---|
| 文件版本 | **未变**（`version: 3`）→ 旧版本的版本闸门照常放行，不会把它判成「不认识」 |
| 多出来的字段 | `eventsMode` 只存在于单条记录上；旧版本按白名单构建记录时**丢弃未知字段**、只读 `events` |
| 语义 | 新版本写出的 `events: []` 在旧语义里同样是「全收」；显式列表在两边语义一致 |
| 落盘结构 | 没有新增文件、没有新增顶层键、没有字段改名 |

**证据**：`test/targets-events.test.js` 的 T6-7（`version === 3`、记录含 `eventsMode`、既有字段一字未改）与 T6-8（模拟旧版本按已知字段白名单取值：`eventsMode` 不可见、`events: []` 仍是全收）。

## 5. 配置默认值变更（serves: FR-4）

| 键 | 变更 | 对老用户的影响 |
|---|---|---|
| `skipReasons` | `['interrupted','aborted']` → `['aborted']` | **未手写该键的用户**：`interrupted` 由静默变为推送中断 —— 正是本需求的目的；**手写过该键的用户**：原样保留（尊重其配置） |
| `notifyInterrupt` | 新增，默认 `true` | 不需要任何配置就开始收到中断通知 |
| `notifyInterrupt: false` | 关掉 = 中断静默 | **不是**回滚开关：它给静默，**不**回落成「会话已完成」（本包不提供"退回谎报"的开关） |

## 6. 出站契约兼容（serves: FR-3）

| 接收端 | 影响 |
|---|---|
| 按 `event` 分流的新接收端 | 新增 `turn/error` 分支即可；`reason` / `error` 为追加字段 |
| 只认 `turn/end` 的老接收端 | **收不到**中断通知（这是"新增 event 取值"方案的已知代价，已在 README 明示） |
| 其它五个渠道（企微/飞书/钉钉/Slack/Discord） | 报文形状一字未变（只发正文与标题） |
| 非中断事件 | `custom` 报文的键集合逐字节不变（有断言 T4-5 锁死） |

## 7. 本次自查抓到的两处实现偏差（都已修）

1. **`targetAccepts` 的 explicit 分支漏了 `goal/*` 通配**：会让「勾了目标终态」的目标突然收不到 goal 事件。
   被既有用例 `test/router.filter.test.js` 的 TC-9 当场抓住 → 抽出单一匹配函数 `listedEventMatches()` 供三种形态共用。
2. **判定顺序让 `turn-aborted` 不可达**：`aborted` 默认就在 `skipReasons` 里，静默名单排前面时专用码永远走不到。
   被新用例 T5-3 抓到 → 把 `aborted` 提前到第 1 条（行为不变，码变准），设计与实现文档同步。

## 8. 结论

- 三条兼容路径 ✅；回滚路径 ✅；文件版本未变 ✅。
- 既有断言改动 **3 处**，全部属于需求预期变更（旧行为就是要改掉的那一条）：
  `test/classify.test.js`（TC-5：`interrupted` 不再静默）、`test/config.test.js`（`skipReasons` 默认值、volatile 数量 10→11）。
- 其余 288 用例零改动通过。
