/**
 * 配置默认值与取值规整。
 *
 * 为什么单独成模块：配置是**唯一**的外部输入面，坏配置不得让插件静默跑偏，
 * 也不得让插件加载失败。口径：类型不符或越界 → 回落默认值并留一条 warn。
 *
 * 契约见 docs/requirements/REQ-260930123701-250a/design/interfaces.md「配置项契约」。
 */

import z from '@deepseek-ai/schemastery'

/** 全部配置项的默认值（未在 profile 里写的键一律取这里的值）。 */
export const DEFAULTS = {
  // 总开关：只管默认通道；已绑定 webhook 的会话窗口不受它影响（FR-7）。
  enabled: true,
  // 默认 webhook 地址；空串 = 未配置。
  webhookUrl: '',
  // 附加请求头（鉴权用），原样带上。
  webhookHeaders: {},
  // 单次投递超时（毫秒）。
  timeoutMs: 5000,
  // 失败重试次数（仅网络错误 / 5xx / 超时）。
  retry: 0,
  // 同一会话两次推送的最小间隔（毫秒）。
  cooldownMs: 0,
  // 只提示顶层会话（跳过子代理 / fork）。
  onlyTopLevel: true,
  // 通知分类开关（内容级过滤：命中窗口绑定也不豁免）。第四类是**中断通知**
  // （REQ-261001203114-19b6：agent 因报错/崩溃停下时叫你一声）。
  notifyComplete: true,
  notifyApproval: true,
  notifyQuestion: true,
  // 关掉 = 中断静默；**不**回落成「会话已完成」（把报错说成跑完，比不推更糟）。
  notifyInterrupt: true,
  // 后台 job 感知：本轮把活交给后台 job（run_in_background）且 job 尚未结算时，
  // 不推「会话已完成」，等 job 结算后再补发。关掉 = 逐字回到旧行为（REQ-261001202058-0fbe FR-4）。
  jobAwareComplete: true,
  // 正文文案。
  completeMessage: '会话已完成',
  interruptMessage: '会话异常中断',
  approvalMessage: '需要你允许执行操作',
  questionMessage: '需要你回答一个问题',
  goalCompleteMessage: '目标已完成',
  goalBlockedMessage: '目标阻塞',
  // 完成类推送是否拼接会话标题。
  includeTitle: true,
  // **静默名单**：命中的 turn/end 终态完全不推（优先于 notifyInterrupt）。
  // 默认只留 aborted（用户自己按的 Esc）；把 error 也写进来 = 中断彻底安静。
  skipReasons: ['aborted'],
  // 配置期初始绑定：{ sessionId: url }。
  bindings: {},
  // 报文内容（FR-8）：要哪几行、摘要多长、工作区显示、时间格式、跳转地址、整段模板。
  payload: {
    fields: ['event', 'time', 'session', 'workspace', 'prompt', 'detail', 'link'],
    promptChars: 60,
    workspaceStyle: 'basename',
    timeFormat: 'YYYY-MM-DD HH:mm',
    linkUrl: 'dsh://open',
    template: '',
  },
}

const BOOLEAN_KEYS = ['enabled', 'onlyTopLevel', 'notifyComplete', 'notifyApproval', 'notifyQuestion', 'notifyInterrupt', 'jobAwareComplete', 'includeTitle']
const STRING_KEYS = ['webhookUrl', 'completeMessage', 'interruptMessage', 'approvalMessage', 'questionMessage', 'goalCompleteMessage', 'goalBlockedMessage']
/** 非负整数键；timeoutMs 额外要求 > 0（0 会让每次投递立即超时）。 */
const COUNT_KEYS = ['timeoutMs', 'retry', 'cooldownMs']

function warnWith(logger, message) {
  try {
    const sink = logger ?? console
    if (typeof sink.warn === 'function') sink.warn(`[dsh-notice-webhook] config: ${message}`)
  } catch {
    /* 记日志失败绝不能影响配置规整 */
  }
}

