/**
 * 事件分类：把 DSH 的会话事件翻译成"要不要叫一声、叫的时候说什么"。
 *
 * 本模块**不含**路由与类型开关判定——那属于 src/router.js。这里的职责只有三件：
 * 1. 缓存会话标题（完成类正文要拼「标题 · 会话已完成」）；
 * 2. 只对顶层会话产生意图（子代理 / fork 完成不该吵醒使用者）；
 * 3. 把四类目标事件翻译成意图，其余事件返回 null。
 *
 * `turn/end` 不靠"命中名单就静默，否则当完成"这种二值判定——**终态决定一切**：
 * 只有 `completed` 是完成，`error` / `interrupted` / 未知终态是**中断**（要叫人），
 * 其余既不推送也**绝不谎报完成**。决策表见 `decideTurnEnd()`。
 *
 * 契约见 docs/requirements/REQ-261001203114-19b6/design/architecture.md「终态分类表」。
 */

/** 意图类型（供路由层做类型开关判定）。 */
export const INTENT_COMPLETE = 'complete'
export const INTENT_APPROVAL = 'approval'
export const INTENT_QUESTION = 'question'
export const INTENT_INTERRUPT = 'interrupt'

/** 出站 event 取值（对接收端的契约，改动需同步 interfaces.md 与 version）。 */
export const EVENT_TURN_END = 'turn/end'
export const EVENT_TURN_ERROR = 'turn/error'
export const EVENT_APPROVAL = 'approval/asked'
export const EVENT_QUESTION = 'ask_user_question'

/**
 * DSH 已知的 turn 终态快照（`TurnEndReasonMap`，packages/core/session/src/types.ts）。
 * 这张表**可被插件合并扩展**，所以「不在此集合」的终态必须按「未知」上报，而不是按「完成」。
 */
export const KNOWN_TURN_KINDS = Object.freeze([
  'completed',
  'aborted',
  'blocked',
  'error',
  'max-tokens',
  'interrupted',
  'forked',
])

/** 静默（不推送）的原因码，供 debug 日志与决策结果排查「为什么没收到」。 */
export const SILENT_SKIPPED = 'turn-skipped'
export const SILENT_ABORTED = 'turn-aborted'
export const SILENT_NOT_NOTIFIABLE = 'turn-not-notifiable'

/** `kind` 缺失/非法时的占位（走「未知终态 → 中断」，绝不谎报完成）。 */
const UNKNOWN_KIND = 'unknown'
/** `kind` 进正文/字段前的长度上限。 */
const KIND_MAX = 40
/** 错误详情进报文前的长度上限（单行化后）。 */
const ERROR_MESSAGE_MAX = 200
/** 错误码缺失时的占位。 */
const UNKNOWN_CODE = 'UNKNOWN'

/**
 * 归一化终态名：非字符串 / 空串 → `'unknown'`；超长截断。
 * @param reason - `turn/end` 的 `data.reason`
 */
export function turnKindOf(reason) {
  const kind = reason?.kind
  if (typeof kind !== 'string' || kind.length === 0) return UNKNOWN_KIND
  return kind.length > KIND_MAX ? kind.slice(0, KIND_MAX) : kind
}

/**
 * 抽取错误事实（**只读事实，不改语义**）：`code` 缺省 `UNKNOWN`，`message` 单行化 + 限长。
 * @param reason - `turn/end` 的 `data.reason`
 * @returns `{ code, message }`；非 `error` 终态返回 null
 */
export function errorFacts(reason) {
  if (reason?.kind !== 'error') return null
  const raw = reason?.error
  const code = typeof raw?.code === 'string' && raw.code.length > 0 ? raw.code : UNKNOWN_CODE
  const text = typeof raw?.message === 'string' ? raw.message : ''
  return { code, message: text.replace(/\s+/g, ' ').trim().slice(0, ERROR_MESSAGE_MAX) }
}

/**
 * `turn/end` 终态决策表——**唯一真相**（顺序即语义，改顺序就是改行为）：
 *
 *   1. `aborted`（用户自己按的 Esc）                       → skip / turn-aborted
 *   2. `kind ∈ skipReasons`（静默名单，用户可自加）        → skip / turn-skipped
 *   3. `completed`                                        → complete
 *   4. `error`                                            → interrupt（带错误事实）
 *   5. `interrupted`（崩溃孤儿 turn）                      → interrupt
 *   6. 未知 kind（DSH 未来新增）                           → interrupt（宁可提示未知，不谎报完成）
 *   7. 其余（blocked / max-tokens / forked）               → skip / turn-not-notifiable
 *
 * 第 1 条必须在第 2 条之前：默认静默名单里就含 `aborted`，若排在后面，`turn-aborted` 永远不可达。
 *
 * @param reason - `turn/end` 的 `data.reason`
 * @param skipReasons - 静默名单（非数组按空处理）
 * @returns `{ decision: 'complete' | 'interrupt' | 'skip', kind, error?, silentReason? }`
 */
