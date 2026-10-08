# 待立项：看板打开需求文档报「文件不存在」（dsh-pmboard 文档根取错）

> 状态：**已诊断、未修**（2026-09-30 会话中实测）。等本窗口腾出（无绑定需求）后按 bug 立项修复。
> 现象：Desktop 版看板点开任意需求文档 → 「文件不存在，可能已被移动或删除」。

## 根因

`dsh-pmboard` 的 `/state` 返回的"文档绝对化根"是**进程级全局**，而不是**每个需求自己的根**：

```ts
// src/http/routers/stages.ts:64（handleState）
workspaceRoot: deps.cwd ?? process.cwd(),
```

- 每个需求真正的根在**台账字段**里：`~/.dsh/dsh-reqboard.json` 的 `requirements[].workspaceRoot`（本项目两个需求都写对了）。
- 但 `/state` 只给**一个**全局根，客户端（`board-mount.ts:289 → setDocWorkspaceContext`）用它绝对化**所有**需求的文档路径。

## 实测证据

| 项 | 值 |
|---|---|
| Desktop Host 进程（pid 4788）的 cwd | `/Users/mac/.dsh/profiles/desktop` |
| 实际文档位置 | `/Users/mac/Documents/ai/dsh/dsh-notice-webhook/docs/requirements/<REQ>/…` |
| 拼接结果 | `~/.dsh/profiles/desktop/docs/requirements/<REQ>/…` → 不存在 |
| 台账里 REQ-260930155231-0862 的 `workspaceRoot` | `/Users/mac/Documents/ai/dsh/dsh-notice-webhook`（**正确**） |

## 两种触发路径（同一症状）

1. **未被任何 reqboard 工具调用同步过** → `deps.cwd` 为空 → 回落 `process.cwd()` = profile 目录；
2. **上一次工具调用属于别的需求**（如仍在验收的 REQ-260930094139-2d65，其工作区是 `dsh-pmboard`）→ 全局根被改写成那个工作区，此时看板上**任何**需求的文档都打不开。

## 正确修法（小改动）

1. `/state` 的**每个需求项**带上自己台账里的 `workspaceRoot`；
2. 客户端按**当前查看的需求**取根绝对化；全局字段仅作旧客户端兼容兜底。

## 临时绕法

先对要看的那份需求跑一次任意 reqboard 工具调用（把全局根同步成它的工作区），刷新看板页后**立刻**打开文档 —— 客户端只在 `fetchState` 时取一次根。

## 相关位置

- `dsh-pmboard/src/http/routers/stages.ts:64`（返回全局根）
- `dsh-pmboard/src/client/board-mount.ts:289`（客户端缓存并使用它）
- `dsh-pmboard/src/client/open-doc.ts`（`absolutizeDocPath`；无缓存根时**原样返回相对路径**，等价于必然打不开）
- `dsh-pmboard/src/client/open-doc.ts` 的"不保留弹窗降级"设计：失败只打 console 诊断，界面无提示 —— 这也是"现象不可定位"的原因，建议一并改善（失败要可见）。
