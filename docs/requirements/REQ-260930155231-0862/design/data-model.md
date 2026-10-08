---
requirement_refs: [FR-2, FR-4, FR-5, FR-7, FR-9, FR-10]
---

# 数据模型设计（REQ-260930155231-0862）

> 本份定死字段、文件格式、迁移与回滚。持久化两份文件 + 一份内存结果。

## TL;DR `serves: FR-2, FR-5`

- **目标清单**放插件自己的 `targets.json`（不进 profile YAML）。
- **窗口绑定**沿用既有 `bindings.json`：**顶层结构不变，新增一段** `targetBindings`——旧版本会忽略未知键，所以**回滚不会丢绑定**。
- **投递结果**只在内存（重启清空，需求已限定）。

## 目标记录 `serves: FR-2, FR-4, FR-7`

```typescript
interface TargetRecord {
  /** 稳定标识：保存时由 Host 生成，[a-z0-9-]{3,40}，全清单唯一 */
  id: string
  /** 人看的名字，1..60 字（如「项目群-企微」） */
  name: string
  /** 渠道（决定报文与错误码判定） */
  channel: 'wecom' | 'feishu' | 'dingtalk' | 'slack' | 'discord' | 'custom'
  /** webhook 地址：http/https 绝对地址，1..2000 字 */
  url: string
  /** 加签密钥的凭据引用名（仅 feishu/dingtalk 有意义；空 = 未开启加签） */
  secretRef?: string
  /** 自定义请求头（仅 custom 有意义） */
  headers?: Record<string, string>
  /** 是否启用（停用 = 不投递，但保留配置） */
  enabled: boolean
  /** 关心的事件类型；空数组 = 全收 */
  events: Array<'turn/end' | 'approval/asked' | 'ask_user_question' | 'goal/*'>
  /** 是否属于默认目标组（未绑定窗口走这一组） */
  isDefault: boolean
}
```

**约束**：

| 规则 | 行为 |
|---|---|
| `id` 唯一 | 冲突时保存被拒（由 Host 生成，正常不会冲突） |
| `name` 非空 | 空则拒（人要能认出这条） |
| `url` 必须 http/https | 否则拒（沿用既有校验函数） |
| `feishu`/`dingtalk` 且 `secretRef` 非空 | 保存前检查该凭据**存在**；不存在 → 拒绝保存并提示 |
| `events` 取值 | 只接受上表枚举；空数组 = 全收（**不是**"都不收"） |
| 同渠道 + 同 url 重复 | 保存时提示"疑似重复"，允许但投递时**按 `channel+url` 去重**（FR-3） |

## 目标清单文件 `serves: FR-2, FR-9`

**位置**：`$DSH_HOME/state/dsh-notice-webhook/targets.json`（与 `bindings.json` 同目录；`DSH_HOME` 未设置时回落 `~/.dsh`）。

**格式**：

```json
{
  "version": 1,
  "targets": [
    {
      "id": "wecom-project",
      "name": "项目群-企微",
      "channel": "wecom",
      "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***",
      "enabled": true,
      "events": ["turn/end"],
      "isDefault": false
    }
  ]
}
```

**读写纪律**（与既有 `bindings.json` 完全同口径）：

| 情况 | 行为 |
|---|---|
| 文件不存在 | 空清单启动，**不创建文件**（首次保存才创建） |
| 非法 JSON | warn + 空清单 + **不覆盖原文件** |
| `version` 不认识 | warn + 空清单 + **不覆盖原文件** |
| 单条记录非法 | 跳过该条 + warn，其余照常加载 |
| 写入 | `tmp` → `rename` 原子写；失败 → 保存**被拒**（不谎报成功）+ warn |

## 窗口绑定（扩展既有文件）`serves: FR-5, FR-9`

**关键设计**：`bindings.json` 的**顶层结构与既有版本一致**，只**新增**一段：

```json
{
  "version": 1,
  "bindings": {
    "session-b7c5…": { "url": "https://example.com/hook", "updatedAt": "2026-09-30T04:37:01.901Z" }
  },
  "targetBindings": {
    "session-b7c5…": { "targetIds": ["wecom-project", "slack-team"], "updatedAt": "2026-09-30T06:00:00.000Z" }
  }
}
```