export function decideTurnEnd(reason, skipReasons = []) {
  const kind = turnKindOf(reason)
  const list = Array.isArray(skipReasons) ? skipReasons : []
  // aborted 排在最前：它是「用户自己按的 Esc」，永远静默，且**码要说清是它**
  // （若排在 skipReasons 之后，默认名单里就有 aborted，turn-aborted 将永远不可达）。
  if (kind === 'aborted') return { decision: 'skip', kind, silentReason: SILENT_ABORTED }
  if (list.includes(kind)) return { decision: 'skip', kind, silentReason: SILENT_SKIPPED }
  if (kind === 'completed') return { decision: 'complete', kind }
  if (kind === 'error') return { decision: 'interrupt', kind, error: errorFacts(reason) }
  if (kind === 'interrupted') return { decision: 'interrupt', kind, error: null }
  if (!KNOWN_TURN_KINDS.includes(kind)) return { decision: 'interrupt', kind, error: null }
  return { decision: 'skip', kind, silentReason: SILENT_NOT_NOTIFIABLE }
}

/**
 * 静默留痕：静默时给出原因码与 kind，非静默返回 null（供 index.js 记日志与决策结果）。
 * @param reason - `turn/end` 的 `data.reason`
 * @param skipReasons - 静默名单
 */
export function silentReasonOf(reason, skipReasons = []) {
  const verdict = decideTurnEnd(reason, skipReasons)
  if (verdict.decision !== 'skip') return null
  return { reason: verdict.silentReason, kind: verdict.kind }
}

/**
 * 是否是"非顶层"会话：子代理、fork 出来的子会话、有委派深度的会话。
 * 顶层判定不靠模型自述，只读 header 上的结构化字段（session.header）。
 */
export function isNestedSession(session) {
  const header = session?.header
  if (header === undefined || header === null) return false
  if (header.parentSession !== undefined && header.parentSession !== null) return true
  if (header.origin === 'subagent') return true
  if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true
  return false
}

/** 中断正文的原因后缀：`error` 用错误码，`interrupted` 不带后缀，未知终态用 kind 原文。 */
function interruptSuffix(verdict) {
  if (verdict.kind === 'interrupted') return ''
  const label = verdict.kind === 'error' ? (verdict.error?.code ?? UNKNOWN_CODE) : verdict.kind
  return `（${label}）`
}

export class Classifier {
  #titles = new WeakMap()
  #config

  constructor(config) {
    this.#config = config
  }

  /** 该会话已知的标题（没收到过 session/title 时为 undefined）。 */
  titleOf(session) {
    return this.#titles.get(session)
  }

  /** 中断正文骨架（配置缺省 / 非法时回落默认文案，绝不产出空正文）。 */
  #interruptText() {
    const text = this.#config?.interruptMessage
    return typeof text === 'string' && text.length > 0 ? text : '会话异常中断'
  }

  /**
   * 分类一条会话事件。
   *
   * @param session - 会话对象（读 header 判定层级）
   * @param event - `{ type, data }`
   * @returns 意图 `{ kind, event, message, toolName }`（中断意图另带 `reason` / `error`）；不该推送时返回 null
   */
  classify(session, event) {
    const type = event?.type
    if (typeof type !== 'string') return null

    // 标题事件只更新缓存，本身不产生通知
    if (type === 'session/title') {
      const title = event.data?.title
      if (typeof title === 'string' && title.length > 0) this.#titles.set(session, title)
      return null
    }

    if (this.#config.onlyTopLevel && isNestedSession(session)) return null

    const title = this.#titles.get(session)
    const withTitle = text => (this.#config.includeTitle && typeof title === 'string' && title.length > 0 ? `${title} · ${text}` : text)

    if (type === 'turn/end') {
      const verdict = decideTurnEnd(event.data?.reason, this.#config.skipReasons)
      if (verdict.decision === 'complete') {
        return { kind: INTENT_COMPLETE, event: EVENT_TURN_END, message: withTitle(this.#config.completeMessage), toolName: null }
      }
      // 中断：只有这里产出「会话异常中断」——error / interrupted / 未知终态。
      // 这里**绝不能**回落到「完成」：把报错说成跑完，比不推更糟（本需求修的就是它）。
      if (verdict.decision === 'interrupt') {
        return {
          kind: INTENT_INTERRUPT,
          event: EVENT_TURN_ERROR,
          message: withTitle(`${this.#interruptText()}${interruptSuffix(verdict)}`),
          toolName: null,
          reason: verdict.kind,
          error: verdict.error ?? null,
        }
      }
      // skip：静默名单命中 / 用户自己停的（aborted）/ 不叫也不谎报的终态（blocked、max-tokens、forked）
      return null
    }

    if (type === 'approval/asked') {
      const toolName = typeof event.data?.toolName === 'string' && event.data.toolName.length > 0 ? event.data.toolName : null
      const message = toolName === null ? this.#config.approvalMessage : `${this.#config.approvalMessage}（${toolName}）`
      return { kind: INTENT_APPROVAL, event: EVENT_APPROVAL, message, toolName }
    }

    // 「问用户」的统一入口是 ctx.userQuestions 服务，事件名 user-questions/request——
    // 内建工具、权限流、本地应答器、以及**二次开发的弹框**都从这里过。
    // 之前只匹配 tool/call + 工具名 ask_user_question，导致插件自己的弹框完全不被识别（用户反馈）。
    if (type === 'user-questions/request') {
      const first = Array.isArray(event.data?.questions) ? event.data.questions[0] : undefined
      const header = typeof first?.header === 'string' && first.header.length > 0 ? first.header : null
      const message = header === null ? this.#config.questionMessage : `${this.#config.questionMessage}（${header}）`
      return { kind: INTENT_QUESTION, event: EVENT_QUESTION, message, toolName: null }
    }

    return null
  }
}
