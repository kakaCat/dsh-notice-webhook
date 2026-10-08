/**
 * 渠道适配器：Slack Incoming Webhook。
 *
 * 报文：`{ text }`；成功判定：HTTP 2xx。
 */
export const id = 'slack'

export function buildRequest({ target, intent, contextText }) {
  // 原有文案 + 上下文行（无上下文时与原报文完全一致）
  const text = withContext(intent, contextText)
  return {
    url: target.url,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text }),
  }
}

export function isSuccess(status) {
  return status >= 200 && status < 300 ? { ok: true } : { ok: false, reason: `http-status ${status}` }
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
  return parseKeyFrom('slack', url)
}
