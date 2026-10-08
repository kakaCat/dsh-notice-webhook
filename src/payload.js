/**
 * 报文上下文：把「谁的会话、在哪、你说了什么、怎么结束、什么时候」装配成可配置的字段。
 *
 * 为什么单独成模块：通知的价值全在上下文，而「要显示哪些」是使用者的偏好——
 * 所以这里把**取值**（context）与**呈现**（render）分开：取值只认事实，呈现只认配置。
 *
 * 契约见 docs/requirements/REQ-260930215459-d718/design/notify-payload.md。
 */
import { isHumanSource } from './source.js'

/** 报文字段的默认顺序与默认开关（= 设计里的「全量形态」）。 */
export const DEFAULT_FIELDS = ['event', 'time', 'session', 'workspace', 'prompt', 'detail', 'link']

/** payload 配置默认值；不配置时行为与配置齐全一致（避免「默认残缺」）。 */
export const DEFAULT_PAYLOAD = {
  fields: DEFAULT_FIELDS,
  promptChars: 60,
  workspaceStyle: 'basename',
  timeFormat: 'YYYY-MM-DD HH:mm',
  linkUrl: 'dsh://open',
  template: '',
}

/** 事件 → 标题（人话）与卡片配色。 */
const EVENT_META = {
  'turn/end': { title: '✅ 对话完成', color: 'green' },
  'turn/error': { title: '⚠️ 会话中断', color: 'red' },
  ask_user_question: { title: '❓ 等待回答', color: 'orange' },
  'approval/asked': { title: '🔐 等待授权', color: 'orange' },
  'goal/complete': { title: '🎯 目标完成', color: 'green' },
  'goal/blocked': { title: '⛔ 目标阻塞', color: 'red' },
  'goal/rounds-exhausted': { title: '⛔ 目标轮次耗尽', color: 'red' },
}

/** 取事件的标题与配色（未知事件回落为原文 + 中性色）。 */
export function eventMeta(event) {
  return EVENT_META[event] ?? { title: event ?? '通知', color: 'blue' }
}

/**
 * 文本渠道用：原有文案 + 上下文行（没有上下文时**一字不改**，保住既有报文断言）。
 */
export function withContext(intent, contextText) {
  if (typeof contextText !== 'string' || contextText.length === 0) return intent.message
  return `${intent.message}\n${contextText}`
}

/**
 * 从消息 content 里抽纯文本。
 * content 可能是字符串，也可能是 `[{ type:'text', text }]` 这类分片数组。
 */
export function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : '')))
      .filter(text => text.length > 0)
      .join('\n')
  }
  if (content !== null && typeof content === 'object' && typeof content.text === 'string') return content.text
  return ''
}

/**
 * 会话级「本轮最后一条人工输入」跟踪器。
 *
 * 为什么不复用 goal.js：那边只判定「本轮是否有人工参与」（布尔），
 * 这里要留下**文本**；两者读同一处 source.kind，口径一致但用途不同。
 *
 * 2026-10-02（REQ-261002150038-344a）：口径收敛到 `src/source.js` 的 `isHumanSource`——
 * 以前只跳过 `'goal'`，于是 pmboard Dive 自动续跑注入的正文被当成「任务」显示
 *（截图里那行「继续执行需求 REQ-… 第 35 回合」）。
 */
export function createPromptTracker() {
  const last = new WeakMap()
  return {
    /** 观察一条会话事件；注入轮（goal / dive / plugin …）的 user message 不计入——只留 direct human 的话。 */
    observe(session, event) {
      if (session === null || session === undefined) return
      if (event?.type !== 'user/message') return
      if (!isHumanSource(event?.data?.source)) return
      // 载荷形状两种都要认：DSH 里 user/message 的 data **就是消息本身**（`{content:[...]}`），
      // 而合成事件/部分上游会包一层 `{message:{content}}`。只认一种就会把摘要取空
      //（表现为卡片上「任务」那行整行消失，用户以为没生效）。
      const message = event?.data?.message ?? event?.data
      const text = textOf(message?.content).trim()
      if (text.length > 0) last.set(session, text)
    },
    /** 取该会话本轮最后一条人工输入；没有则 null。 */
    take(session) {
      if (session === null || session === undefined) return null
      return last.get(session) ?? null
    },
    /** 一轮结束后清掉，避免下一轮把上一轮的话带出来。 */
    clear(session) {
      if (session !== null && session !== undefined) last.delete(session)
    },
  }
}

/** 按配置把工作区路径变成要显示的样子。 */
export function renderWorkspace(cwd, style) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null
  if (style === 'full') return cwd
  const parts = cwd.split('/').filter(part => part.length > 0)
  return parts.length === 0 ? cwd : parts[parts.length - 1]
}

