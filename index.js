/**
 * dsh-notice-webhook —— Cordis 插件入口。
 *
 * 「该被叫一声」的三个时刻（对话完成 / 等待授权 / 等待回答）按目标集合推送到 webhook。
 * 叠加四层：
 * - 会话窗口级**多目标**绑定（总开关关闭时旁路照发）
 * - goal 自动轮静默（只在目标终态推送）
 * - 渠道适配（每个 app 一种报文格式与业务码判定）
 * - 目标清单（界面经 Host RPC 增删改；其他插件经 Host Service 绑定）
 *
 * 本文件只做**接线**；判定逻辑住在各模块里。
 *
 * 需求：docs/requirements/REQ-260930155231-0862/
 */
import { normalizeConfig } from './src/config.js'
import { Classifier, INTENT_COMPLETE, silentReasonOf } from './src/classify.js'
import { GoalTracker } from './src/goal.js'
import { createJobGate } from './src/jobs.js'
import { Router, DROP_COOLDOWN } from './src/router.js'
import { BindingStore } from './src/bindings.js'
import { TargetStore } from './src/targets.js'
import { OutcomeStore } from './src/outcomes.js'
import { createService, provideService } from './src/service.js'
import { createRpcHandler, RPC_PREFIX } from './src/rpc.js'
import { buildRequest as channelBuildRequest, composeUrl, isSuccess as channelIsSuccess } from './src/channels/index.js'
import { deliver } from './src/deliver.js'
import { buildContext, createPromptTracker, renderContext } from './src/payload.js'

export const name = 'dsh-notice-webhook'

/**
 * 插件 Config schema —— **必须从入口导出**：Loader 激活时按它校验 profile 里那一行的
 * `config`，`Config.listConfigs` 也从这个导出取 schema（见技能文档 references/host-plugin.md）。
 * 实现在 src/config.js（那里同时保留 normalizeConfig 做取值规整兜底）。
 */
export { Config, VOLATILE_KEYS } from './src/config.js'

/** 出站契约版本（改动字段语义时才升）。 */
export const PAYLOAD_VERSION = 1

/**
 * legacy 等价映射（FR-9）：启动时把旧配置映射为新模型，不改也能跑。
 * - 非空 `webhookUrl` → 隐式 custom 目标 `{ id: 'legacy-default', isDefault: true }`
 * - 老 bindings 里的 `sessionId → url` → 同 url 的隐式 custom 目标 + 该窗口的绑定
 * - 显式清单里已有同 url 目标 → 复用，不重复建
 */
function seedLegacyTargets(config, targets, bindings, logger) {
  const warn = m => { try { logger?.warn?.(`[dsh-notice-webhook] legacy: ${m}`) } catch { /* 忽略 */ } }
  const existing = new Map(targets.list().map(t => [`${t.channel}::${t.url}`, t]))

  const ensureCustomTarget = (url, headers, makeDefault) => {
    if (typeof url !== 'string' || url.length === 0) return undefined
    const key = `custom::${url}`
    if (existing.has(key)) return existing.get(key)
    const verdict = targets.save({
      name: url, channel: 'custom', url, headers: headers ?? {}, enabled: true, events: [], isDefault: makeDefault,
    })
    if (!verdict.ok) { warn(`legacy 目标建立失败：${verdict.errors.join('；')}`); return undefined }
    existing.set(key, verdict.target)
    return verdict.target
  }

  if (typeof config.webhookUrl === 'string' && config.webhookUrl.length > 0) {
    ensureCustomTarget(config.webhookUrl, config.webhookHeaders, true)
  }

  // 配置期初始绑定（v1 语义）：只补"运行时没有的" key，不覆盖既有绑定
  const seedBindings = config.bindings ?? {}
  for (const [sessionId, url] of Object.entries(seedBindings)) {
    const existing = bindings.resolve(sessionId, '')
    if (existing === null || existing.source !== 'binding') bindings.bind(sessionId, url)
  }

  for (const { sessionId, url } of bindings.list()) {
    const target = ensureCustomTarget(url, undefined, false)
    if (target !== undefined && bindings.targetIdsOf(sessionId).length === 0) {
      bindings.bindTargets(sessionId, [target.id])
    }
  }
}

