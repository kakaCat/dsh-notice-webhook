/**
 * 渠道适配器：飞书自定义机器人。
 *
 * 报文：`{ msg_type: 'interactive', card }`（交互式卡片；无上下文时兼容发纯文本）
 * 加签：开启时在**请求体**里加 `timestamp` 与 `sign`，
 *       `sign = base64(hmacSHA256(`${timestamp}\n${secret}`, ''))`（飞书文档口径）。
 * 成功判定：HTTP 2xx **且**（没有 `code` 字段 或 `code === 0`）。
 */
import { createHmac } from 'node:crypto'

export const id = 'feishu'

/** 飞书加签：返回 `{ timestamp, sign }`；secret 缺失时返回 undefined。 */
export function signRequest(secret, now) {
  if (typeof secret !== 'string' || secret.length === 0) return undefined
  const timestamp = String(now)
  const sign = createHmac('sha256', `${timestamp}\n${secret}`).update('', 'utf8').digest('base64')
  return { timestamp, sign }
}

/**
 * 会话 id 用飞书的**文本标签**渲染：`<text_tag color='blue'>#xxxxxx</text_tag>`。
 *
 * 为什么不用 `（#xxxxxx）` 纯文本：飞书卡片的 `lark_md` 里标签才会渲染成彩色小块，
 * 纯文本括号在卡片里既不显眼、用户也说"不生效"。颜色取飞书支持的中性色 + 蓝。
 */
function idTag(id) {
  if (typeof id !== 'string' || id.length === 0) return ''
  return ` <text_tag color='blue'>#${id}</text_tag>`
}

/**
 * 卡片字段行：飞书 `div.fields` 的一格。
 * 用一行一个字段（`is_short: false`）而不是两列，长文本（工作区路径、提示词）不会被挤断。
 */
function cardField(label, value) {
  return { is_short: false, text: { tag: 'lark_md', content: `**${label}**　${value}` } }
}

/**
 * 由报文上下文拼交互式卡片（FR-9）。
 *
 * 为什么改成卡片：纯文本通知在群里是一坨，看不出「谁的会话 / 说了什么」；
 * 卡片有标题配色、有分栏字段、底部还能放一枚跳转按钮。
 * **只做出站**：按钮仅跳转（`dsh://open`），不做回调——自定义机器人不支持回调。
 */
export function buildCard(intent, context) {
  const title = context?.title ?? intent?.message ?? '通知'
  const color = context?.color ?? 'blue'
  const fields = []
  // 2026-10-02（REQ-261002150038-344a）：正文**不再重复「类型」**——卡片标题栏已经给出了事件
  //（✅ 对话完成 / ⚠️ 会话中断 / ❓ 等待回答 / 🔐 等待授权 …），再列一行是纯重复（用户截图反馈）。
  // 纯文本渠道（企微 / 钉钉 / Slack / Discord / 自定义）没有标题栏，仍保留「**类型**」字段行。
  if (context?.session !== null && context?.session !== undefined) {
    fields.push(cardField('会话', `${context.session}${idTag(context.id)}`))
  }
  if (context?.workspace !== null && context?.workspace !== undefined) fields.push(cardField('工作区', context.workspace))
  if (context?.prompt !== null && context?.prompt !== undefined) fields.push(cardField('任务', context.prompt))
  if (context?.detail !== null && context?.detail !== undefined) fields.push(cardField(context.detail.label, context.detail.value))
  if (context?.time !== null && context?.time !== undefined) fields.push(cardField('时间', context.time))

  const elements = []
  if (fields.length > 0) elements.push({ tag: 'div', fields })
  else elements.push({ tag: 'div', text: { tag: 'lark_md', content: intent?.message ?? '通知' } })
  // 按钮只在 http/https 时出现：飞书卡片按钮不跟随自定义 scheme（dsh:// 点了一点反应都没有），
  // 与其放一个死按钮，不如不放。将来若把 payload.linkUrl 换成 https 中转页，按钮会自动回来。
  if (typeof context?.link === 'string' && /^https?:\/\//i.test(context.link)) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button', type: 'primary',
        text: { tag: 'plain_text', content: '打开 DSH' },
        url: context.link,
      }],
    })
  }
  return { config: { wide_screen_mode: true }, header: { template: color, title: { tag: 'plain_text', content: title } }, elements }
}

export function buildRequest({ target, intent, secret, now, context }) {
  // 有上下文（新版）→ 发交互式卡片；没有（老调用方/测试直调）→ 退回纯文本，保持兼容
  const payload = context === undefined || context === null
    ? { msg_type: 'text', content: { text: intent.message } }
    : { msg_type: 'interactive', card: buildCard(intent, context) }
  const signature = signRequest(secret, now)
  if (signature !== undefined) {
    payload.timestamp = signature.timestamp
    payload.sign = signature.sign
  }
  return {
    url: target.url,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  }
}

export function isSuccess(status, parsed) {
  if (!(status >= 200 && status < 300)) return { ok: false, reason: `http-status ${status}` }
  const code = parsed?.code
  if (typeof code === 'number' && code !== 0) {
    const detail = typeof parsed?.msg === 'string' && parsed.msg.length > 0 ? ` ${parsed.msg}` : ''
    return { ok: false, reason: `code ${code}${detail}` }
  }
  return { ok: true }
}

/* ── URL 组装与反解（本轮新增；实现集中在 meta.js，这里只做本渠道的薄封装） ── */

import { composeUrlFor, parseKeyFrom } from './meta.js'

/** 由目标拼出完整地址（纯函数，不抛异常）。 */
export function composeUrl(target) {
  return composeUrlFor(target)
}

/** 从完整地址反解 key；反解不出返回 undefined（不抛异常）。 */
export function parseKey(url) {
  return parseKeyFrom('feishu', url)
}