/** 会话短 id：取后 6 位（便于在会话列表里认人）。 */
export function shortId(id) {
  if (typeof id !== 'string' || id.length === 0) return null
  return id.length <= 6 ? id : id.slice(-6)
}

/** 按本地时区格式化时间；格式串只支持 HH / mm / ss 与 - / : 空格字面量。 */
export function formatTime(now, format) {
  const date = new Date(now)
  const pad = value => String(value).padStart(2, '0')
  const table = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  }
  const pattern = typeof format === 'string' && format.length > 0 ? format : 'HH:mm'
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, token => table[token])
}

/** 截断摘要（超出加省略号）；chars <= 0 表示不带。 */
export function truncate(text, chars) {
  if (typeof text !== 'string') return null
  const limit = Number.isFinite(chars) ? Math.floor(chars) : 0
  if (limit <= 0) return null
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/** 事件专属详情（没有就返回 null）。 */
export function detailOf(intent, extra) {
  const event = intent?.event
  if (event === 'ask_user_question') {
    const question = typeof extra?.question === 'string' && extra.question.length > 0 ? extra.question : null
    return question === null ? null : { label: '问的是', value: question }
  }
  if (event === 'approval/asked') {
    return intent?.toolName ? { label: '工具', value: intent.toolName } : null
  }
  if (typeof event === 'string' && event.startsWith('goal/')) {
    const goal = extra?.goal
    const objective = typeof goal?.objective === 'string' && goal.objective.length > 0 ? goal.objective : null
    const status = event.replace('goal/', '')
    const rounds = Number.isFinite(goal?.round) && Number.isFinite(goal?.maxRounds)
      ? `（轮次 ${goal.round}/${goal.maxRounds}）`
      : ''
    return objective === null ? null : { label: '目标', value: `${objective} · ${status}${rounds}` }
  }
  return null
}

/**
 * 装配报文字段（只认事实，不做呈现决策）。
 *
 * @returns `{ event, time, session, workspace, prompt, detail, link, title, color }`
 */
export function buildContext({ intent, session, title, prompt, goal, question, now, payload }) {
  const config = { ...DEFAULT_PAYLOAD, ...(payload ?? {}) }
  const meta = eventMeta(intent?.event)
  const workspace = renderWorkspace(session?.workspace ?? session?.cwd ?? null, config.workspaceStyle)
  const id = shortId(session?.id ?? null)
  return {
    event: intent?.event ?? null,
    title: meta.title,
    color: meta.color,
    time: formatTime(now ?? Date.now(), config.timeFormat),
    session: title ?? null,
    id,
    workspace,
    prompt: truncate(prompt ?? null, config.promptChars),
    detail: detailOf(intent, { goal, question }),
    link: config.linkUrl,
  }
}

/** 默认模板里的字段渲染顺序（template 为空时用）。 */
const RENDERERS = {
  event: ctx => `**类型**：${ctx.title}`,
  time: ctx => `**时间**：${ctx.time}`,
  session: ctx => {
    const id = ctx.id === null ? '' : `（#${ctx.id}）`
    return ctx.session === null ? null : `**会话**：${ctx.session}${id}`
  },
  workspace: ctx => (ctx.workspace === null ? null : `**工作区**：${ctx.workspace}`),
  prompt: ctx => (ctx.prompt === null ? null : `**任务**：${ctx.prompt}`),
  detail: ctx => (ctx.detail === null ? null : `**${ctx.detail.label}**：${ctx.detail.value}`),
  link: ctx => (ctx.link === null || ctx.link === '' ? null : `[打开 DSH](${ctx.link})`),
}

/**
 * 把字段渲染成文本（markdown）。fields 决定「要哪几行、什么顺序」；
 * template 非空时整段覆盖，支持 `{event} {time} {session} {id} {workspace} {prompt} {detail} {link}`。
 */
export function renderContext(ctx, payload) {
  const config = { ...DEFAULT_PAYLOAD, ...(payload ?? {}) }
  if (typeof config.template === 'string' && config.template.trim().length > 0) {
    const table = {
      event: ctx.title,
      time: ctx.time,
      session: ctx.session ?? '',
      id: ctx.id ?? '',
      workspace: ctx.workspace ?? '',
      prompt: ctx.prompt ?? '',
      detail: ctx.detail === null ? '' : `${ctx.detail.label}：${ctx.detail.value}`,
      link: ctx.link ?? '',
    }
    return config.template.replace(/\{(\w+)\}/g, (whole, key) => (key in table ? table[key] : whole))
  }
  const fields = Array.isArray(config.fields) && config.fields.length > 0 ? config.fields : DEFAULT_FIELDS
  const lines = []
  for (const field of fields) {
    const render = RENDERERS[field]
    if (render === undefined) continue
    const line = render(ctx)
    if (line !== null && line !== undefined && line !== '') lines.push(line)
  }
  return lines.join('\n')
}
