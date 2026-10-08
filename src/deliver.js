/**
 * webhook 投递层：发出去、等得到、失败不吵人。
 *
 * 三条硬纪律（FR-4）：
 * 1. **不阻塞会话** —— 调用方 fire-and-forget，本模块只返回结果不抛异常；
 * 2. **不跟随重定向** —— `redirect: 'manual'`，否则 `Authorization` 会被带到非预期主机；
 * 3. **凭据不进日志** —— 只记 host，不记完整 URL（query 里常带 token）与 headers。
 *
 * 契约见 docs/requirements/REQ-260930123701-250a/design/interfaces.md「出站 Webhook 契约」。
 */

/** 把地址压成可安全入日志的形态（只留 host）。 */
export function endpointHost(url) {
  try {
    return new URL(url).host
  } catch {
    return '(无效地址)'
  }
}

function warnWith(logger, message) {
  try {
    const sink = logger ?? console
    if (typeof sink.warn === 'function') sink.warn(`[dsh-notice-webhook] deliver: ${message}`)
  } catch {
    /* 记日志失败不影响投递结果 */
  }
}

/** 该状态码是否值得重试：只有 5xx 是"服务端可能一会儿就好"。 */
function isRetryableStatus(status) {
  return status >= 500
}

/**
 * 读取并解析响应体（判定业务错误码用：企微/飞书/钉钉 HTTP 200 也可能带 errcode≠0）。
 * 解析失败返回 undefined。永远不把响应体写进日志。
 */
async function parseResponseBody(response) {
  try {
    const text = await response.text()
    if (text.length === 0) return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 投递一条通知。
 *
 * @param endpoint - http/https 绝对地址
 * @param payload - 请求体：对象（会被 JSON 序列化）或**已序列化的字符串**（渠道层给的）
 * @param options - `{ timeoutMs, retry, headers, logger }`
 * @returns `{ ok, status?, parsed?, attempts, error? }` —— **永不抛异常**；
 *          `parsed` 是已解析的响应体（供业务码判定），网络层失败时为 undefined
 */
export async function deliver(endpoint, payload, options = {}) {
  const { timeoutMs = 5000, retry = 0, headers = {}, logger } = options
  const maxAttempts = Math.max(1, 1 + retry)
  const requestHeaders = { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  let body
  if (typeof payload === 'string') {
    body = payload
  } else {
    try {
      body = JSON.stringify(payload)
    } catch (error) {
      warnWith(logger, `请求体无法序列化：${String(error?.message ?? error)}`)
      return { ok: false, attempts: 0, error: 'payload-not-serializable' }
    }
  }

  let attempts = 0
  let lastError = 'unknown'

  while (attempts < maxAttempts) {
    attempts += 1
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status, parsed: await parseResponseBody(response), attempts }
      }

      lastError = `http-status ${response.status}`
      if (!(isRetryableStatus(response.status) && attempts < maxAttempts)) {
        // 4xx（地址错 / 鉴权错）与 3xx（不跟随重定向）重试也不会变好，直接放弃
        warnWith(logger, `投递失败（${endpointHost(endpoint)}）：${lastError}，已尝试 ${attempts} 次`)
        return { ok: false, status: response.status, parsed: await parseResponseBody(response), attempts, error: lastError }
      }
    } catch (error) {
      const name = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network'
      lastError = `${name}: ${String(error?.message ?? error)}`
      if (attempts >= maxAttempts) {
        warnWith(logger, `投递失败（${endpointHost(endpoint)}）：${lastError}，已尝试 ${attempts} 次`)
        return { ok: false, attempts, error: lastError }
      }
    }
  }

  warnWith(logger, `投递失败（${endpointHost(endpoint)}）：${lastError}，已尝试 ${attempts} 次`)
  return { ok: false, attempts, error: lastError }
}
