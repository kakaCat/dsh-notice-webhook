/**
 * 目标清单：一个目标 = 一个具体落点（渠道 + 地址 + 凭据引用 + 开关 + 关心的事件）。
 *
 * 为什么单独存一份自有文件（而不是塞进插件 Config）：
 * - 目标清单是**运行时集合**（频繁增删），写进 profile 的 YAML 会膨胀且与"配置文件"的语义打架；
 * - 需要列表级校验（id 唯一、渠道×字段交叉约束），这是 Config schema 的单个字段表达不了的。
 *
 * 读写纪律与既有 bindings.json 完全同口径：原子写、坏文件不覆盖、单条非法只跳过该条。
 *
 * 契约见 docs/requirements/REQ-260930155231-0862/design/data-model.md。
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { isValidEndpoint } from './bindings.js'
import { canParseKey, composeUrlFor, isKeyInput, parseKeyFrom, validateKey } from './channels/meta.js'

/** 目标清单文件的格式版本。 */
export const TARGET_FILE_VERSION = 3

/** 受支持的渠道（与 src/channels/index.js 的注册表一致）。 */
export const CHANNELS = ['wecom', 'feishu', 'dingtalk', 'slack', 'discord', 'custom']

/** 受支持的事件取值；`goal/*` 覆盖 goal 的各类终态。 */
export const EVENT_TYPES = ['turn/end', 'approval/asked', 'ask_user_question', 'goal/*', 'turn/error']

/**
 * 改动前 UI「全选」写出的**唯一**形态（四个事件）。
 *
 * 为什么记着它：那时「全选」被物化成了显式白名单，而本次新增的 `turn/error` 不在其中——
 * 若不管，所有既有目标都会把中断通知**静默过滤掉**。载入时把「恰等于这份全集」的记录
 * 归一化为**全收**（见 normalizeEvents），既保住老用户的「我全要」，又不影响明确勾选子集的人。
 */
export const LEGACY_ALL_EVENTS = ['turn/end', 'ask_user_question', 'approval/asked', 'goal/*']

/** 关心事件的两种语义：`all` = 全收（含未来新增事件）；`explicit` = 只收列表里的，永不自动追加。 */
export const EVENTS_MODE_ALL = 'all'
export const EVENTS_MODE_EXPLICIT = 'explicit'
const EVENTS_MODES = [EVENTS_MODE_ALL, EVENTS_MODE_EXPLICIT]

/** 两个事件列表是否**集合相等**（顺序无关、去重后比较）。 */
function sameEventSet(a, b) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  if (set.size !== b.length) return false
  return b.every(event => set.has(event))
}

/**
 * 归一化「关心事件」：把列表与模式收敛成一对自洽的值（幂等）。
 *
 * - `'all'`：全收 → 列表清空（未来新增事件自动包含）
 * - `'explicit'`：只收列表里的（**列表为空 = 什么都不收**，不是全收）
 * - 缺省（本次改动前的记录 / 旧客户端）：列表为空、或恰等于 `LEGACY_ALL_EVENTS` → 按全收；否则按显式
 *
 * @param rawEvents - 记录上的 `events`
 * @param rawMode - 记录上的 `eventsMode`
 * @returns `{ events, eventsMode }`
 */
export function normalizeEvents(rawEvents, rawMode) {
  const events = Array.isArray(rawEvents) ? rawEvents.filter(event => typeof event === 'string') : []
  const mode = EVENTS_MODES.includes(rawMode) ? rawMode : undefined
  if (mode === EVENTS_MODE_ALL) return { events: [], eventsMode: EVENTS_MODE_ALL }
  if (mode === EVENTS_MODE_EXPLICIT) return { events: [...new Set(events)], eventsMode: EVENTS_MODE_EXPLICIT }
  if (events.length === 0) return { events: [], eventsMode: EVENTS_MODE_ALL }
  if (sameEventSet(events, LEGACY_ALL_EVENTS)) return { events: [], eventsMode: EVENTS_MODE_ALL }
  return { events: [...new Set(events)], eventsMode: EVENTS_MODE_EXPLICIT }
}