/**
 * 组装通知运行时（与 Cordis 无关，便于单测与端到端验证直接驱动）。
 *
 * @param rawConfig - 原始配置（会被规整）
 * @param options.logger / options.targets / options.bindings（兼容别名 options.store）/ options.outcomes / options.resolveSecret
 * @returns `{ config, targets, bindings, outcomes, service, rpcHandler, handle, dispatch, revision }`
 */
export function createNotifier(rawConfig, options = {}) {
  const logger = options.logger
  const config = normalizeConfig(rawConfig, logger)
  const targets = options.targets ?? new TargetStore({ logger })
  const bindings = options.bindings ?? options.store ?? new BindingStore({ logger })
  const outcomes = options.outcomes ?? new OutcomeStore()
  if (options.targets === undefined) targets.load()
  if (options.bindings === undefined && options.store === undefined) bindings.load()

  seedLegacyTargets(config, targets, bindings, logger)

  const classifier = new Classifier(config)
  const goals = new GoalTracker(config, session => classifier.titleOf(session))
  /**
   * 会话显示名（用户说的「窗口别名」）。
   *
   * 顺序：会话对象上的实时字段 → `session/title` 事件缓存。
   * 为什么要读实时字段：改名（rename）不一定发 title 事件，而且事件可能早于插件加载，
   * 只靠缓存会出现「别名没有了」。
   */
  const displayNameOf = session => {
    const live = [session?.title, session?.header?.title, session?.alias, session?.name]
      .find(value => typeof value === 'string' && value.length > 0)
    return live ?? classifier.titleOf(session) ?? null
  }

  const router = new Router(config)
  // 报文上下文：会话级记录「本轮最后一条人工输入」，装配成可配置的报文字段（FR-7/FR-8）
  const prompts = createPromptTracker()
  const resolveSecret = typeof options.resolveSecret === 'function' ? options.resolveSecret : ref => process.env[ref]

  /**
   * 后台 job 闸门（REQ-261001202058-0fbe）：完成意图先过它，再决定发不发。
   * - `options.jobs`：JobRegistry 形状（单测注入假件；生产由 apply 的 ctx.inject(['jobs']) 接上）；
   * - `options.jobGraceMs` / `clock` / `timers`：宽限窗口、时钟与计时器注入（单测可瞬时推进，不真等）；
   * - 补发走**同一条 dispatch**，所以渠道打包、加签、逐目标过滤、冷却全部自动一致。
   */
  const gate = createJobGate({
    logger,
    graceMs: options.jobGraceMs,
    clock: options.clock,
    setTimer: options.timers?.setTimer,
    clearTimer: options.timers?.clearTimer,
    // 两路事实源：job（生产经 ctx.inject(['jobs'])）+ subagent 后代（生产经 ctx.inject(['agents'])）
    subagents: options.subagents,
    deliver: (session, intent, meta) => dispatch(session, intent, undefined, meta),
  })
  if (options.jobs !== undefined) gate.attach(options.jobs)

  // revision 栅栏（RPC 写入用；内存单调计数即可，重启归零无妨——客户端会先 GET /state）
  let revision = 0
  const bumpRevision = () => { revision += 1 }
  const getRevision = () => revision

  /** 逐目标投递：打包 → 投递 → 判业务码 → 记结果（互不影响）。 */
  /**
   * 这个目标实际用哪份文案：目标自己的覆盖 → 界面上配的全局 → 插件配置默认。
   * 三级优先，任一层为 null 就往下落。
   */
  const effectivePayload = target => target?.payload ?? config.payload

  const deliverToTarget = (target, intent, session, extra = {}) => {
    // 补发场景下该轮的输入已被 clear，必须用调用方捕获的值（REQ-261001202058-0fbe FR-3）
    const prompt = extra.prompt !== undefined ? extra.prompt : prompts.take(session)
    // 地址一律经 composeUrl 得出：只填 key 的目标由渠道前缀拼装，遗留目标原样直投。
    // 适配器内部仍读 target.url，故此处只是把「地址来源」收敛到单点，报文与加签一字未动。
    const request = channelBuildRequest({ ...target, url: composeUrl(target) }, {
      intent,
      session: { id: session?.header?.id ?? null, workspace: session?.header?.cwd ?? null },
      title: displayNameOf(session),
      // 上下文（字段取值）+ contextText（文本渠道用的拼装结果）
      context: buildContext({
        payload: effectivePayload(target),
        intent,
        session: { id: session?.header?.id ?? null, workspace: session?.header?.cwd ?? null },
        title: displayNameOf(session),
        prompt,
        goal: extra.goal ?? null,
        question: extra.question ?? null,
        now: Date.now(),
      }),
      contextText: renderContext(buildContext({
        payload: effectivePayload(target),
        intent,
        session: { id: session?.header?.id ?? null, workspace: session?.header?.cwd ?? null },
        title: displayNameOf(session),
        prompt,
        goal: extra.goal ?? null,
        question: extra.question ?? null,
        now: Date.now(),
      }), effectivePayload(target)),
      secret: target.secretRef !== undefined ? resolveSecret(target.secretRef) : undefined,
      now: Date.now(),
    })
    if (request.error !== undefined) {
      outcomes.record(target.id, { ok: false, reason: request.error })
      return { ok: false, reason: request.error }
    }
    const attempt = deliver(request.url, request.body, {
      timeoutMs: config.timeoutMs, retry: config.retry, headers: request.headers, logger,
    })
    attempt.then(res => {
      const verdict = res.ok ? channelIsSuccess(target.channel, res.status, res.parsed) : { ok: false, reason: res.error }
      const ok = res.ok && verdict.ok
      outcomes.record(target.id, { ok, status: res.status, reason: ok ? undefined : (verdict.reason ?? res.error) })
    }).catch(error => {
      try { logger?.warn?.(`[dsh-notice-webhook] 投递异常被兜住：${String(error?.message ?? error)}`) } catch { /* 忽略 */ }
      outcomes.record(target.id, { ok: false, reason: String(error?.message ?? error) })
    })
    return attempt
  }

  /** 路由 + 投递。返回决策结果（便于测试断言"为什么没发 / 发到哪几个"）。 */
  const dispatch = (session, intent, now, extra = {}) => {
    const resolved = router.resolveTargets(session, intent, { bindings, targets })
    if (resolved.targets.length === 0) {
      try { logger?.debug?.(`[dsh-notice-webhook] 丢弃 ${intent.event}：${resolved.reason}`) } catch { /* 忽略 */ }
      return { action: 'dropped', reason: resolved.reason, intent }
    }
    if (!router.commitCooldown(session, now)) {
      return { action: 'dropped', reason: DROP_COOLDOWN, intent }
    }
    for (const target of resolved.targets) deliverToTarget(target, intent, session, extra)
    return { action: 'sent', source: resolved.source, count: resolved.targets.length, intent }
  }

  /**
   * 处理一条会话事件（主链路）。
   * @returns `{ action, reason?, intent?, count? }` —— action 为 'sent' | 'dropped' | 'silent' | 'ignored'
   */
  const handle = (session, event, now) => {
    const isTurnEnd = event?.type === 'turn/end'
    // 轮次起点：判定「哪些 job 是本轮拉起的」（REQ-261001202058-0fbe FR-2）
    if (event?.type === 'turn/start') gate.noteTurnStart(session?.header?.id)
    // 先记下本轮的人工输入，再分类——这样 turn/end 的报文里能带上「你说了什么」
    prompts.observe(session, event)
    const terminal = goals.observe(session, event)
    const intent = classifier.classify(session, event)
    const autoRound = isTurnEnd ? goals.isAutoRound(session) : false
    if (isTurnEnd) goals.endRound(session)

    if (terminal !== null) return dispatch(session, terminal, now, { goal: terminal.goal ?? null })
    if (intent === null) {
      // turn/end 被规则静默时**留痕**（REQ-261001203114-19b6 FR-6）：
      // 让人分得清「规则不让推」与「推了但没到」——这是排障时唯一能问的地方。
      const silent = isTurnEnd ? silentReasonOf(event?.data?.reason, config.skipReasons) : null
      if (silent !== null) {
        try {
          logger?.debug?.(`[dsh-notice-webhook] 丢弃 turn/end：${silent.reason}（kind=${silent.kind}）`)
        } catch {
          /* 记日志失败不影响会话 */
        }
        return { action: 'dropped', reason: silent.reason, turnKind: silent.kind }
      }
      return { action: 'ignored' }
    }
    // goal 自动轮静默：整轮都是系统注入的（没有任何人工输入）→ 不打扰使用者。
    // **只对完成意图生效**：自动轮里 agent 报错停下时更要叫人（REQ-261001203114-19b6 FR-4）。
    if (intent.kind === 'complete' && autoRound) return { action: 'silent', intent }
    // 完成闸门（REQ-261001202058-0fbe + REQ-261005120639-f801）：本轮把活交给了还没跑完的后台 job
    // **或**还没跑完的子代理 → 先不推「已完成」，等结算后补发。
    // （continuable 子代理不注册 job，所以闸门要同时看 agents——见 src/jobs.js 模块头。）
    if (intent.kind === INTENT_COMPLETE && config.jobAwareComplete) {
      const verdict = gate.gate(session, intent, prompts.take(session))
      if (verdict.suppressed) {
        return {
          action: 'dropped',
          reason: verdict.reason,
          intent,
          jobIds: verdict.jobIds,
          subagentIds: verdict.subagentIds,
        }
      }
    }
    // 问题文本可能在 questions[0].question（userQuestions 服务）或 data.question（旧形态）
    const asked = Array.isArray(event?.data?.questions) ? event.data.questions[0] : undefined
    const result = dispatch(session, intent, now, { question: asked?.question ?? event?.data?.question ?? null })
    // 一轮结束后清掉，避免下一轮把上一轮的话带出来
    if (isTurnEnd) prompts.clear(session)
    return result
  }

  /**
   * 「问用户」的统一入口是 ctx 上的 **waterfall 事件 `user-questions/request`**——
   * 内建工具、权限流、**以及二次开发插件的弹框**（如 pmboard 的确认框）都走它。
   *
   * 为什么必须单独接：它是 ctx 事件、**不在 session/event 流里**，只订阅会话事件的话
   * 插件弹框完全看不到（用户反馈「pm 插件的弹框不能拦截」就是这个原因）。
   */
  const handleExternalQuestion = ({ question, header, sessionId, workspace }) => {
    const suffix = typeof header === 'string' && header.length > 0 ? `（${header}）` : ''
    const intent = {
      kind: 'question',
      event: 'ask_user_question',
      message: `${config.questionMessage}${suffix}`,
      toolName: null,
    }
    const session = { header: { id: sessionId ?? null, cwd: workspace ?? null } }
    return dispatch(session, intent, Date.now(), { question: question ?? null })
  }

  /** 发一条固定测试通知到某目标（RPC /test 用；不改清单）。 */
  const deliverTest = async (target) => {
    // 测试通知按**默认完整样式**发：让用户在群里直接看到真实通知长什么样
    // （此前只发一行纯文本，看不到卡片与会话/工作区/摘要这些字段）。
    const now = Date.now()
    const intent = { event: 'turn/end', message: '这是一条测试通知', toolName: null, goal: null }
    const session = { id: 'sess-test-abc123', workspace: process.cwd() }
    const title = '通知测试（示例）'
    const payloadConfig = config.payload ?? {}
    const context = buildContext({
      intent, session, title,
      prompt: '这是一条测试通知：收到它就说明该目标的配置已生效',
      goal: null, question: null, now, payload: payloadConfig,
    })
    const request = channelBuildRequest({ ...target, url: composeUrl(target) }, {
      intent,
      session,
      title,
      secret: target.secretRef !== undefined ? resolveSecret(target.secretRef) : undefined,
      context,
      contextText: renderContext(context, payloadConfig),
      now,
    })
    if (request.error !== undefined) return { ok: false, reason: request.error }
    const res = await deliver(request.url, request.body, {
      timeoutMs: config.timeoutMs, retry: config.retry, headers: request.headers, logger,
    })
    const verdict = res.ok ? channelIsSuccess(target.channel, res.status, res.parsed) : { ok: false, reason: res.error }
    return { ok: res.ok && verdict.ok, status: res.status, reason: res.ok ? verdict.reason : res.error }
  }

  /**
   * v1 的 bind(sessionId, url) 兼容：同时写 url 段与多目标段。
   * url 段保 v1 的 resolve() 语义；目标段让 v2 的 resolveTargets() 能读到。
   */
  const bindLegacyUrl = (sessionId, url) => {
    const ok = bindings.bind(sessionId, url)
    if (!ok) return false
    let target = targets.list().find(t => t.channel === 'custom' && t.url === url)
    if (target === undefined) {
      const verdict = targets.save({ name: url, channel: 'custom', url, headers: config.webhookHeaders ?? {}, enabled: true, events: [], isDefault: false })
      if (!verdict.ok) return false
      target = verdict.target
    }
    return bindings.bindTargets(sessionId, [target.id])
  }

  const service = createService({
    bindings,
    targets,
    resolveDefaultUrl: () => config.webhookUrl,
    bindLegacyUrl,
    resolveAll: (sessionId, intent) => {
      const resolved = router.resolveTargets({ header: { id: sessionId } }, intent, { bindings, targets })
      return resolved.targets.map(t => ({ id: t.id, name: t.name, channel: t.channel, url: t.url }))
    },
  })

  const rpcHandler = createRpcHandler({
    // 全局文案的「出厂默认」来自插件配置；界面若配了全局覆盖，优先用它
    payloadDefaults: config.payload,
    targets, bindings, outcomes,
    defaults: () => ({ enabled: config.enabled, timeoutMs: config.timeoutMs, retry: config.retry, cooldownMs: config.cooldownMs }),
    revision: getRevision,
    bumpRevision,
    resolveSecret: ref => resolveSecret(ref) !== undefined,
    deliverTest,
    logger,
  })

  /** 闸门清理（幂等）：取消宽限计时器、注销 job 事件订阅、清 pending。 */
  const dispose = () => gate.dispose()

  return { config, targets, bindings, outcomes, service, rpcHandler, handle, dispatch, handleExternalQuestion, gate, dispose, revision: getRevision, get store() { return bindings } }
}

