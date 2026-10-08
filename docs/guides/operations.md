---
title: 运维与排障
slug: operations
requirement_refs: [REQ-260930123701-250a, REQ-260930155231-0862]
updated: 2026-09-30
---

# 运维与排障

> **TL;DR**：状态只有两份文件（`targets.json` / `bindings.json`），**卸载 = 删掉那个目录**；
> 通知没到先看「设置 → 通知」详情卡里的**最近投递**，它会写清是 HTTP 状态码、平台业务码还是平台 `errmsg`。

## 一、状态与回滚

| 路径（`$DSH_HOME/state/dsh-notice-webhook/`） | 内容 |
|---|---|
| `targets.json` | 目标清单 `{version:1, targets:[…]}` |
| `bindings.json` | 会话绑定 `{version:1, bindings:{…}, targetBindings:{…}}` |

```
卸载/回滚
  ├─ 停用插件 → 目录原样留着（不丢配置）
  ├─ 删掉 dsh-notice-webhook/ → 完全回滚（不碰任何会话数据）
  └─ 回滚到旧版本 → bindings.json 的 version 仍是 1，
                     旧版本忽略 targetBindings 这个新键，不报错、不丢数据
```

**容错口径**（三份状态一致）：文件不存在 → 空表且不建文件；非法 JSON / 未知版本 → 空表且**不覆盖原文件**；单条记录非法 → 只跳过该条。

## 二、通知没到：按这个顺序查

| 步骤 | 看什么 | 结论 |
|---|---|---|
| 1 | 详情卡「最近投递」 | 有失败条目 → 看 `status` 与 `reason`（网络/超时/HTTP 码/平台业务码） |
| 2 | Host 日志里有没有 `job-running` | 有 → **不是漏发**：这一轮把活交给了还没跑完的后台 job，完成通知被压住，等 job 结算后会自动补发一条 |
| 3 | 目标是否启用 | 停用的目标不参与（绑定里会显示"已停用"） |
| 4 | 该目标是否勾了「关心事件」 | 留空 = 全收；勾了之后只收勾中的（`goal/*` 覆盖 goal 终态） |
| 5 | 总开关 | 关掉只影响**默认组**；已绑定会话照发 |
| 6 | 类型开关 | `notifyComplete` 等关掉后**命中绑定也不豁免** |
| 7 | 会话是否绑定 | 「会话绑定」页看它绑了谁；目标被删会标红并回落默认组 |
| 8 | 同渠道同地址去重 | 配了两条一样的，只发一次（不是漏发） |

Host 日志里的 `drop` 原因码：

| 原因码 | 含义 |
|---|---|
| `type-disabled` | 该类通知被内容级开关关掉（含 `notifyInterrupt: false` 关掉中断通知） |
| `no-endpoint` | 该会话既无绑定、也没有默认目标 |
| `master-switch-off` | 走默认组但总开关关着（绑定不受影响） |
| `no-targets` | 目标解析出来是空集（含逐目标事件过滤后为空） |
| `cooldown` | 命中同一会话的冷却窗口 |
| `job-running` | 本会话仍有**本轮拉起、尚未结算的后台 job**：完成通知被压住，等 job 结算后自动补发（开关 `jobAwareComplete: false` 可关掉整个完成闸门） |
| `subagent-running` | 本会话仍有**在跑的 subagent 后代**（`subagent` / `subagent_fork` 的 continuable 形态**不注册 job**，所以由这一路看见）：完成通知被压住，等子代理结束且会话真的空闲后自动补发（同一个开关管） |
| `work-running` | 上面两种**同时**存在（后台 job 与子代理都有活）：两路都清空才补发 |
| `turn-aborted` | 该轮是**用户自己按 Esc** 停的（`turn/end` 的 `aborted`）——按设计不打扰，且与开关无关 |
| `turn-skipped` | `turn/end` 的终态命中**静默名单** `skipReasons`（默认只有 `aborted`；你把 `error` 写进去后，中断也会记这个码） |
| `turn-not-notifiable` | `turn/end` 的终态属于「既不推送、也不谎报完成」：`blocked` / `max-tokens` / `forked` |

> 三个 `turn-*` 码是**规则静默**的证据（不是投递失败）。看到它们说明插件按设计没发，
> 而不是网络/接收端出了问题——后者要看「最近投递」里的失败原因。

