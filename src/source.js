/**
 * 消息来源判定：**这条 `user/message` 是不是人在说话**。
 *
 * 为什么要有这一层（REQ-261002150038-344a）：
 * 看板 Dive 会连续自动跑几十轮，每轮都是 pmboard 注入的 `user/message`（`source.kind: 'dive'`）；
 * goal 自动轮注入的是 `'goal'`，pmboard 的节点通知是 `'plugin'`……这些轮次都不该吵醒使用者。
 * 而判定口径以前只认 `'goal'`、还散在两个模块里（`src/goal.js` / `src/payload.js`），
 * 结果是 Dive 每轮推一条「对话完成」，注入正文还被当成「任务」显示。
 *
 * 口径（与 pmboard 的既成事实一致：`sourceKind !== undefined && sourceKind !== 'user'` → 非 direct human）：
 * - **direct human** = `source` 缺失 / `source.kind` 缺失 / `source.kind === 'user'`；
 * - 其余一律「注入」：`goal` / `dive` / `plugin` / 未来新增 kind —— **默认安静，而不是默认吵闹**；
 * - 形状异常（`source` 非对象 / 数组 / `kind` 非字符串）也判为注入（安静优先）。
 *
 * 注意：判为注入**只**影响「完成意图是否静默」与「任务字段取值」，**不影响中断推送**——
 * 自动轮里 agent 报错停下时仍然要叫人（见 `index.js` 的静默分支只挡 `complete`）。
 *
 * 契约见 docs/requirements/REQ-261002150038-344a/design/interfaces.md §1。
 */

/** 被认作「人」的 `source.kind` 白名单；其余 kind 一律视为注入。 */
export const HUMAN_SOURCE_KINDS = Object.freeze(['user'])

/**
 * 是否 direct human 消息。
 *
 * @param source - `user/message` 事件里的 `data.source`（可能是任何形状）
 * @returns `true` = 人在说话；`false` = 系统/插件注入
 */
export function isHumanSource(source) {
  // 真人消息可能完全不带 source（DSH 直发路径）——缺失即人，否则会把真人的话静默掉
  if (source === undefined || source === null) return true
  // 形状异常：非对象 / 数组 → 注入（安静优先，且不影响中断推送）
  if (typeof source !== 'object' || Array.isArray(source)) return false
  const kind = source.kind
  // 有 source 但没 kind：历史上当人处理，保持不变
  if (kind === undefined || kind === null) return true
  // kind 存在但非字符串（脏数据）→ 注入；字符串则查白名单
  return typeof kind === 'string' && HUMAN_SOURCE_KINDS.includes(kind)
}