/**
 * 插件激活入口。
 *
 * @param ctx - Cordis 上下文（ctx.on / ctx.logger / ctx.provide / ctx.effect / ctx.inject）
 * @param rawConfig - Loader 行上的 config
 */
export function apply(ctx, rawConfig) {
  const logger = ctx?.logger
  const runtime = createNotifier(rawConfig, { logger })
  const disposeService = provideService(ctx, runtime.service)

  const handler = (session, event) => {
    try {
      runtime.handle(session, event)
    } catch (error) {
      // 通知插件绝不能把会话搞崩：任何判定异常都降级为一条日志
      try { logger?.warn?.(`[dsh-notice-webhook] 事件处理异常已隔离：${String(error?.message ?? error)}`) } catch { /* 忽略 */ }
    }
  }

  const offEvent = typeof ctx?.on === 'function' ? ctx.on('session/event', handler) : undefined

  // 后台 job 事实源（REQ-261001202058-0fbe）：**可选**依赖——服务不在或形状不符时，闸门自动降级为旧行为。
  // 与既有 webServer 接线同一模式：服务就绪才跑回调，effect 负责回收（回调返回的 detach 即清理函数）。
  const offJobs = typeof ctx?.inject === 'function'
    ? ctx.inject(['jobs'], jobCtx => {
      jobCtx?.effect?.(() => runtime.gate.attach(jobCtx.jobs))
    })
    : undefined

  // 子代理事实源（REQ-261005120639-f801）：**可选**依赖——continuable 子代理走 startContinuable()、**不注册 job**，
  // 只有 agent 注册表看得见它们。服务不在或形状不符时这一路自动降级（照发），job 那一路不受影响。
  const offAgents = typeof ctx?.inject === 'function'
    ? ctx.inject(['agents'], agentsCtx => {
      agentsCtx?.effect?.(() => runtime.gate.attachSubagents(agentsCtx.agents))
    })
    : undefined

  // 子代理结算信号：普通（emit 模式）Cordis 事件——**不是** waterfall，不需要 next() 放行。
  // 只把它当「该复检了」的时机：存活与否由闸门现查 agent 注册表，不依赖事件归因。
  const offSubagentEnd = typeof ctx?.on === 'function'
    ? ctx.on('subagent/end', () => {
      try {
        runtime.gate.observeSubagentEnd()
      } catch (error) {
        // 复检失败绝不能影响会话，也绝不能影响子代理自身的结算
        try { logger?.warn?.(`[dsh-notice-webhook] 子代理复检异常已隔离：${String(error?.message ?? error)}`) } catch { /* 忽略 */ }
      }
    })
    : undefined

  // 弹框类提问走 ctx 的 **waterfall** 事件 `user-questions/request`（不在 session/event 流里）：
  // 内建工具、权限流、二次开发插件的弹框（如 pmboard 的确认框）都从这里过。
  // 两条纪律：① 事件从 agent 作用域冒泡到根 ctx，所以根上订阅收得到；
  //          ② 必须 `next()` 放行——我们是旁听者，吞掉提问会导致弹框根本不弹。
  const offQuestions = typeof ctx?.on === 'function'
    ? ctx.on('user-questions/request', (request, next) => {
      try {
        const first = Array.isArray(request?.questions) ? request.questions[0] : undefined
        const agentSession = request?.agent?.session
        runtime.handleExternalQuestion({
          question: first?.question ?? null,
          header: first?.header ?? null,
          sessionId: request?.sessionId ?? agentSession?.header?.id ?? null,
          workspace: agentSession?.header?.cwd ?? null,
        })
      } catch (error) {
        // 通知失败绝不能影响提问本身
        try { logger?.warn?.(`[dsh-notice-webhook] 提问通知失败：${String(error?.message ?? error)}`) } catch { /* 忽略 */ }
      }
      return typeof next === 'function' ? next() : undefined
    })
    : undefined

  // 设置页用的 Host RPC（沿用 Host 既有信任域；webServer 服务缺失时不报错——本插件仍工作）
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['webServer'], webCtx => {
      try {
        webCtx?.effect?.(() => {
          webCtx?.webServer?.register?.({ kind: 'prefix', path: RPC_PREFIX, handler: runtime.rpcHandler })
        })
      } catch (error) {
        try { logger?.warn?.(`[dsh-notice-webhook] RPC 注册失败（界面不可用，通知仍工作）：${String(error?.message ?? error)}`) } catch { /* 忽略 */ }
      }
    })
  }

  const dispose = () => {
    // 顺序：先摘接线与计时器（不留悬挂回调），再清状态与既有订阅
    try { offJobs?.() } catch { /* 忽略 */ }
    try { offAgents?.() } catch { /* 忽略 */ }
    // 子代理复检订阅（subagent/end）+ agents 接线：先摘监听，再清闸门状态
    try { offSubagentEnd?.() } catch { /* 忽略 */ }
    try { runtime.dispose() } catch { /* 忽略 */ }
    try { offEvent?.() } catch { /* 忽略 */ }
    try { offQuestions?.() } catch { /* 忽略 */ }
    disposeService()
  }

  logger?.info?.(
    `[dsh-notice-webhook] 已激活：目标 ${runtime.targets.list().length} 个，绑定 ${runtime.bindings.listBindings().length} 条，总开关 ${runtime.config.enabled ? '开' : '关'}`,
  )

  if (typeof ctx?.effect === 'function') return ctx.effect(() => dispose)
  return dispose
}