还有一种**不是 `drop` 的安静**：完成通知被判为「注入轮」（本轮只有系统注入的 `user/message`——
goal 自动轮 / 看板 Dive 自动续跑 / 插件通知），决策结果是 `silent`，
**连目标解析都不会发生**，所以日志里看不到上面的原因码。判定口径：`user/message` 的
`source` 缺失、或 `source.kind` 缺失 / 为 `'user'` 才算「人在说话」，其余一律注入。
要确认"为什么没收到"，看这一轮有没有**人**发消息：没有 → 按设计不发；有 → 应该照常发。
（注意：注入轮里 agent **报错/崩溃**仍然会推「会话异常中断」——静默只挡完成。）

## 三、配置项怎么改

| 类别 | 改哪里 | 是否要重启 |
|---|---|---|
| 总开关 / 超时 / 重试 / 冷却 / 四类通知开关（含 `notifyInterrupt`）/ 完成闸门（`jobAwareComplete`：后台 job + subagent 后代）/ 顶层过滤 / 是否拼标题 | 插件配置（`cordis.patch.yml` 的 `config`） | **不用**（这些字段标了 `volatile`） |
| `webhookUrl` / 文案（含 `interruptMessage`）/ `skipReasons` / `bindings` | 插件配置 | 走 Loader 正常生命周期 |
| 目标清单（名称/地址/加签/事件/启停/默认组） | **设置 → 通知** 页面 | 不用，写完即生效 |
| 会话绑定 | 「会话绑定」页解绑；绑定由宿主插件调服务 | 不用 |

页面右侧的全局参数是**只读展示**（设计里没有配置写入端点），改它请改插件配置。

## 四、加签密钥

- 目标里填的是**环境变量名**（`secretRef`，如 `DINGTALK_SECRET`），密钥值只在 Host 侧读取；
- 页面与 RPC 只回"是否已配置"，**明文不出进程**、不进日志；
- 钉钉把 `timestamp`+`sign` 拼进 URL query；飞书放进请求体（两家的签名串口径不同，改代码前先看 `src/channels/*.js` 的注释）。

## 五、排障常用的几条命令

```sh
# 看状态目录（卸载前确认只有这两份文件）
ls -la "${DSH_HOME:-$HOME/.dsh}/state/dsh-notice-webhook/"

# 目标清单内容抽查
python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.dsh/state/dsh-notice-webhook/targets.json')))['targets'])"

# 本地接收端（企微/钉钉渠道要回业务码）
python3 -m http.server 8899   # 只收不校验时够用；要校验业务码用 README 里的脚本
```

## 六、相关页面

- [架构与关键决策](../architecture/notification-plugin.md)
- [接入指南（其他插件）](integration.md)
- [项目文档首页](../architecture/index.md)

## 排障：为什么这条通知没发 / 长这样

| 现象 | 先看哪 |
|---|---|
| 某个会话结束没通知 | ① 是不是**子代理/fork**（默认只提示顶层）；② 是不是 **goal 自动轮**（只在目标终态提示）；③ 是不是被**手动中断**（`interrupted/aborted` 静默）；④ 总开关是否只影响默认组；⑤ 日志里有没有 `job-running` / `subagent-running` / `work-running`（有 = 还有活，正在等结算） |
| 子代理还在跑却收到「会话已完成」 | 2026-10-05 的完成闸门修复之前会发生（continuable 子代理不注册 job，旧版看不见）；确认插件已更新，且 `jobAwareComplete` 没被关成 `false` |
| 插件弹框（如 pmboard 确认框）没通知 | 提问走 `ctx` 的 `user-questions/request` waterfall；插件在根 ctx 旁听并 `next()` 放行。若仍无通知，确认 Host 已重启（订阅在 Host 半） |
| 卡片上没有「任务」 | 摘要来自本轮最后一条**人工** `user/message`；纯自动轮没有人工输入时会整行省略 |
| 卡片没有「打开 DSH」按钮 | 飞书卡片按钮不跟随自定义 scheme——把 `payload.linkUrl` 换成 https 中转页才会出现 |
| 改了文案没生效 | 文案在**目标记录**里（不是全局）；改的是这个目标的文案吗？Host 半改动需**重启**才生效 |
