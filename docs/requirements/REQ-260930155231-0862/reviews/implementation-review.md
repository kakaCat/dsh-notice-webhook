---
title: REQ-260930155231-0862 实施复核
requirement: REQ-260930155231-0862
---

# 实施复核（REQ-260930155231-0862）

> **TL;DR**：实现与已确认的设计**无偏离**（1 处有意收窄已修订验收标准并落痕）；
> 但真实装载验证暴露了 **2 个设计文档没写到、却会让功能静默失效的缺陷**——
> `Config` 未从入口导出、测试污染用户真实状态目录，均已修复并复验。

## 一、契约核验（按已确认设计逐条）

| 设计条目 | 实现 | 结论 |
|---|---|---|
| 渠道适配器契约（`id` / `buildRequest` / `isSuccess`，纯函数、凭据由调用方解析） | `src/channels/*.js` 七个模块 + `index.js` 注册表 | ✅ 一致 |
| 渠道报文契约（六渠道报文与成功判定） | 企微/钉钉看 `errcode`、飞书看 `code`、Slack/Discord 看 2xx、custom 保持 v1 | ✅ 一致 |
| 插件 Config（schemastery + `.volatile()`） | `src/config.js` 声明，**入口 `index.js` 导出** | ✅ 一致（导出见「缺陷 1」） |
| Host RPC（`GET /state` + 五个写端点 + revision 栅栏） | `src/rpc.js`，挂 `webServer.register({kind:'prefix'})` | ✅ 一致 |
| Host Service v2（新五方法 + 旧四方法不删） | `src/service.js`，`version=2` | ✅ 一致 |
| 客户端服务 v1（`renderTargetPicker`，不自己开弹框） | `client.js` 内联实现 + `ctx.provide` | ✅ 一致 |
| 数据契约（TargetRecord / targets.json / targetBindings / Outcome） | `src/targets.js` / `src/bindings.js` / `src/outcomes.js` | ✅ 一致 |
| 绑定语义：**替代而非叠加** | `Router.resolveGroup`：绑定非空只取绑定目标，失效则回落默认组 | ✅ 一致（TC-19 专测） |
| 前端（rail + 详情卡 + 会话绑定页 + 选择器） | `client.js` 六组件 | ✅ 一致 |

**接口签名抽查**（实调，非阅读）：

```
service.version === 2
bindTargets(sid, ['不存在的id']) === false        // 整笔不生效
unbindTargets(sid) === bindTargets(sid, [])       // 等价
listTargets()  → 不回密钥明文，只回 secretConfigured
renderTargetPicker({...}) → React 元素；卸载后 → null
```

## 二、实现期修正（4 处，全部有痕迹）

| # | 类别 | 内容 | 依据 |
|---|---|---|---|
| 1 | **缺陷修复** | `Config` 未从插件入口导出 → Loader 读不到 schema（功能静默失效） | 官方文档 `references/host-plugin.md:51`：`export const Config` 必须在入口；活体查询复验 `status=schema` |
| 2 | **缺陷修复** | 测试写用户真实状态目录（25 条残留） | t16 隔离 `DSH_HOME` 复验发现；已修两处并清理残留 |
| 3 | **测试健壮性** | 对异步写入的投递结果直接断言 → 全量并发偶发 `4 !== 5` | 连跑复现 2/3；已加等待器并改成超时抛具体错误 |
| 4 | **验收标准修订** | t12 的「页面内改全局开关」改为「只读展示」 | 设计的 RPC 端点清单没有配置写入面（写配置需 `dsh-config-editor`，属设计外）；已 `reqboard_task_move(acceptance=…)` 落痕，**不静默降级** |

> 第 1、2 条值得记一笔：它们**不是**设计漏项，而是"设计对、接线错"与"测试卫生"问题——
> 只有走**真实 profile 解析路径**装载才会暴露，单元测试全绿也照样带着这两个 bug 上线。

## 三、迁移与兼容实测

| 场景 | 实测 | 结论 |
|---|---|---|
| 只配 `webhookUrl` 的老配置 | 映射出 1 条 custom 默认目标；报文仍是 v1 契约 | ✅ 不改造可用 |
| 老 `bindings.json`（sessionId → url） | 映射为目标绑定，窗口照旧收到 | ✅ |
| legacy 与显式清单同 url | 只保留一条，**不发两遍** | ✅ |
| 旧版本读新 `bindings.json` | `version` 未变、旧段仍维护、未知键被忽略不报错 | ✅ 回滚安全 |
| 坏文件（非法 JSON / 未知版本） | 空表启动且**不覆盖原文件**；不影响 legacy 通道 | ✅ |
| 卸载 | 状态目录只留 `targets.json` / `bindings.json`，无 `.tmp`；删目录即完全回滚 | ✅ 无残留 |
| 零配置启动 | 不创建任何文件 | ✅ |

## 四、破坏性改动检查

| 调用方 | 影响 | 结论 |
|---|---|---|
| 旧 Host Service 消费方（校验 `version === 1`） | 版本升到 2 | ⚠️ **需放宽为 `>= 1`**；四方法一个没删、行为不变（`service.test.js` 回归通过）。已在 README 明写 |
| 既有 `bind(sid, url)` 调用 | url 现映射为 custom 目标并写入目标段 | ✅ 行为等价（`e2e.local` 绑定旁路用例通过） |
| 既有 v1 出站契约接收端 | `custom` 渠道报文逐字段不变 | ✅ `channels.global` 与 `e2e.multi` 断言 |
| 计划外调用方 | 无 | ✅ 未改任何计划外接口 |

## 五、结论

- 设计契约逐条落地，**无偏离**；1 处收窄（全局参数只读）已走验收标准修订并留痕；
- 2 个真实缺陷（Config 导出、测试污染）已修复并活体复验；
- 迁移/回滚路径实测通过，**卸载无残留**；
- 唯一对外不兼容点：Host Service 版本 1 → 2（方法未删，消费方需放宽版本判断），已在 README 与设计文档写明。

**待人工裁决项**：真实会话事件触发的端到端投递未做（干净 Host 无目标、未擅自重启）——
如需实测，配置一个目标后在 GUI 里点「发送测试」即可，或在下一轮真实会话结束后观察。
