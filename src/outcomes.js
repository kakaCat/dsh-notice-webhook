/**
 * 投递结果存储：每个目标保留最近若干次投递的结果，供界面与 RPC 查询（FR-10）。
 *
 * 为什么不持久化：需求已限定"结果留在内存、重启清空"。投递结果的价值是**当下排查**
 * （"刚那条为什么没到"），不是历史审计；持久化会引入写放大与清理策略，不划算。
 *
 * 契约见 docs/requirements/REQ-260930155231-0862/design/interfaces.md（Outcome 投影）。
 */

/** 每个目标保留的结果条数上限。 */
export const MAX_OUTCOMES = 5

/**
 * 记录一次投递结果。
 *
 * @param record - `{ at: ISO 字符串, ok: boolean, status?: number, reason?: string }`
 */
export function makeOutcome(record) {
  const outcome = { at: record.at, ok: record.ok === true }
  if (typeof record.status === 'number') outcome.status = record.status
  if (typeof record.reason === 'string' && record.reason.length > 0) outcome.reason = record.reason
  return outcome
}

export class OutcomeStore {
  #byTarget = new Map()
  #limit

  /** @param options.limit - 保留条数（缺省 MAX_OUTCOMES；单测可调小） */
  constructor(options = {}) {
    this.#limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_OUTCOMES
  }

  /**
   * 追加一条结果（最新的排在最前）。
   * @returns 写入的 outcome（调用方可用于日志）
   */
  record(targetId, record) {
    if (typeof targetId !== 'string' || targetId.length === 0) return undefined
    const outcome = makeOutcome({ at: record.at ?? new Date().toISOString(), ...record })
    const list = this.#byTarget.get(targetId) ?? []
    list.unshift(outcome)
    if (list.length > this.#limit) list.length = this.#limit
    this.#byTarget.set(targetId, list)
    return outcome
  }

  /** 某目标的结果（最新在前）；没有则空数组。 */
  list(targetId) {
    return [...(this.#byTarget.get(targetId) ?? [])]
  }

  /** 全部目标的结果快照（`{ [targetId]: Outcome[] }`），供 RPC 一次性返回。 */
  snapshot() {
    return Object.fromEntries([...this.#byTarget.entries()].map(([id, list]) => [id, [...list]]))
  }

  /** 目标被删除时清掉它的历史，避免 RPC 返回孤儿键。 */
  forget(targetId) {
    return this.#byTarget.delete(targetId)
  }
}
