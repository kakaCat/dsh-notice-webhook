/**
 * Host RPC：设置页与客户端服务读写的唯一通道（FR-2 / FR-8 / FR-10）。
 *
 * 挂法（沿用 Host 既有信任域，不新开鉴权面）：
 *   ctx.inject(['webServer'], webCtx => webCtx.effect(() => {
 *     webCtx.webServer.register({ kind: 'prefix', path: '/api/dsh-notice-webhook', handler })
 *   }))
 *
 * 契约见 docs/requirements/REQ-260930155231-0862/design/interfaces.md「Host RPC」。
 *
 * 三条纪律：
 * 1. **写先校验后落盘**：校验失败 400 且不动文件；落盘失败也 400（不谎报成功）。
 * 2. **revision 栅栏**：每次写返回新 revision；用过期 revision 写 → 409 + 最新状态。
 * 3. **密钥不出本进程**：secretRef 只回"是否已配置"，值只在 Host 内部被渠道打包时用。
 */
import { isValidSessionId } from './bindings.js'
import { CHANNELS_WITH_SECRET, EVENT_TYPES, validateTarget } from './targets.js'
import { channelMetaProjection, composeUrlFor } from './channels/meta.js'

/** 路由前缀（与 index.js 的注册一致）。 */
export const RPC_PREFIX = '/api/dsh-notice-webhook'

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** 目标 → 对客户端的投影（去掉密钥明文，secretRef 只给"是否已配置"）。 */
export function toTargetView(target) {
  const { secretRef, ...rest } = target
  return { ...rest, secretRef: secretRef !== undefined && secretRef.length > 0 ? secretRef : null, secretConfigured: secretRef !== undefined && secretRef.length > 0 }
}

/** 绑定 → 对客户端的投影（展开目标，页面不必再 JOIN）。 */
export function toBindingView(binding, targets) {
  return {
    sessionId: binding.sessionId,
    updatedAt: binding.updatedAt,
    targetIds: binding.targetIds,
    targets: binding.targetIds.map(id => targets.get(id)).filter(Boolean).map(t => ({ id: t.id, name: t.name, channel: t.channel, enabled: t.enabled })),
  }
}

/**
 * 组装一次完整状态（GET /state 的返回，也是每次写成功后回给客户端的最新态）。
 */
export function buildState(deps) {
  const secrets = {}
  for (const t of deps.targets.list()) {
    if (t.secretRef !== undefined && t.secretRef.length > 0 && CHANNELS_WITH_SECRET.includes(t.channel)) {
      secrets[t.secretRef] = typeof deps.resolveSecret === 'function' ? deps.resolveSecret(t.secretRef) !== undefined : false
    }
  }
  return {
    revision: deps.revision(),
    // 渠道元数据（含 help）：界面拿它渲染 label / keyLabel / 「怎么拿 key」，前端不硬编码文案
    channelMeta: channelMetaProjection(),
    // 文案：payloadDefaults = 插件配置里的默认值（界面用它当「默认文案」的基线）
    payloadDefaults: deps.payloadDefaults ?? null,
    targets: deps.targets.list().map(toTargetView),
    bindings: deps.bindings.listBindings().map(b => toBindingView(b, deps.targets)),
    defaults: deps.defaults(),
    outcomes: deps.outcomes.snapshot(),
    secrets,
  }
}

/**
 * 创建 RPC 处理器。
 *
 * @param deps.targets / deps.bindings / deps.outcomes / deps.defaults() / deps.revision() / deps.bumpRevision() /
 *        deps.resolveSecret? / deps.deliverTest(target) / deps.logger
 * @returns `(req, res) => Promise<void>`（挂在 webServer 的 prefix 注册下）
 */
