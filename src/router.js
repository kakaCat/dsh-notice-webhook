/**
 * 路由层：一条意图该不该发、发到**哪些目标**。
 *
 * v1（REQ-250a）：会话 → 一条地址（绑定优先于默认）。
 * v2（REQ-260930155231-0862）：会话 → **目标集合**，叠加四道判定，顺序固定、越界即改语义：
 *
 *   1. 类型开关（内容级）：notifyComplete/Approval/Question 关闭 → 整体丢弃（命中绑定也不豁免）
 *   2. 目标解析：窗口绑定非空 → **只取这些**（enabled 过滤；为空/不存在 → 默认组）；否则默认组
 *      ——**绑定即替代默认组，不叠加**，否则同一条通知会发两遍到同一个群
 *   3. 总开关（通道级）：只管默认组；已绑定窗口不受影响（FR-6 旁路语义）
 *   4. 逐目标过滤：events 为空 = 全收；按 channel+url 去重（防同一条发两遍）
 *
 * 冷却（cooldownMs）在最后判，且**必须在确定真的会推送之后**才计时——
 * 放在更前面会让"被丢掉的意图"白吃掉冷却窗口。
 *
 * 契约见 docs/requirements/REQ-260930155231-0862/design/architecture.md「关键流程」。
 */
import { INTENT_APPROVAL, INTENT_COMPLETE, INTENT_INTERRUPT, INTENT_QUESTION } from './classify.js'

/** 丢弃原因（排查"为什么没收到"用；会进 debug 日志）。 */
export const DROP_TYPE_DISABLED = 'type-disabled'
export const DROP_NO_ENDPOINT = 'no-endpoint'
export const DROP_MASTER_SWITCH_OFF = 'master-switch-off'
export const DROP_COOLDOWN = 'cooldown'
export const DROP_NO_TARGETS = 'no-targets'

/** 列表内匹配：精确命中，或 `goal/*` 覆盖 goal 的全部终态。 */
function listedEventMatches(events, event) {
  if (!Array.isArray(events)) return false
  if (events.includes(event)) return true
  if (event.startsWith('goal/') && events.includes('goal/*')) return true
  return false
}

/**
 * 该事件在该目标上要不要发（目标级过滤）。
 *
 * 三种形态，靠 `eventsMode` 区分（见 docs/requirements/REQ-261001203114-19b6/design/data-model.md §2）：
 * - `'explicit'`：**严格白名单**——列表为空 = 这个目标什么都不收（用户全部取消勾选的合法意图）；
 * - `'all'`：全收（含未来新增事件）；
 * - 缺省：**逐字保持旧口径**（空 = 全收，非空 = 白名单）。
 *
 * 三种形态共用同一条列表匹配规则（含 `goal/*` 通配）——分开写必然漂移。
 */
export function targetAccepts(target, event) {
  if (target?.eventsMode === 'explicit') return listedEventMatches(target.events, event)
  if (target?.eventsMode === 'all') return true
  if (!Array.isArray(target?.events) || target.events.length === 0) return true
  return listedEventMatches(target.events, event)
}

/** 去重键：同渠道 + 同地址只发一次。 */
export function dedupKey(target) {
  return `${target.channel}::${target.url}`
}

export class Router {
  #cooldown = new WeakMap()
  #config

  constructor(config) {
    this.#config = config
  }

