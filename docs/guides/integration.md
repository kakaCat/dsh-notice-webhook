---
title: 接入指南（其他插件）
slug: integration
requirement_refs: [REQ-260930155231-0862]
updated: 2026-09-30
---

# 接入指南：其他插件怎么接本插件

> **TL;DR**：宿主插件想让自己管的会话窗口"提醒到某个 webhook"，只需两件事——
> **Host 半**注入 `dshNoticeWebhook` 调 `bindTargets/unbindTargets`；
> **客户端半**取 `dshNoticeWebhookClient` 用 `renderTargetPicker` 画一个可嵌入选择器（弹框归你）。
> 两条都要判**服务缺失**并降级，别硬依赖。

## 一、Host 半：服务 `dshNoticeWebhook`

```typescript
export const inject = ['dshNoticeWebhook']

export function apply(ctx) {
  const svc = ctx.dshNoticeWebhook
  if (svc === undefined || svc.version < 1) return   // 未安装 → 静默降级

  // 把某个会话改道到若干目标（**替代**默认组，不叠加）
  svc.bindTargets('session-b7c52392-...', ['wecom-project', 'slack-phone'])

  // 显式解绑 → 该会话回落默认目标组
  svc.unbindTargets('session-b7c52392-...')

  svc.listBindings()      // 谁绑了谁（含展开的目标名/渠道/启停）
  svc.listTargets()       // 目标清单（`secretRef` 只回"是否已配置"，密钥明文不出进程）
  svc.resolveAll('session-...', { event: 'turn/end' })   // 这条意图最终会发到哪些目标
}
```

| 方法 | 版本 | 语义要点 |
|---|---|---|
| `bind(sid, url)` | v1 | 老接口：url 会映射为一条 `custom` 目标并绑定（行为等价，保留可用） |
| `unbind(sid)` | v1 | 同时清旧 url 绑定与多目标绑定 |
| `list()` / `resolve(sid)` | v1 | 只反映旧 url 绑定段 |
| `bindTargets(sid, ids)` | v2 | **任一 id 不存在 → 整笔 `false`**（不做部分绑定） |
| `unbindTargets(sid)` | v2 | 与 `bindTargets(sid, [])` 等价 |
| `listBindings()` / `listTargets()` | v2 | 给宿主做展示/排查 |
| `resolveAll(sid, intent)` | v2 | 复用本插件的路由判定（含事件过滤与去重） |

**两条纪律**：

- 参数非法一律返回 `false`、**不抛异常**——你是同进程的邻居，抛异常会把别人搞挂；
- 消费方若写死校验 `version === 1`，请放宽为 `>= 1`（v2 未删任何 v1 方法）。

## 二、客户端半：可嵌入选择器

```javascript
const picker = ctx.get?.('dshNoticeWebhookClient')
if (picker?.version === 1) {
  const element = picker.renderTargetPicker({
    sessionId: 'session-b7c52392-...',   // 宿主自己知道绑哪个会话
    selected: ['wecom-project'],         // 已选目标 id
    onConfirm: (targetIds) => { /* 调 Host Service bindTargets 落库 */ },
    onCancel: () => closeDialog(),
    // readOnly: true,                  // 只读展示
  })
  // element 是 React 元素；为 null 说明插件已卸载/不可用 → 回落你自己的界面
}
```

| 约定 | 说明 |
|---|---|
| 返回 | 每次调用返回**新元素**；不往你的 DOM 里塞东西，**不自己开弹框**（弹框归你） |
| 失效 | 插件卸载后返回 `null`——**你必须处理这个分支**，不要硬渲染 |
| 空态 | 目标清单为空时组件内显示引导（指向「设置 → 通知」），不是白板 |
| 兜错 | 组件内部读取失败在组件内展示，不把异常抛给你 |

## 三、推荐接线顺序

```
用户在宿主界面点「绑定通知」
        │
        ├─ 取 dshNoticeWebhookClient（没有 → 提示"通知插件未启用"）
        ├─ 开你自己的弹框，把 renderTargetPicker 的返回值放进去
        ├─ 用户勾选 → onConfirm(ids)
        └─ 调 ctx.dshNoticeWebhook.bindTargets(sessionId, ids)
                └─ 返回 false → 提示"目标不存在，请刷新后重试"
```

## 四、相关页面

- [架构与关键决策](../architecture/notification-plugin.md)
- [运维与排障](operations.md)

## 文案（报文内容）怎么配

文案**按目标配**（一个目标 = 一个渠道，各渠道能力不同，所以没有全局页）：

1. 设置 → 通知 → 左栏点一个目标 → 弹框里找「文案」；
2. 默认「用默认文案」（= 插件配置里的 `payload`）；想单独调就选「单独设置这个目标的文案」；
3. 可调：要哪几行（类型/时间/会话/工作区/任务/详情/链接）与顺序、摘要长度、时间格式、
   工作区显示（目录名/全路径）、跳转地址、整段自定义模板（`{event} {session} {id} {workspace} {prompt} {detail} {time} {link}`）。

平台差异（这是不能做全局配置的原因）：

| 渠道 | 收到什么 | 链接按钮 |
|---|---|---|
| 飞书 | 交互式卡片：彩色标题 + 分栏 + `<text_tag>` 会话标签 | **只有 http(s) 才出现**；`dsh://` 会被飞书忽略，故不显示死按钮 |
| 企微 / 钉钉 / Slack / Discord / 通用 | 文本（markdown / 各自结构） | 带 `[打开 DSH](dsh://open)`，桌面浏览器点击有效 |
