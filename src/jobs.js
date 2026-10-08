/**
 * 完成闸门（REQ-261001202058-0fbe + REQ-261005120639-f801）：把「这一轮结束了」与「会话真的没活了」分开。
 *
 * 两路事实源，缺一不可：
 * - **后台 job**（`ctx.jobs`，REQ-261001202058-0fbe）：本轮拉起、尚未结算的 job；
 * - **subagent 后代**（`ctx.agents`，REQ-261005120639-f801）：本会话仍在跑的 continuable 子代理——
 *   它们走 `subagents.startContinuable()`，**不注册 job**，只看 job 会漏掉（误报「会话已完成」）。
 *
 * 为什么单独成模块：判定要读 DSH 的两处事实源，涉及状态（本轮快照 + pending + 宽限计时器）
 * 与时序（结算事件可能早于/晚于轮次结束）。这些细节不进主链路，主链路只问一句「这条完成通知能不能发」。
 *
 * 三条纪律：
 * 1. **只读**：只用 `list()` / `events.subscribe()` / `ctx.on('subagent/end')`，从不 kill/read/cancel 任何 job 或子代理；
 * 2. **保守**：拿不准（两路都不可用 / 没有轮次起点 / 判定抛错）一律**不抑制**——宁可误报，不可漏报；
 * 3. **零 I/O**：时钟与计时器靠注入，单测可瞬时推进，不碰 `node:` 与全局计时器。
 *
 * 契约见 docs/requirements/REQ-261005120639-f801/design/interfaces.md §1 与 design/data-model.md §2。
 */

/** 结算后的宽限窗口：给 DSH 的结算唤醒（completionDelivery='wakeup'）留出开新轮次的时间。 */
export const DEFAULT_JOB_GRACE_MS = 1500

/** 抑制原因码（进 `handle()` 返回值与日志；**不是**出站报文字段）。 */
export const REASON_JOB_RUNNING = 'job-running'
export const REASON_SUBAGENT_RUNNING = 'subagent-running'
export const REASON_WORK_RUNNING = 'work-running'

/** 参与抑制的 job 状态：terminal（completed/killed/failed）不占着「活还没完」。 */
const LIVE_STATUS = new Set(['running', 'stopping'])

/** 参与抑制的子代理状态：`idle` = 没有驱动在跑（continuable 空闲常驻不算活）。 */
const LIVE_AGENT_STATUS = 'running'

/**
 * 形状校验：满足 `list` + `events.subscribe` 才算可用的 job 服务。
 * 为什么按形状而不是构造器判定：本包零运行期依赖，不 import DSH 内部包，才能在无 job 服务的组合里照常工作。
 */
export function isJobRegistryLike(jobs) {
  if (jobs === null || typeof jobs !== 'object') return false
  if (typeof jobs.list !== 'function') return false
  const events = jobs.events
  if (events === null || typeof events !== 'object') return false
  return typeof events.subscribe === 'function'
}

/**
 * 形状校验：满足 `list()` 才算可用的 agent 注册表（生产 = `ctx.agents`）。
 * 同样按形状而不是构造器判定：本包零运行期依赖、不 import DSH 内部包。
 */
export function isAgentRegistryLike(agents) {
  if (agents === null || typeof agents !== 'object') return false
  return typeof agents.list === 'function'
}

/**
 * 本会话仍在跑的 subagent 后代 id（只读、同步、不抛）。
 *
 * 判定三条（与 DSH 自身的 `runningDescendants` 同口径）：
 * 1. 血统：沿 `session.header.parentSession` 从 `sessionId` 逐层下钻可达（任意深度，`visited` 防环）；
 * 2. 来源：`session.header.origin === 'subagent'`（普通 fork / 派生窗口只共享血统字段、不带 origin）；
 * 3. 活体：`status === 'running'`（`idle` = 没有驱动在跑）。
 *
 * @param agents - 形状 `{ list() }` 的注册表
 * @param sessionId - 顶层会话 id
 * @returns 命中的后代会话 id（去重）；`null` = 注册表不可用 / `list()` 抛错 / 非数组（调用方按"该路降级"处理）
 */