**为什么这么设计（回滚安全是硬约束）**：
| 事实 | 推论 |
|---|---|
| 旧版本读 `version: 1` 且**忽略未知顶层键** | 新增 `targetBindings` 段不会让旧版本报错 |
| 旧版本据 `bindings` 段投递 | 新版本继续维护 `bindings` 段 → **回滚后老绑定照旧生效** |
| 新版本需要"窗口 → 多目标" | 读 `targetBindings`；不存在时回落 `bindings` 的 url 匹配 |

**双读单写**：

- **读**：`targetBindings[sid]` 优先；没有则用 `bindings[sid].url` 去找同地址目标（找不到则按需隐式创建一条 `custom` 目标）。
- **写**：两个段一起写（`bindings` 存"首个目标地址"供旧版本用；`targetBindings` 存完整 id 列表）。

### 绑定语义（替代而非叠加）`serves: FR-5, FR-6`

| 规则 | 行为 |
|---|---|
| 会话有 `targetBindings[sid]` 且非空 | **只发这些目标**；默认组不参与（否则同一条通知会发两遍到同一个群） |
| 绑定为空 / 不存在 | 发默认组（`isDefault && enabled`），并受总开关约束 |
| 绑定里的目标被删或停用 | 该目标从集合消失；若集合因此为空 → 视为未绑定 → 回落默认组（**不报错**） |
| 解绑（`unbindTargets` / `bindTargets(sid, [])` / 界面解绑） | 删掉 `targetBindings[sid]`，回落默认组 |
| 旧版 url 绑定（`bindings[sid].url`） | 仅作兼容读入（映射为同地址目标）；解绑时**一并清除**——避免"界面显示已解绑、旧字段还在发" |

## 投递结果 `serves: FR-10`

**内存结构**（不持久化）：

```typescript
interface Outcome {
  /** ISO-8601 */
  at: string
  ok: boolean
  /** HTTP 状态码（网络层失败时为 undefined） */
  status?: number
  /** 失败原因：业务错误码 / 网络错误 / 打包失败 */
  reason?: string
}
// 每个目标保留最近 N 条（N = 5）
type OutcomeStore = Map<string /* targetId */, Outcome[]>
```

**约束**：进程重启即清空；`GET /state` 只返回最近 N 条；**结果里不得出现密钥明文**（`reason` 来自渠道模块的格式化文本，渠道模块只允许写业务码与平台提示，不写 URL/密钥）。

## 迁移与兼容 `serves: FR-9`

### 老配置的等价映射 `serves: FR-9`

| 老数据 | 新模型下的等价物 | 生效时机 |
|---|---|---|
| Config 的 `webhookUrl`（非空） | 一条隐式目标：`{ id: 'legacy-default', channel: 'custom', url: <值>, enabled: true, events: [], isDefault: true }` | 启动时；若清单里已有同 url 目标则直接复用 |
| `bindings.json.bindings[sid].url` | 该窗口绑定到"同 url 的目标"（不存在则用上面的隐式目标并入库） | 启动 / 首次解析该会话时 |
| 老 `webhookHeaders` 配置 | 作为隐式目标的 `headers` | 启动时 |
| 老 `notifyComplete` 等开关 | Config 中保留同名字段（语义不变） | 一直 |

**优先级**：显式配置的目标清单 > 隐式 legacy 目标。两者指向同一 url 时**只保留一条**（避免双发）。

### 回滚路径 `serves: FR-9`

| 步骤 | 结果 |
|---|---|
| 卸载新版本 | 客户端半消失（设置页入口消失），Host 半回到旧代码 |
| 保留 `targets.json` | 旧版本不认识该文件，**不读不写**，无影响 |
| 保留 `bindings.json` | 旧版本读 `bindings` 段（新版本一直在维护）→ **绑定照旧生效** |
| 结论 | 回滚**无损**：不丢绑定、不报错、不残留半配置 |

### 破坏性变更 `serves: FR-9`

**无**。出站 `version: 1` 契约保持；`dshNoticeWebhook` 旧方法保留（只增不减）；配置文件只增字段。
