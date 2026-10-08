/**
 * 渠道适配器：通用自定义（原样 JSON）。
 *
 * 这是**既有 v1 契约的保底通道**（FR-9）：没适配的平台今天就能用，也是老配置的等价落点。
 * 报文与既有版本逐字段一致；额外带 `target.headers`（自定义请求头，鉴权用）。
 */
export const id = 'custom'

/** 出站契约版本（新增字段/取值属追加式，不升版本；改字段语义才升）。 */
export const PAYLOAD_VERSION = 1

/** 组装 v1 载荷（也供其他渠道复用它拿到统一的通知上下文）。 */
export function buildPayload({ intent, session, title, now, contextText }) {
  return {
    version: PAYLOAD_VERSION,
    event: intent.event,
    // v1 契约字段：**原文不变**（改文本会破坏既有消费方）
    message: intent.message,
    // 追加字段：上下文行（会话/工作区/摘要/时间/链接）；无上下文时为 null
    context: typeof contextText === 'string' && contextText.length > 0 ? contextText : null,
    title: title ?? null,
    toolName: intent.toolName ?? null,
    goal: intent.goal ?? null,
    // 中断意图专属（REQ-261001203114-19b6 FR-3）：**仅中断追加**，其余事件键集合逐字节不变。
    // `reason` = 终态名；`error` = 错误事实（非 error 终态为 null）。
    ...(intent.kind === 'interrupt' ? { reason: intent.reason ?? null, error: intent.error ?? null } : {}),
    sessionId: session?.id ?? null,
    workspace: session?.workspace ?? null,
    at: new Date(now).toISOString(),
    source: 'dsh-notice-webhook',
  }
}

export function buildRequest({ target, intent, session, title, now, contextText }) {
  return {
    url: target.url,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(target.headers ?? {}),
    },
    // contextText 要**转传**给 buildPayload，否则上下文行会在这里被丢掉
    body: JSON.stringify(buildPayload({ intent, session, title, now, contextText })),
  }
}

export function isSuccess(status) {
  return status >= 200 && status < 300 ? { ok: true } : { ok: false, reason: `http-status ${status}` }
}

/* ── URL 组装与反解（本轮新增；实现集中在 meta.js，这里只做本渠道的薄封装） ── */

import { composeUrlFor, parseKeyFrom } from './meta.js'

/** 由目标拼出完整地址（纯函数，不抛异常）。 */
export function composeUrl(target) {
  return composeUrlFor(target)
}

/** 从完整地址反解 key；反解不出返回 undefined（不抛异常）。 */
export function parseKey(url) {
  return parseKeyFrom('custom', url)
}