export function liveSubagentIds(agents, sessionId) {
  if (!isAgentRegistryLike(agents)) return null
  if (typeof sessionId !== 'string' || sessionId.length === 0) return []
  let list
  try {
    list = agents.list()
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null

  // 先按 parentSession 分桶（只收「带血统 + 带 subagent origin + id 可用」的条目）
  const childrenOf = new Map()
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const header = entry.session?.header
    if (header === null || typeof header !== 'object') continue
    const parentId = header.parentSession
    if (typeof parentId !== 'string' || parentId.length === 0) continue
    if (header.origin !== 'subagent') continue
    const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : header.id
    if (typeof id !== 'string' || id.length === 0) continue
    const siblings = childrenOf.get(parentId) ?? []
    siblings.push({ id, status: entry.status })
    childrenOf.set(parentId, siblings)
  }

  // 再按血统下钻（visited 同时防环与去重）
  const visited = new Set([sessionId])
  const queue = [sessionId]
  const found = new Set()
  while (queue.length > 0) {
    const parentId = queue.shift()
    for (const child of childrenOf.get(parentId) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      if (child.status === LIVE_AGENT_STATUS) found.add(child.id)
      queue.push(child.id)
    }
  }
  return [...found]
}

/**
 * 建一个判定闸门。
 *
 * @param options.logger - 记日志（warn/debug/info 可选）
 * @param options.graceMs - 结算后的宽限窗口（毫秒），默认 {@link DEFAULT_JOB_GRACE_MS}
 * @param options.clock - `() => number`，默认 `Date.now`
 * @param options.setTimer - `(fn, ms) => handle`，默认 `setTimeout`
 * @param options.clearTimer - `(handle) => void`，默认 `clearTimeout`
 * @param options.deliver - `(session, intent, meta) => void`：补发动作（由接线层接到 dispatch）
 * @param options.subagents - 形状 `{ list() }` 的 agent 注册表（新增事实源；缺省 = 该路降级）
 * @returns 闸门对象；所有方法都不抛异常
 */