/** 只有这两个渠道会用到加签密钥。 */
export const CHANNELS_WITH_SECRET = ['feishu', 'dingtalk']

/** 目标清单的默认路径：`$DSH_HOME/state/dsh-notice-webhook/targets.json`。 */
export function targetsFilePath(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(process.env.HOME ?? '', '.dsh')
  return join(home, 'state', 'dsh-notice-webhook', 'targets.json')
}

function warnWith(logger, message) {
  try {
    const sink = logger ?? console
    if (typeof sink.warn === 'function') sink.warn(`[dsh-notice-webhook] targets: ${message}`)
  } catch {
    /* 记日志失败不影响清单读写 */
  }
}

/** 由名称生成 id：保留可读性 + 短随机后缀保证唯一。 */
export function makeTargetId(name, taken = new Set()) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const base = slug.length > 0 ? slug : 'target'
  for (let i = 0; i < 50; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 6)
    const id = `${base}-${suffix}`.slice(0, 40)
    if (!taken.has(id)) return id
  }
  return `target-${Date.now().toString(36)}`
}

/**
 * 校验「文案」覆盖（全局与每目标共用一套口径）。
 *
 * @returns `{ ok: true, value }` 或 `{ ok: false, errors }`；null 表示跟随上一层（不是错误）。
 */
