/**
 * goal 感知层 + 轮次来源判定：让"系统自己唤醒的轮次"安静下来，只在目标真的跑到终态时叫人。
 *
 * 为什么需要（FR-11 / REQ-261002150038-344a）：看板 / dive 模式靠 goal 与 dive 注入让 Agent 连续自动跑几十轮，
 * 每轮都发通知等于噪音；而目标卡住或跑完恰恰是最该叫人的时刻。
 *
 * 判定不靠模型自述，只读结构化标记，且**口径只有一处**（`src/source.js` 的 `isHumanSource`）：
 * - 注入轮 = 本 turn 出现过非 direct human 的 user message（`source.kind` 为 `goal` / `dive` / `plugin` / 未来新增）；
 * - 人工轮 = 该 turn 内出现过任何 direct human 的 user message（`source` 缺失或 `kind === 'user'`，例如 /steer 插话）。
 *   人在旁边插话了，这一轮就该正常通知，否则会"人在却不响"。
 *
 * 2026-10-02 修正（REQ-261002150038-344a）：以前只认 `source.kind === 'goal'`，
 * 于是 pmboard 的 Dive 自动续跑（`'dive'`）与节点通知（`'plugin'`）被当成人工轮，
 * 每轮推一条「对话完成」——这就是本需求修的那个噪音。现在「非 direct human 即注入」，默认安静。
 *
 * 注意（与计划的一处收敛）：冷却（cooldownMs）不在这里判——它必须在"确定真的会推送之后"
 * 才计时，否则被路由丢掉的意图会白白吃掉冷却窗口。冷却归 src/router.js。
 *
 * 契约见 docs/requirements/REQ-260930123701-250a/design/architecture.md「goal 自动轮判定」。
 */

import { isHumanSource } from './source.js'

/** 出站 event 取值（对接收端的契约）。 */
export const EVENT_GOAL_COMPLETE = 'goal/complete'
export const EVENT_GOAL_BLOCKED = 'goal/blocked'

/** 轮次耗尽时 driver 置的固定 code（见 dsh-goal-round-driver 源码）。 */
export const REASON_ROUND_LIMIT = 'round-limit'

/**
 * 从 `goal/change` 事件里取目标快照。
 * 载荷可能是 `{ goal: {...} }` 或快照本身，两种都认（上游形态演进的兼容）。
 */
export function readGoalSnapshot(event) {
  const raw = event?.data?.goal ?? event?.data
  if (raw === null || typeof raw !== 'object') return null
  const id = raw.id
  const phase = raw.phase
  if (typeof id !== 'string' || typeof phase !== 'string') return null
  const maxGoalRounds = Number.isInteger(raw.maxGoalRounds) ? raw.maxGoalRounds : undefined
  const revision = Number.isInteger(raw.revision) ? raw.revision : 0
  const blockedCode = typeof raw.blockedReason?.code === 'string' ? raw.blockedReason.code : undefined
  return { id, phase, revision, maxGoalRounds, blockedCode }
}

export class GoalTracker {
  #rounds = new WeakMap()
  #goals = new WeakMap()
  #notified = new Set()
  #config
  #resolveTitle

  /**
   * @param config - 规整后的配置
   * @param resolveTitle - 读会话标题的回调（标题缓存在 Classifier 里，只存一份）
   */
  constructor(config, resolveTitle = () => undefined) {
    this.#config = config
    this.#resolveTitle = resolveTitle
  }

  /** 本轮是否"全自动"（有注入消息、且没有人工插话；一条 user/message 都没有的轮次不算）。 */
  isAutoRound(session) {
    const round = this.#rounds.get(session)
    if (round === undefined) return false
    return round.sawInjected === true && round.sawHuman !== true
  }

  /** 清空本轮的输入标记（turn/end 分类完成后调用）。 */
  endRound(session) {
    this.#rounds.delete(session)
  }

  /** 当前记录的 goal 快照（排查用）。 */
  snapshotOf(session) {
    return this.#goals.get(session)
  }

  /**
   * 观察一条会话事件。
   *
   * @returns 终态意图 `{ event, message, goal: { id, phase, round } }`；
   *          非终态（含自动轮标记、暂停、清除）返回 null
   */
  observe(session, event) {
    const type = event?.type

    if (type === 'user/message') {
      const round = this.#rounds.get(session) ?? { sawInjected: false, sawHuman: false }
      // 口径单点在 src/source.js：只有 direct human 才算「人在说话」，其余（goal / dive / plugin / …）都是注入
      if (isHumanSource(event.data?.source)) round.sawHuman = true
      else round.sawInjected = true
      this.#rounds.set(session, round)
      return null
    }

    if (type !== 'goal/change') return null

    const snapshot = readGoalSnapshot(event)
    if (snapshot === null) return null
    this.#goals.set(session, snapshot)

    // paused / active / 清除都不打扰使用者（那是人的主动操作）
    if (snapshot.phase !== 'complete' && snapshot.phase !== 'blocked') return null

    const key = `${snapshot.id}:${snapshot.revision}:${snapshot.phase}`
    if (this.#notified.has(key)) return null
    this.#notified.add(key)

    const title = this.#resolveTitle(session)
    const prefix = typeof title === 'string' && title.length > 0 && this.#config.includeTitle ? `${title} · ` : ''

    if (snapshot.phase === 'complete') {
      return {
        event: EVENT_GOAL_COMPLETE,
        message: `${prefix}${this.#config.goalCompleteMessage}`,
        goal: { id: snapshot.id, phase: snapshot.phase, round: null },
      }
    }

    if (snapshot.blockedCode === REASON_ROUND_LIMIT && Number.isInteger(snapshot.maxGoalRounds)) {
      const limit = snapshot.maxGoalRounds
      return {
        event: EVENT_GOAL_BLOCKED,
        message: `${prefix}目标轮次耗尽（${limit}/${limit}）`,
        goal: { id: snapshot.id, phase: snapshot.phase, round: limit },
      }
    }

    const suffix = snapshot.blockedCode === undefined ? '' : `（${snapshot.blockedCode}）`
    return {
      event: EVENT_GOAL_BLOCKED,
      message: `${prefix}${this.#config.goalBlockedMessage}${suffix}`,
      goal: { id: snapshot.id, phase: snapshot.phase, round: null },
    }
  }
}