export function createJobGate(options = {}) {
  const logger = options.logger
  const graceMs = Number.isInteger(options.graceMs) && options.graceMs >= 0 ? options.graceMs : DEFAULT_JOB_GRACE_MS
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now()
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : (fn, ms) => setTimeout(fn, ms)
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : handle => clearTimeout(handle)
  const deliver = typeof options.deliver === 'function' ? options.deliver : () => {}

  /** 会话轮次起点（FR-2）：判定「哪些 job 是本轮拉起的」。 */
  const turnStarts = new Map()
  /** 本轮 pending（FR-3）：被压下的那条结论 + 还在等结算的 job 集合 + 当时在跑的子代理 id。 */
  const pending = new Map()

  let jobs = null
  let agents = null
  let offEvents = null
  let warnedUnavailable = false
  let warnedSubagentsUnavailable = false
  let warnedSubagentLookup = false
  let disposed = false

  const log = (level, message) => {
    try { logger?.[level]?.(`[dsh-notice-webhook] jobs: ${message}`) } catch { /* 记日志失败绝不影响判定 */ }
  }
  const warn = message => log('warn', message)

  /** 取消并返回该会话的 pending（幂等）。 */
  const cancelPending = sessionId => {
    const record = pending.get(sessionId)
    if (record === undefined) return undefined
    if (record.timer !== undefined) {
      try { clearTimer(record.timer) } catch { /* 计时器已消失不是错误 */ }
    }
    pending.delete(sessionId)
    return record
  }

  /** 本批活已全部结算：起宽限计时器，到点仍无新轮次就补发。 */
  const armGrace = sessionId => {
    const record = pending.get(sessionId)
    if (record === undefined) return
    if (record.timer !== undefined) {
      try { clearTimer(record.timer) } catch { /* 忽略 */ }
    }
    record.timer = setTimer(() => {
      const current = pending.get(sessionId)
      // 到点时 pending 已被新轮次清掉 / 被覆盖 → 什么都不做（新轮次的完成通知会自己发）
      if (current === undefined || current !== record) return
      if (current.watched.size > 0) { record.timer = undefined; return }
      // 宽限窗口内又忙起来了（子代理被唤醒进新 epoch）→ 保留 pending，等下一次结算事件再复检；
      // 这里**不能**先删 pending 再返回：删了就等于把这条完成通知静默丢了。
      if (liveSubagentsOf(sessionId).length > 0) {
        record.timer = undefined
        return
      }
      pending.delete(sessionId)
      try {
        deliver(current.session, current.intent, {
          prompt: current.prompt,
          jobIds: [...current.jobIds],
          subagentIds: [...(current.subagentIds ?? [])],
        })
        log('info', `后台活已全部结算，补发完成通知：会话 ${sessionId}（job ${(current.jobIds ?? []).join(', ') || '—'}；subagent ${(current.subagentIds ?? []).join(', ') || '—'}）`)
      } catch (error) {
        warn(`补发完成通知失败（已隔离）：${String(error?.message ?? error)}`)
      }
    }, graceMs)
  }

  /**
   * 本会话仍在跑的子代理 id（该路不可用时返回空数组，并留一次痕）。
   * 为什么每次现查而不是记 watched：子代理的存活是"拉"出来的事实，漏一个事件也不会让 pending 卡死。
   */
  const liveSubagentsOf = sessionId => {
    if (!isAgentRegistryLike(agents)) return []
    const ids = liveSubagentIds(agents, sessionId)
    if (ids === null) {
      if (!warnedSubagentLookup) {
        warnedSubagentLookup = true
        warn('agent 注册表 list() 不可用：本次不做子代理判定（完成通知照发）')
      }
      return []
    }
    return ids
  }

  /**
   * 复检一条 pending：两路都空 → 起宽限（到点补发）。
   * 已在等宽限时不重置窗口（后续无关的结算事件不得把补发一直往后推）。
   * @returns 是否启动了宽限窗口
   */
  const maybeSettle = sessionId => {
    const record = pending.get(sessionId)
    if (record === undefined) return false
    if (record.timer !== undefined) return false
    if (record.watched.size > 0) return false
    if (liveSubagentsOf(sessionId).length > 0) return false
    armGrace(sessionId)
    return true
  }

  /** job 事件入口：只认终态（settled / removed）。 */
  const observe = event => {
    try {
      const type = event?.type
      if (type !== 'settled' && type !== 'removed') return
      // 注意：output 事件没有 job 字段，必须先判存在再读
      const job = event?.job
      const sessionId = job?.owner
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      const record = pending.get(sessionId)
      if (record === undefined || !record.watched.has(job.id)) return
      record.watched.delete(job.id)
      if (record.watched.size === 0) maybeSettle(sessionId)
    } catch (error) {
      warn(`job 事件处理异常（已隔离）：${String(error?.message ?? error)}`)
    }
  }

  /**
   * 子代理结算事件入口（接线层订阅 `ctx.on('subagent/end')` 后调用）：
   * 对本会话所有 pending 复检一次——只看"该复检了"这个时机，不依赖事件归因。
   * @returns 复检过的 pending 条数（供测试与排障）
   */
  const observeSubagentEnd = () => {
    if (disposed) return 0
    let checked = 0
    for (const sessionId of [...pending.keys()]) {
      checked += 1
      maybeSettle(sessionId)
    }
    return checked
  }

  const detach = () => {
    if (offEvents !== null) {
      try { offEvents() } catch { /* 注销失败不阻断 */ }
      offEvents = null
    }
    jobs = null
  }

  /**
   * 接上 job 服务。**幂等**：重复 attach 先 detach 旧的。
   * 形状不符 → 保持降级态并留一条 warn（只报一次）。
   * @returns detach 函数（形状不符时是空函数）
   */
  const attach = registry => {
    if (!isJobRegistryLike(registry)) {
      if (!warnedUnavailable) {
        warnedUnavailable = true
        warn('job 服务不可用或形状不符（缺 list / events.subscribe）：完成通知不做后台 job 判定，降级为旧行为')
      }
      return () => {}
    }
    detach()
    try {
      offEvents = registry.events.subscribe({ owners: 'all' }, observe)
      jobs = registry
    } catch (error) {
      offEvents = null
      jobs = null
      warn(`订阅 job 事件失败（保持降级态）：${String(error?.message ?? error)}`)
      return () => {}
    }
    return detach
  }

  /**
   * 接上 agent 注册表（新增事实源：本会话在跑的 subagent 后代）。
   * 形状不符 → 保持降级态并留一条 warn（只报一次）；**没有它插件照常工作**（旧的 job 判定仍然生效）。
   * @returns detach 函数（形状不符时是空函数）
   */
  const attachSubagents = registry => {
    if (!isAgentRegistryLike(registry)) {
      if (!warnedSubagentsUnavailable) {
        warnedSubagentsUnavailable = true
        warn('agent 注册表不可用或形状不符（缺 list）：完成通知不做子代理判定，降级为旧行为')
      }
      return () => {}
    }
    agents = registry
    return detachSubagents
  }

  const detachSubagents = () => { agents = null }

  /** 记轮次起点（FR-2），并作废该会话上一条 pending（FR-3：新轮次 = 上一个结论已过期）。 */
  const noteTurnStart = (sessionId, at) => {
    if (disposed) return
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    cancelPending(sessionId)
    turnStarts.set(sessionId, typeof at === 'number' && Number.isFinite(at) ? at : clock())
  }

  /**
   * 判定这条完成意图能不能发（FR-1 / FR-2 / FR-3）。
   * @returns `{ suppressed, reason? }`；抑制时另带 `jobIds` / `subagentIds`（不抑制时不带额外键）
   */
  const gate = (session, intent, prompt) => {
    if (disposed) return { suppressed: false, reason: 'unavailable' }
    const jobsUsable = isJobRegistryLike(jobs)
    const subagentsUsable = isAgentRegistryLike(agents)
    // 两路都不可用 = 改动前的降级态：逐字回到旧行为
    if (!jobsUsable && !subagentsUsable) return { suppressed: false, reason: 'unavailable' }
    const sessionId = session?.header?.id
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { suppressed: false, reason: 'no-turn-start' }
    const since = turnStarts.get(sessionId)
    if (typeof since !== 'number') return { suppressed: false, reason: 'no-turn-start' }

    // ① 本轮拉起、尚未结算的后台 job（既有判定，口径一字不动）
    let jobIds = []
    let jobLookupFailed = false
    if (jobsUsable) {
      try {
        const list = jobs.list(sessionId)
        if (!Array.isArray(list)) {
          warn('job 服务 list() 未返回数组：本次不抑制')
          jobLookupFailed = true
        } else {
          jobIds = list.filter(job => job !== null && typeof job === 'object'
            && job.owner === sessionId
            && LIVE_STATUS.has(job.status)
            && Number.isFinite(job.startedAt)
            && job.startedAt >= since).map(job => job.id)
        }
      } catch (error) {
        warn(`job 判定异常（本次不抑制）：${String(error?.message ?? error)}`)
        jobLookupFailed = true
      }
    }

    // ② 本会话仍在跑的 subagent 后代（continuable 子代理不注册 job，只能在这里看见）
    const subagentIds = liveSubagentsOf(sessionId)

    if (jobIds.length === 0 && subagentIds.length === 0) {
      // job 源出错时保持既有诊断码 'error'（拿不准 → 照发）
      return { suppressed: false, reason: jobLookupFailed ? 'error' : 'no-work' }
    }
    const reason = jobIds.length > 0 && subagentIds.length > 0
      ? REASON_WORK_RUNNING
      : (jobIds.length > 0 ? REASON_JOB_RUNNING : REASON_SUBAGENT_RUNNING)
    cancelPending(sessionId)
    pending.set(sessionId, {
      session, intent, prompt, jobIds, subagentIds, watched: new Set(jobIds), timer: undefined,
    })
    log('debug', `抑制完成通知：会话 ${sessionId} 仍有活未结算（job ${jobIds.join(', ') || '—'}；subagent ${subagentIds.join(', ') || '—'}）`)
    return { suppressed: true, reason, jobIds, subagentIds }
  }

  /** 只读快照，供单测与排障。 */
  const pendingOf = sessionId => {
    const record = pending.get(sessionId)
    if (record === undefined) return undefined
    return { ...record, watched: new Set(record.watched) }
  }

  const dispose = () => {
    disposed = true
    for (const sessionId of [...pending.keys()]) cancelPending(sessionId)
    detach()
    detachSubagents()
  }

  // 构造期注入（单测 / 其他组合）：与 attachSubagents 走同一条路径（含形状校验与一次性告警）
  if (options.subagents !== undefined) attachSubagents(options.subagents)

  return {
    get available() { return isJobRegistryLike(jobs) },
    get subagentsAvailable() { return isAgentRegistryLike(agents) },
    attach,
    detach,
    attachSubagents,
    detachSubagents,
    noteTurnStart,
    gate,
    observe,
    observeSubagentEnd,
    pendingOf,
    dispose,
  }
}
