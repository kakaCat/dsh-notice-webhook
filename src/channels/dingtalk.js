/**
 * 渠道适配器：钉钉自定义机器人。
 *
 * 报文：`{ msgtype: 'markdown', markdown: { title, text } }`
 * 加签：开启时在 URL query 追加 `timestamp` 与 `sign`，
 *       `sign = base64(hmacSHA256(secret, `${timestamp}\n${secret}`))`（钉钉文档口径）。
 * 成功判定：HTTP 2xx **且** `errcode === 0`。
 */
import { createHmac } from 'node:crypto'

export const id = 'dingtalk'

/** 钉钉加签：返回 `{ timestamp, sign }`；secret 缺失时返回 undefined。 */
export function signRequest(secret, now) {
  if (typeof secret !== 'string' || secret.length === 0) return undefined
  const timestamp = String(now)
  const stringToSign = `${timestamp}\n${secret}`
  const sign = createHmac('sha256', secret).update(stringToSign, 'utf8').digest('base64')
  return { timestamp, sign }
}

export function buildRequest({ target, intent, secret, now, contextText }) {
  // 原有文案 + 上下文行（无上下文时与原报文完全一致）
  const text = withContext(intent, contextText)
  const body = JSON.stringify({
    msgtype: 'markdown',
    markdown: { title: intent.title ?? 'DSH 通知', text: text },
  })

  let url = target.url
  const signature = signRequest(secret, now)
  if (signature !== undefined) {
    const separator = url.includes('?') ? '&' : '?'
    url = `${url}${separator}timestamp=${encodeURIComponent(signature.timestamp)}&sign=${encodeURIComponent(signature.sign)}`
  }

  return { url, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body }
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
  return parseKeyFrom('dingtalk', url)
}