export function validatePayload(input) {
  if (input === null || input === undefined) return { ok: true, value: null }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['文案必须是对象或 null（null = 跟随全局）'] }
  }
  const errors = []
  const value = {}
  if (input.fields !== undefined) {
    if (!Array.isArray(input.fields)) errors.push('文案字段必须是数组')
    else value.fields = input.fields.filter(field => typeof field === 'string')
  }
  if (input.promptChars !== undefined) {
    if (typeof input.promptChars !== 'number' || !Number.isFinite(input.promptChars) || input.promptChars < 0) {
      errors.push('摘要长度必须是非负数字')
    } else value.promptChars = input.promptChars
  }
  for (const field of ['workspaceStyle', 'timeFormat', 'linkUrl', 'template']) {
    if (input[field] === undefined) continue
    if (typeof input[field] !== 'string') errors.push(`文案 ${field} 必须是字符串`)
    else value[field] = input[field]
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

/**
 * 校验一条目标（新增或修改）。
 *
 * @returns `{ ok: true, target }` 或 `{ ok: false, errors: string[] }`
 */
export function validateTarget(input, options = {}) {
  const errors = []
  const taken = options.taken ?? new Set()
  const isUpdate = options.isUpdate === true

  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (name.length === 0) errors.push('名称不能为空')
  if (name.length > 60) errors.push('名称不能超过 60 字')

  const channel = input?.channel
  if (!CHANNELS.includes(channel)) errors.push(`渠道必须是 ${CHANNELS.join(' / ')} 之一`)

  // 地址来源：只填 key 的渠道由前缀拼装；其余渠道仍要求整条地址
  const rawUrl = typeof input?.url === 'string' ? input.url.trim() : ''
  const rawKey = typeof input?.key === 'string' ? input.key.trim() : ''
  let key
  let url
  if (CHANNELS.includes(channel) && isKeyInput(channel)) {
    if (rawKey.length > 0) {
      const verdict = validateKey(channel, rawKey)
      if (verdict.ok) { key = rawKey; url = composeUrlFor({ channel, key: rawKey }) } else errors.push(verdict.error)
    } else if (isValidEndpoint(rawUrl)) {
      // 遗留记录（老数据反解不出 key 或用户手改过地址）：保留原地址直投，不猜
      url = rawUrl
    } else {
      errors.push(validateKey(channel, '').error)
    }
  } else {
    url = rawUrl
    if (!isValidEndpoint(url)) errors.push('地址必须是 http/https 绝对地址')
  }

  let secretRef
  if (input?.secretRef !== undefined && input.secretRef !== null && String(input.secretRef).length > 0) {
    if (!CHANNELS_WITH_SECRET.includes(channel)) errors.push('只有飞书 / 钉钉支持加签密钥')
    else secretRef = String(input.secretRef)
  }

  let headers
  if (input?.headers !== undefined && input.headers !== null) {
    if (channel !== 'custom') errors.push('只有通用自定义渠道支持自定义请求头')
    else if (typeof input.headers !== 'object' || Array.isArray(input.headers)) errors.push('自定义请求头必须是对象')
    else headers = { ...input.headers }
  }

  const rawEvents = Array.isArray(input?.events) ? input.events.filter(e => typeof e === 'string') : []
  for (const event of rawEvents) {
    if (!EVENT_TYPES.includes(event)) errors.push(`不认识的关心事件：${event}`)
  }
  // 列表 + 模式 → 自洽的一对值：空列表的两种含义（全收 / 什么都不收）靠 eventsMode 区分
  const { events, eventsMode } = normalizeEvents(rawEvents, input?.eventsMode)

  const enabled = input?.enabled === undefined ? true : input.enabled === true
  const isDefault = input?.isDefault === true

  // 每目标文案覆盖（方案 C）：null / 缺省 = 跟随全局
  let payload = null
  if (input?.payload !== undefined && input?.payload !== null) {
    const verdict = validatePayload(input.payload)
    if (!verdict.ok) errors.push(...verdict.errors)
    else payload = verdict.value
  }

  let id
  if (isUpdate) {
    id = String(input.id)
    if (id.length === 0) errors.push('修改目标时必须带 id')
  } else {
    id = makeTargetId(name, taken)
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    target: {
      id,
      name,
      channel,
      url,
      ...(key === undefined ? {} : { key }),
      ...(secretRef === undefined ? {} : { secretRef }),
      ...(headers === undefined ? {} : { headers }),
      enabled,
      events,
      eventsMode,
      isDefault,
      // null = 跟随全局文案；非 null = 这个目标自己的文案
      payload,
    },
  }
}

/** 尝试把 v1 记录（只有整条 url）升级为 v2（带 key）；反解不出则原样保留（直投）。 */
function migrateV1Record(record, logger) {
  const url = typeof record?.url === 'string' ? record.url : ''
  const channel = record?.channel
  if (!canParseKey(channel)) return record
  const key = parseKeyFrom(channel, url)
  if (key === undefined) {
    warnWith(logger, `目标 ${JSON.stringify(record?.id ?? record?.name ?? '?')} 的地址无法按 ${channel} 前缀反解出 key，保留原地址直投`)
    return record
  }
  return { ...record, key }
}

export class TargetStore {
  #targets = new Map()
  #path
  #logger

  /** @param options.path - 清单文件路径（缺省走 $DSH_HOME；单测传临时路径） */
  constructor(options = {}) {
    this.#path = options.path ?? targetsFilePath()
    this.#logger = options.logger
  }

  get path() {
    return this.#path
  }

  /**
   * 读回清单。永不抛异常；坏文件/未知版本 → 空清单且**不覆盖原文件**。
   */
  load() {
    this.#targets.clear()
    let raw
    try {
      raw = readFileSync(this.#path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') warnWith(this.#logger, `读取目标清单失败（${this.#path}）：${String(error?.message ?? error)}`)
      return this
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      warnWith(this.#logger, `目标清单不是合法 JSON，已按空清单启动且不覆盖原文件：${this.#path}`)
      return this
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnWith(this.#logger, '目标清单结构不是对象，已按空清单启动且不覆盖原文件')
      return this
    }
    // v1 / v2 都算旧版：读进来补默认值并升到当前版本
    const isV1 = parsed.version === 1
    const isLegacy = isV1 || parsed.version === 2
    if (!isLegacy && parsed.version !== TARGET_FILE_VERSION) {
      warnWith(this.#logger, `目标清单版本不认识（${JSON.stringify(parsed.version)}），已按空清单启动且不覆盖原文件`)
      return this
    }
    if (!Array.isArray(parsed.targets)) {
      warnWith(this.#logger, '目标清单缺少 targets 数组，已按空清单启动')
      return this
    }

    for (const record of parsed.targets) {
      const raw = isV1 ? migrateV1Record(record, this.#logger) : record
      // v2 及更早没有「每目标文案」概念：补 null（跟随全局）
      const verdict = validateTarget(raw, { isUpdate: raw?.id !== undefined })
      if (!verdict.ok) {
        warnWith(this.#logger, `跳过非法目标记录 ${JSON.stringify(raw?.id ?? raw?.name ?? '?')}：${verdict.errors.join('；')}`)
        continue
      }
      const target = { ...verdict.target, id: String(raw.id) }
      if (this.#targets.has(target.id)) {
        warnWith(this.#logger, `目标 id 重复，只保留第一条：${target.id}`)
        continue
      }
      this.#targets.set(target.id, target)
    }
    if (isLegacy) {
      // 旧文件读成功后立即升到当前版本落盘（v1 反解不出 key 的条目保留原 url 直投）
      this.#persist()
      warnWith(this.#logger, `目标清单已从 v${parsed.version} 升级为 v${TARGET_FILE_VERSION}（${this.#targets.size} 条）`)
    }
    return this
  }

  /** 全部目标（按 name 升序，便于人读）。 */
  list() {
    return [...this.#targets.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  /** 取一个目标。 */
  get(id) {
    return this.#targets.get(id)
  }

  /**
   * 新增或修改（带 id 视为修改）。
   * @returns `{ ok: true, target }` 或 `{ ok: false, errors }`；失败**不落盘**
   */
  save(input) {
    const isUpdate = typeof input?.id === 'string' && input.id.length > 0
    if (isUpdate && !this.#targets.has(input.id)) {
      return { ok: false, errors: [`目标不存在：${input.id}`] }
    }
    const previous = isUpdate ? this.#targets.get(input.id) : undefined
    const verdict = validateTarget(input, { isUpdate, taken: new Set(this.#targets.keys()) })
    if (!verdict.ok) return verdict

    this.#targets.set(verdict.target.id, verdict.target)
    const persisted = this.#persist()
    if (!persisted) {
      // 落盘失败 → 回滚内存，避免"界面显示成功、重启后消失"
      if (previous !== undefined) this.#targets.set(previous.id, previous)
      else this.#targets.delete(verdict.target.id)
      return { ok: false, errors: ['配置未写入（文件不可写）'] }
    }
    return verdict
  }

  /** 删除。 */
  remove(id) {
    if (!this.#targets.delete(id)) return false
    this.#persist()
    return true
  }

  /** 启停（等价于保存该目标，只改 enabled）。 */
  setEnabled(id, enabled) {
    const current = this.#targets.get(id)
    if (current === undefined) return { ok: false, errors: [`目标不存在：${id}`] }
    return this.save({ ...current, enabled: enabled === true })
  }

  /** 原子写盘（tmp → rename）；失败返回 false（调用方负责回滚内存）。 */
  #persist() {
    const payload = { version: TARGET_FILE_VERSION, targets: [...this.#targets.values()] }
    const tmp = `${this.#path}.tmp`
    try {
      mkdirSync(dirname(this.#path), { recursive: true })
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      renameSync(tmp, this.#path)
      return true
    } catch (error) {
      warnWith(this.#logger, `写入目标清单失败：${String(error?.message ?? error)}`)
      try {
        unlinkSync(tmp)
      } catch {
        /* 清理失败无需再报 */
      }
      return false
    }
  }
}