function takeBoolean(raw, key, out, logger) {
  const value = raw[key]
  if (value === undefined) return
  if (typeof value !== 'boolean') {
    warnWith(logger, `${key} 期望 boolean，收到 ${typeof value}，已回落默认值 ${DEFAULTS[key]}`)
    return
  }
  out[key] = value
}

function takeString(raw, key, out, logger) {
  const value = raw[key]
  if (value === undefined) return
  if (typeof value !== 'string') {
    warnWith(logger, `${key} 期望 string，收到 ${typeof value}，已回落默认值 "${DEFAULTS[key]}"`)
    return
  }
  out[key] = value
}

function takeCount(raw, key, out, logger) {
  const value = raw[key]
  if (value === undefined) return
  const minimum = key === 'timeoutMs' ? 1 : 0
  if (!Number.isInteger(value) || value < minimum) {
    warnWith(logger, `${key} 期望 >= ${minimum} 的整数，收到 ${JSON.stringify(value)}，已回落默认值 ${DEFAULTS[key]}`)
    return
  }
  out[key] = value
}

/**
 * 把 profile 里给的原始配置规整成可用配置。
 *
 * @param raw - Loader 行上的 config（可能是任意值，包括 undefined）
 * @param logger - 记警告的出口；缺省用 console（离线单测与 CLI 验证用）
 * @returns 规整后的配置对象（永不抛异常）
 */
export function normalizeConfig(raw, logger) {
  const out = { ...DEFAULTS, skipReasons: [...DEFAULTS.skipReasons], bindings: {}, webhookHeaders: {} }
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    warnWith(logger, `配置整体期望 object，收到 ${Array.isArray(raw) ? 'array' : typeof raw}，已全部回落默认值`)
  }

  for (const key of BOOLEAN_KEYS) takeBoolean(source, key, out, logger)
  for (const key of STRING_KEYS) takeString(source, key, out, logger)
  for (const key of COUNT_KEYS) takeCount(source, key, out, logger)

  const skipReasons = source.skipReasons
  if (skipReasons !== undefined) {
    if (Array.isArray(skipReasons) && skipReasons.every(item => typeof item === 'string')) {
      out.skipReasons = [...skipReasons]
    } else {
      warnWith(logger, `skipReasons 期望 string[]，已回落默认值 ${JSON.stringify(DEFAULTS.skipReasons)}`)
    }
  }

  const headers = source.webhookHeaders
  if (headers !== undefined) {
    if (headers !== null && typeof headers === 'object' && !Array.isArray(headers)) {
      out.webhookHeaders = { ...headers }
    } else {
      warnWith(logger, 'webhookHeaders 期望 object，已回落为空对象')
    }
  }

  const bindings = source.bindings
  if (bindings !== undefined) {
    if (bindings !== null && typeof bindings === 'object' && !Array.isArray(bindings)) {
      out.bindings = { ...bindings }
    } else {
      warnWith(logger, 'bindings 期望 object（{ sessionId: url }），已回落为空对象')
    }
  }

  return out
}

/**
 * 插件 Config schema（声明它的收益有三条）：
 * 1. Loader 在激活时按它校验 profile 里那一行的 config；
 * 2. `Config.listConfigs` 能查到本插件的 schema（便于外部工具/人核对）；
 * 3. 标了 `.volatile()` 的字段可在**不重挂载**的前提下改（dsh-settings 的表单只投影
 *    "最近 volatile 祖先"下的字段）。
 *
 * 哪些字段标 volatile：只有"改了立刻生效且不影响接线"的运行时旋钮——总开关、超时/重试/冷却、
 * 三类通知开关、后台 job 感知（`jobAwareComplete`）、顶层过滤、是否拼标题。
 * 哪些不标：`webhookUrl`（影响 legacy 默认目标的建立）、文案、`skipReasons`、`bindings`/`webhookHeaders`
 * （这些改动走 Loader 的正常生命周期即可，不做热改承诺）。
 *
 * 注意：schema 只负责**校验与表单投影**；取值规整（越界回落默认 + warn）仍由 `normalizeConfig` 承担，
 * 因为 Loader 的校验失败会拦住插件激活，而我们希望"配置写歪了插件照样起来、只是回落默认"。
 */
