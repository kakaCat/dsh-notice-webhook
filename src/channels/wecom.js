/**
 * 渠道适配器：企业微信机器人（群机器人 webhook）。
 *
 * 报文：`{ msgtype: 'markdown', markdown: { content } }`
 * 成功判定：HTTP 2xx **且** `errcode === 0`——企业微信在 HTTP 200 时也可能返回业务错误码，
 * 只看状态码会把"没发出去"记成成功。
 */
export const id = 'wecom'

export function buildRequest({ target, intent, contextText }) {
  // 原有文案 + 上下文行（无上下文时与原报文完全一致）
  const text = withContext(intent, contextText)
  return {
    url: target.url,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content: text } }),
  }
}

export function isSuccess(status, parsed) {
  if (!(status >= 200 && status < 300)) return { ok: false, reason: `http-status ${status}` }
  const code = parsed?.errcode
  if (typeof code === 'number' && code !== 0) {
    const detail = typeof parsed?.errmsg === 'string' && parsed.errmsg.length > 0 ? ` ${parsed.errmsg}` : ''
    return { ok: false, reason: `errcode ${code}${detail}` }
  }
  return { ok: true }
}

/* ── URL 组装与反解（本轮新增；实现集中在 meta.js，这里只做本渠道的薄封装） ── */

import { withContext } from '../payload.js'
import { composeUrlFor, parseKeyFrom } from './meta.js'

/** 由目标拼出完整地址（纯函数，不抛异常）。 */
export function composeUrl(target) {
  return composeUrlFor(target)
}

/** 从完整地址反解 key；反解不出返回 undefined（不抛异常）。 */
export function parseKey(url) {
  return parseKeyFrom('wecom', url)
}
