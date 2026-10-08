---
requirement_refs: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
sides: [backend]
---

# 用例设计：谁在什么时候会/不会被叫一声

> 全部场景都以「一个顶层会话 S + 一个 webhook 目标」为前提；时间轴自上而下。
> 记号：`⤫` = 不投递，`✓` = 投递一条完成通知，`↻` = 补发。

## UC-1 主场景：派活给 continuable 子代理（现状误报，修后不报） <!-- serves: FR-1, FR-2 -->

```
S: turn/start
S: tool subagent_fork("写设计文档")      → 子会话 C 建立，status=running（不注册 job）
S: turn/end(completed)
   └─ 闸门：jobIds=[]，subagentIds=['C'] → ⤫（旧行为：✓「会话已完成」← 本需求修的误报）
C: …… 跑了 12 分钟后 turn/end(completed) → subagent/end(C)
   └─ 复检 S：无 job ∧ 无 running 后代 → 起 1500ms 宽限
S: （DSH 把 C 的结果送回并唤醒 S）turn/start → pending 作废 → ⤫（补发取消）
S: turn/end(completed)                   → ✓「会话已完成」（这一条才是真的）
```

**验收关注点**：整条链路**恰好 1 条**完成通知，且它出现在子代理结束之后。

## UC-2 静默唤醒路径（`completionDelivery:'quiet'` / 唤醒预算耗尽） <!-- serves: FR-2 -->

```
S: turn/end(completed) → ⤫（子代理在跑）
C: turn/end + subagent/end(C) → 复检通过 → 起宽限
        1500ms 内 S 没有新轮次 → ↻ 补发一条「会话已完成」
```

**为什么必须有兜底**：DSH 的结算唤醒不是强保证；没有补发，使用者会**什么都收不到**。

## UC-3 continuable 的多 epoch（唤醒既有子代理） <!-- serves: FR-2, FR-3 -->

```
S: turn/start → tool send_message(给既有子代理 C) → C 起新 epoch，status=running
S: turn/end(completed) → ⤫（C running）
C: 第 1 个 epoch turn/end → subagent/end(C)
   └─ 复检：C 又被唤醒进第 2 个 epoch（status 仍 running）→ 继续挂起（不补发）
C: 第 2 个 epoch turn/end → subagent/end(C) → 复检通过 → 起宽限 → …→ ↻ 一条
```

**关注点**：continuable 子代理会反复结算，**"结算一次就发"是错的**；判定必须现查存活。

## UC-4 混合场景：后台 job + 子代理 <!-- serves: FR-1, FR-2, FR-6 -->

```
S: tool bash(run_in_background) → job bash-7（既有 job 路）
S: tool subagent(...)           → 子会话 C（新子代理路）
S: turn/end(completed) → ⤫ reason='work-running'（jobIds=['bash-7']、subagentIds=['C']）
bash-7 settled                   → watched 清空，但 C 仍 running → 不补发
C: subagent/end                  → 两路都空 → 起宽限 → ↻ 一条
```

## UC-5 不该被压住的四种情况 <!-- serves: FR-3, FR-4 -->

| 场景 | 期望 |
|---|---|
| 子代理已 `idle`（跑完仍在会话里等着被继续用） | 正常 ✓——空闲常驻不得让父会话永久静音 |
| 条目有 `parentSession` 但没有 `origin:'subagent'`（普通 fork / 派生窗口） | 正常 ✓——它是独立会话 |
| 别的会话的子代理在跑 | 正常 ✓ |
| `jobAwareComplete: false` 或组合里没有 `agents` 服务 | 正常 ✓（旧行为）+ 降级 warn 一次 |

## UC-6 子代理自己结束时的静默（边界，明确不做） <!-- serves: FR-5 -->

```
C: turn/end(completed) → onlyTopLevel 过滤 → ⤫（子代理从不单独通知）
```

**这是既有语义，本需求不改**：子代理是"内部工序"，只有顶层使用者的"会话完成"才值得叫人。

## UC-7 插件卸载 / 会话销毁 <!-- serves: FR-2, FR-4 -->

```
dispose() → 清 pending + 宽限计时器 + 摘 subagent/end 订阅 + 摘 agents 接线
后续：不补发、不报错、不留悬挂回调（既有 e2e 断言覆盖）
```