export function createRpcHandler(deps) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.startsWith(RPC_PREFIX) ? url.pathname.slice(RPC_PREFIX.length) : url.pathname
    const method = req.method ?? 'GET'

    const reply = (status, body) => sendJson(res, status, body)

    try {
      // ── GET /state ────────────────────────────────────────────
      if (method === 'GET' && (path === '/state' || path === '/')) {
        return reply(200, buildState(deps))
      }

      // 其余 GET 路径一律 404（不认识的资源），不是 405（方法没错，是路径错了）
      if (method === 'GET') {
        return reply(404, { ok: false, reason: `未知端点：GET ${path}` })
      }

      // 其余都是写操作，先读 body
      if (method === 'POST') {
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          return reply(400, { ok: false, errors: ['请求体不是合法 JSON'] })
        }

        const fence = (expectedRevision) => {
          if (typeof body.revision !== 'number' || body.revision !== expectedRevision) {
            reply(409, { ok: false, reason: '配置已被其他页面修改', ...buildState(deps) })
            return false
          }
          return true
        }

        // ── POST /targets（新增/修改）───────────────────────────
        if (path === '/targets') {
          const current = deps.revision()
          if (!fence(current)) return
          const incoming = body.target
          if (incoming !== null && typeof incoming === 'object' && typeof incoming.key === 'string' && incoming.key.length > 0
            && typeof incoming.url === 'string' && incoming.url.length > 0) {
            const derived = composeUrlFor(incoming)
            if (derived !== incoming.url) {
              deps.logger?.warn?.(`[dsh-notice-webhook] rpc: 目标同时带了 key 与不一致的 url，以 key 为准（收到 ${incoming.url}，按 key 拼出 ${derived}）`)
            }
          }
          const verdict = deps.targets.save(incoming)
          if (!verdict.ok) return reply(400, { ok: false, errors: verdict.errors })
          deps.bumpRevision()
          // 追加返回刚保存的目标（含新生成的 id）：新建后界面要立刻能「发送测试」。
          // 这是**追加字段**，旧消费方只看 ok/targets 不受影响。
          return reply(200, { ok: true, target: toTargetView(verdict.target), ...buildState(deps) })
        }

        // ── POST /targets/delete ────────────────────────────────
        if (path === '/targets/delete') {
          const current = deps.revision()
          if (!fence(current)) return
          const id = body.id
          if (typeof id !== 'string' || id.length === 0 || deps.targets.get(id) === undefined) {
            return reply(404, { ok: false, reason: `目标不存在：${String(id)}` })
          }
          deps.targets.remove(id)
          deps.outcomes.forget(id)
          deps.bumpRevision()
          return reply(200, { ok: true, ...buildState(deps) })
        }

        // ── POST /test（投递一条固定测试通知，不改清单）───────────
        if (path === '/test') {
          const id = body.id
          const target = typeof id === 'string' ? deps.targets.get(id) : undefined
          if (target === undefined) return reply(404, { ok: false, reason: `目标不存在：${String(id)}` })
          const result = await deps.deliverTest(target)
          return reply(result.ok ? 200 : 502, result)
        }

        // ── POST /bind ──────────────────────────────────────────
        if (path === '/bind') {
          const current = deps.revision()
          if (!fence(current)) return
          const sessionId = body.sessionId
          const targetIds = body.targetIds
          if (!isValidSessionId(sessionId)) return reply(400, { ok: false, errors: ['sessionId 必须是非空字符串'] })
          if (!Array.isArray(targetIds)) return reply(400, { ok: false, errors: ['targetIds 必须是数组'] })
          for (const id of targetIds) {
            if (typeof id !== 'string' || deps.targets.get(id) === undefined) {
              return reply(400, { ok: false, errors: [`目标不存在：${String(id)}`] })
            }
          }
          deps.bindings.bindTargets(sessionId, targetIds)
          deps.bumpRevision()
          return reply(200, { ok: true, ...buildState(deps) })
        }

        // ── POST /bindings/delete（解绑，回落默认组）─────────────
        if (path === '/bindings/delete') {
          const current = deps.revision()
          if (!fence(current)) return
          const sessionId = body.sessionId
          if (!isValidSessionId(sessionId)) return reply(400, { ok: false, errors: ['sessionId 必须是非空字符串'] })
          const removed = deps.bindings.unbindTargets(sessionId)
          if (!removed) return reply(404, { ok: false, reason: `该会话本无绑定：${sessionId}` })
          deps.bumpRevision()
          return reply(200, { ok: true, ...buildState(deps) })
        }

        return reply(404, { ok: false, reason: `未知端点：POST ${path}` })
      }

      return reply(405, { ok: false, reason: `不支持的请求：${method} ${path}` })
    } catch (error) {
      deps.logger?.warn?.(`[dsh-notice-webhook] rpc: ${String(error?.message ?? error)}`)
      try {
        reply(500, { ok: false, reason: '服务器内部错误' })
      } catch {
        /* 连响应都写不出就放弃 */
      }
    }
  }
}