  /** 该意图是否被类型开关整体屏蔽（内容级，绑定不豁免）。 */
  isTypeDisabled(intent) {
    return (
      (intent.kind === INTENT_COMPLETE && this.#config.notifyComplete === false) ||
      (intent.kind === INTENT_INTERRUPT && this.#config.notifyInterrupt === false) ||
      (intent.kind === INTENT_APPROVAL && this.#config.notifyApproval === false) ||
      (intent.kind === INTENT_QUESTION && this.#config.notifyQuestion === false)
    )
  }

  /**
   * 解析某会话的目标集合（第 2、3 关）。
   *
   * @param sessionId - 会话窗口标识
   * @param stores.bindings - BindingStore
   * @param stores.targets - TargetStore
   * @returns `{ targets, source }`；`source` 为 'binding' 或 'default'
   */
  resolveGroup(sessionId, { bindings, targets }) {
    const boundIds = bindings.targetIdsOf(sessionId)
    if (boundIds.length > 0) {
      const resolved = boundIds.map(id => targets.get(id)).filter(t => t !== undefined && t.enabled === true)
      if (resolved.length > 0) return { targets: resolved, source: 'binding' }
      // 绑定的目标全部失效（被删/停用）→ 视为未绑定 → 回落默认组（不报错）
    }
    const defaults = targets.list().filter(t => t.isDefault === true && t.enabled === true)
    return { targets: defaults, source: 'default' }
  }

  /**
   * 决定该意图要投递到哪些目标（第 1~4 关；冷却不在此算，见 dispatch 前的 commit）。
   *
   * @param session - 会话对象（取 header.id）
   * @param intent - 分类器 / goal 层产出的意图
   * @param stores - `{ bindings, targets }`
   * @returns `{ targets: TargetRecord[], source? }` 或 `{ targets: [], reason }`
   */
  resolveTargets(session, intent, stores) {
    if (intent === null || typeof intent !== 'object') return { targets: [], reason: DROP_NO_ENDPOINT }

    if (this.isTypeDisabled(intent)) return { targets: [], reason: DROP_TYPE_DISABLED }

    const sessionId = session?.header?.id
    const group = this.resolveGroup(sessionId, stores)

    if (group.source === 'default' && this.#config.enabled === false) {
      return { targets: [], reason: DROP_MASTER_SWITCH_OFF }
    }

    const accepted = group.targets.filter(target => targetAccepts(target, intent.event))

    const seen = new Set()
    const deduped = []
    for (const target of accepted) {
      const key = dedupKey(target)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(target)
    }

    if (deduped.length === 0) return { targets: [], reason: DROP_NO_TARGETS, source: group.source }
    return { targets: deduped, source: group.source }
  }

  /**
   * 冷却判定（第 5 关）：确定会投递才计时。
   * @returns true = 放行（且已计时）；false = 在冷却窗口内，应丢弃
   */
  commitCooldown(session, now = Date.now()) {
    if (this.#config.cooldownMs <= 0) return true
    const last = this.#cooldown.get(session)
    if (typeof last === 'number' && now - last < this.#config.cooldownMs) return false
    this.#cooldown.set(session, now)
    return true
  }

  /* ── v1 兼容：单地址路由（旧 index.js 调用，行为不变，REQ-250a） ── */

  /**
   * @deprecated v1 单地址路由，为旧调用点保留；新代码用 resolveTargets。
   */
  route(session, intent, store, now = Date.now()) {
    if (intent === null || typeof intent !== 'object') return { endpoint: null, reason: DROP_NO_ENDPOINT }

    const disabled =
      (intent.kind === INTENT_COMPLETE && this.#config.notifyComplete === false) ||
      // 中断开关在废弃的 v1 通路上也必须生效，否则同一份配置两条路行为不一致
      (intent.kind === INTENT_INTERRUPT && this.#config.notifyInterrupt === false) ||
      (intent.kind === INTENT_APPROVAL && this.#config.notifyApproval === false) ||
      (intent.kind === INTENT_QUESTION && this.#config.notifyQuestion === false)
    if (disabled) return { endpoint: null, reason: DROP_TYPE_DISABLED }

    const sessionId = session?.header?.id
    const target = store.resolve(sessionId, this.#config.webhookUrl)
    if (target === null) return { endpoint: null, reason: DROP_NO_ENDPOINT }

    if (target.source === 'default' && this.#config.enabled === false) {
      return { endpoint: null, reason: DROP_MASTER_SWITCH_OFF }
    }

    if (this.#config.cooldownMs > 0) {
      const last = this.#cooldown.get(session)
      if (typeof last === 'number' && now - last < this.#config.cooldownMs) {
        return { endpoint: null, reason: DROP_COOLDOWN }
      }
      this.#cooldown.set(session, now)
    }

    return { endpoint: target.url, source: target.source }
  }
}