export const Config = z.object({
  /** 总开关：只管默认目标组（FR-6）。 */
  enabled: z.boolean().default(true).volatile(),
  /** 老配置的默认地址：映射为一条 custom 默认目标（FR-9）。 */
  webhookUrl: z.string().default(''),
  /** 附加请求头（仅 legacy custom 目标使用）。 */
  webhookHeaders: z.dict(z.string()).default({}),
  /** 投递参数。 */
  timeoutMs: z.number().default(5000).volatile(),
  retry: z.number().default(0).volatile(),
  cooldownMs: z.number().default(0).volatile(),
  /** 通知开关（内容级过滤）；`notifyInterrupt` = 中断通知（关掉 = 静默，不谎报完成）。 */
  notifyComplete: z.boolean().default(true).volatile(),
  notifyApproval: z.boolean().default(true).volatile(),
  notifyQuestion: z.boolean().default(true).volatile(),
  notifyInterrupt: z.boolean().default(true).volatile(),
  /** 后台 job 感知：job 未结算时不推完成通知（关掉 = 旧行为）。 */
  jobAwareComplete: z.boolean().default(true).volatile(),
  /** 正文文案。 */
  completeMessage: z.string().default('会话已完成'),
  interruptMessage: z.string().default('会话异常中断'),
  approvalMessage: z.string().default('需要你允许执行操作'),
  questionMessage: z.string().default('需要你回答一个问题'),
  goalCompleteMessage: z.string().default('目标已完成'),
  goalBlockedMessage: z.string().default('目标阻塞'),
  /** 只有顶层会话才提醒。 */
  onlyTopLevel: z.boolean().default(true).volatile(),
  /** **静默名单**：命中的 turn/end 终态完全不推（优先于 notifyInterrupt）。 */
  skipReasons: z.array(z.string()).default(['aborted']),
  /** 完成类文案是否拼会话标题。 */
  includeTitle: z.boolean().default(true).volatile(),
  /** 报文内容配置（FR-8）；改动即时生效，不必重启。 */
  payload: z.object({
    /** 要哪些行、按什么顺序（见 DEFAULT_PAYLOAD.fields）。 */
    fields: z.array(z.string()).default(['event', 'time', 'session', 'workspace', 'prompt', 'detail', 'link']),
    /** 「你说」摘要长度；0 = 不带。 */
    promptChars: z.number().default(60),
    /** basename（只显示目录名）| full（全路径）。 */
    workspaceStyle: z.string().default('basename'),
    /** 本地时间格式，支持 YYYY/MM/DD/HH/mm/ss。 */
    timeFormat: z.string().default('YYYY-MM-DD HH:mm'),
    /** 跳转地址（默认 dsh://open；可含 {session}/{id}/{workspace} 占位符）。 */
    linkUrl: z.string().default('dsh://open'),
    /** 非空则整段覆盖默认拼装。 */
    template: z.string().default(''),
  }).default({}).volatile(),
  /** 配置期初始绑定（legacy 兼容字段）。 */
  bindings: z.dict(z.string()).default({}),
})

/** 需要"改了立刻生效"的字段清单（与 Config 里的 .volatile() 标记必须一致）。 */
export const VOLATILE_KEYS = [
  'payload',
  'enabled',
  'timeoutMs',
  'retry',
  'cooldownMs',
  'notifyComplete',
  'notifyApproval',
  'notifyQuestion',
  'notifyInterrupt',
  'jobAwareComplete',
  'onlyTopLevel',
  'includeTitle',
]
