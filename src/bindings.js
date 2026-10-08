/**
 * 会话窗口 → webhook 地址的绑定表，以及它的原子持久化。
 *
 * 为什么单独成模块：绑定是**唯一**需要跨 Host 重启存活的状态（FR-9），
 * 而"重启后绑定丢了"比"重启后少推一条通知"严重得多——所以读取一律**宁可空表，不可猜**：
 * 文件损坏或版本不认识时回落空表并告警，且**不覆盖原文件**（给人工抢救留机会）。
 *
 * 契约见 docs/requirements/REQ-260930123701-250a/design/data-model.md。
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 绑定文件的格式版本；升版本时必须让老文件走"未知版本 → 空表"分支。 */
export const FILE_VERSION = 1

/** 绑定文件的默认路径：`$DSH_HOME/state/dsh-notice-webhook/bindings.json`。 */
export function bindingsFilePath(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'state', 'dsh-notice-webhook', 'bindings.json')
}

/** 会话标识合法性：非空且非纯空白（`'   '` 不是真实会话 id）。 */
export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && sessionId.trim().length > 0
}

/** 地址合法性：必须是能被 URL 解析的 http/https 绝对地址。 */
export function isValidEndpoint(url) {
  if (typeof url !== 'string' || url.length === 0) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function warnWith(logger, message) {
  try {
    const sink = logger ?? console
    if (typeof sink.warn === 'function') sink.warn(`[dsh-notice-webhook] bindings: ${message}`)
  } catch {
    /* 记日志失败不影响绑定表 */
  }
}

export class BindingStore {
  /** sessionId → { url, updatedAt }（旧版单地址绑定，v1 语义，回滚兼容用） */
  #entries = new Map()
  /** sessionId → { targetIds: string[], updatedAt }（多目标绑定，REQ-260930155231-0862 FR-5） */
  #targetEntries = new Map()
  #path
  #logger

  /**
   * @param options.path - 绑定文件路径（缺省走 $DSH_HOME；单测传临时路径）
   * @param options.logger - 告警出口
   */
  constructor(options = {}) {
    this.#path = options.path ?? bindingsFilePath()
    this.#logger = options.logger
  }

  /** 绑定文件路径（排查用）。 */
  get path() {
    return this.#path
  }

  /**
   * 读回绑定表。永不抛异常。
   *
   * 容错口径（与设计文档逐条对应）：
   * - 文件不存在 → 空表，且**不创建**文件；
   * - 非法 JSON / 未知 version → 告警 + 空表，且**不覆盖**原文件；
   * - 单条记录字段非法 → 跳过该条并告警，其余照常加载。
   */
  load() {
    this.#entries.clear()
    let raw
    try {
      raw = readFileSync(this.#path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') warnWith(this.#logger, `读取绑定文件失败（${this.#path}）：${String(error?.message ?? error)}`)
      return this
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      warnWith(this.#logger, `绑定文件不是合法 JSON，已按空表启动且不覆盖原文件：${this.#path}`)
      return this
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnWith(this.#logger, '绑定文件结构不是对象，已按空表启动且不覆盖原文件')
      return this
    }
    if (parsed.version !== FILE_VERSION) {
      warnWith(this.#logger, `绑定文件版本不认识（${JSON.stringify(parsed.version)}），已按空表启动且不覆盖原文件`)
      return this
    }
    const table = parsed.bindings
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      warnWith(this.#logger, '绑定文件缺少 bindings 对象，已按空表启动')
      return this
    }

    for (const [sessionId, entry] of Object.entries(table)) {
      const url = entry?.url
      if (typeof sessionId !== 'string' || sessionId.length === 0 || !isValidEndpoint(url) || !isValidSessionId(sessionId)) {
        warnWith(this.#logger, `跳过非法绑定记录 ${JSON.stringify(sessionId)}（地址必须为 http/https 绝对地址）`)
        continue
      }
      this.#entries.set(sessionId, { url, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString() })
    }

    // 多目标绑定段（可选，老文件没有这段 → 空表，不算损坏）
    const targetTable = parsed.targetBindings
    if (targetTable !== undefined) {
      if (targetTable === null || typeof targetTable !== 'object' || Array.isArray(targetTable)) {
        warnWith(this.#logger, 'targetBindings 段不是对象，已按空表加载该段（其余照常）')
      } else {
        for (const [sessionId, entry] of Object.entries(targetTable)) {
          const ids = Array.isArray(entry?.targetIds) ? entry.targetIds.filter(id => typeof id === 'string' && id.length > 0) : []
          if (!isValidSessionId(sessionId)) {
            warnWith(this.#logger, `跳过非法多目标绑定记录 ${JSON.stringify(sessionId)}`)
            continue
          }
          this.#targetEntries.set(sessionId, {
            targetIds: ids,
            updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
          })
        }
      }
    }
    return this
  }

  /**
   * 绑定（覆盖旧值）。参数非法时返回 false 且不写表。
   * @returns 是否写入
   */
  bind(sessionId, url) {
    if (!isValidSessionId(sessionId)) {
      warnWith(this.#logger, 'bind 被拒：sessionId 必须是非空字符串')
      return false
    }
    if (!isValidEndpoint(url)) {
      warnWith(this.#logger, `bind 被拒：url 必须是 http/https 绝对地址（收到 ${JSON.stringify(url)}）`)
      return false
    }
    this.#entries.set(sessionId, { url, updatedAt: new Date().toISOString() })
    this.#persist()
    return true
  }

  /** 解绑（v1 语义）：同时清掉旧 url 绑定与多目标绑定——"解绑"对使用者只有一种含义。 */
  unbind(sessionId) {
    if (!isValidSessionId(sessionId)) return false
    const existedUrl = this.#entries.delete(sessionId)
    const existedTargets = this.#targetEntries.delete(sessionId)
    if (existedUrl || existedTargets) this.#persist()
    return existedUrl || existedTargets
  }

  // ── 多目标绑定（REQ-260930155231-0862 FR-5：绑定即替代默认组，不叠加） ──

  /**
   * 多目标绑定：把会话绑到若干目标 id（覆盖旧值）。
   * @param targetIds - 目标 id 数组；空数组等价于 unbindTargets
   * @returns 是否写入
   */
  bindTargets(sessionId, targetIds) {
    if (!isValidSessionId(sessionId)) {
      warnWith(this.#logger, 'bindTargets 被拒：sessionId 必须是非空字符串')
      return false
    }
    if (!Array.isArray(targetIds) || targetIds.some(id => typeof id !== 'string' || id.length === 0)) {
      warnWith(this.#logger, 'bindTargets 被拒：targetIds 必须是非空字符串数组')
      return false
    }
    const deduped = [...new Set(targetIds)]
    if (deduped.length === 0) return this.unbindTargets(sessionId)
    this.#targetEntries.set(sessionId, { targetIds: deduped, updatedAt: new Date().toISOString() })
    // 同步旧段为第一个目标地址的来源标记不可知（地址在目标侧），此处只维护多目标段；
    // 旧段由 unbind 语义兜底（见 unbindTargets）。
    this.#persist()
    return true
  }

  /**
   * 解绑多目标绑定（三方解除专用；同时清掉旧 url 绑定，与 unbind 语义一致）。
   * @returns 是否真的删掉了一条
   */
  unbindTargets(sessionId) {
    if (!isValidSessionId(sessionId)) return false
    const existedTargets = this.#targetEntries.delete(sessionId)
    const existedUrl = this.#entries.delete(sessionId)
    if (existedTargets || existedUrl) this.#persist()
    return existedTargets || existedUrl
  }

  /** 某会话的多目标绑定（没有返回空数组）。 */
  targetIdsOf(sessionId) {
    return isValidSessionId(sessionId) ? [...(this.#targetEntries.get(sessionId)?.targetIds ?? [])] : []
  }

  /** 全部多目标绑定（升序，供界面/服务展示）。 */
  listBindings() {
    return [...this.#targetEntries.entries()]
      .map(([sessionId, entry]) => ({ sessionId, targetIds: [...entry.targetIds], updatedAt: entry.updatedAt }))
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
  }

  /** 全部绑定，按 sessionId 升序（人读与 diff 友好）。 */
  list() {
    return [...this.#entries.entries()]
      .map(([sessionId, entry]) => ({ sessionId, url: entry.url, updatedAt: entry.updatedAt }))
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
  }

  /**
   * 解析某会话将使用的目标。
   * @param sessionId - 会话窗口标识
   * @param defaultUrl - 未绑定时使用的默认地址（可为空）
   * @returns `{ url, source }`；既无绑定也无默认地址时返回 null
   */
  resolve(sessionId, defaultUrl) {
    const bound = isValidSessionId(sessionId) ? this.#entries.get(sessionId) : undefined
    if (bound !== undefined) return { url: bound.url, source: 'binding' }
    if (isValidEndpoint(defaultUrl)) return { url: defaultUrl, source: 'default' }
    return null
  }

  /**
   * 原子写盘：先写 `.tmp` 再 rename（进程被杀不会留下半个 JSON）。
   * 写失败只告警：绑定在内存里照常生效，重启后才会丢。
   * @returns 是否写成功
   */
  #persist() {
    const payload = {
      version: FILE_VERSION,
      bindings: Object.fromEntries([...this.#entries.entries()].map(([sessionId, entry]) => [sessionId, { url: entry.url, updatedAt: entry.updatedAt }])),
      // 多目标段：老版本读文件时忽略未知顶层键（回滚安全），新版本读它
      targetBindings: Object.fromEntries([...this.#targetEntries.entries()].map(([sessionId, entry]) => [sessionId, { targetIds: [...entry.targetIds], updatedAt: entry.updatedAt }])),
    }
    const tmp = `${this.#path}.tmp`
    try {
      mkdirSync(dirname(this.#path), { recursive: true })
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      renameSync(tmp, this.#path)
      return true
    } catch (error) {
      warnWith(this.#logger, `写入绑定文件失败（本次仅在内存生效）：${String(error?.message ?? error)}`)
      try {
        unlinkSync(tmp)
      } catch {
        /* 清理失败无需再报 */
      }
      return false
    }
  }
}
