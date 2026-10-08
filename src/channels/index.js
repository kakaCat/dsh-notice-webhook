/**
 * 渠道注册表：`channel → adapter`，以及两个薄封装（打包 / 判定成功）。
 *
 * 为什么要有注册表：路由层只认 `channel` 字符串，新增渠道是**纯增量**（加一个模块 + 注册一行），
 * 不改路由、不改投递、不改界面。
 *
 * 设计纪律：适配器是**纯函数**（无状态、无网络）；凭据由调用方解析后作为普通字符串传入——
 * 渠道模块永远不接触存储或凭据系统。
 */
import { channelMetaProjection, composeUrlFor, parseKeyFrom } from './meta.js'
import * as custom from './custom.js'
import * as dingtalk from './dingtalk.js'
import * as discord from './discord.js'
import * as feishu from './feishu.js'
import * as slack from './slack.js'
import * as wecom from './wecom.js'

/** 全部已注册渠道（顺序即界面展示顺序）。 */
export const ADAPTERS = new Map([
  ['wecom', wecom],
  ['feishu', feishu],
  ['dingtalk', dingtalk],
  ['slack', slack],
  ['discord', discord],
  ['custom', custom],
])

/** 渠道 id 列表（供目标校验与界面选择器使用）。 */
export const CHANNEL_IDS = [...ADAPTERS.keys()]

/**
 * 统一入口：由目标拼出完整地址（用户只填 key 时由这里组装）。
 * @returns 完整地址字符串（未注册渠道回落 target.url）
 */
export function composeUrl(target) {
  return composeUrlFor(target)
}

/**
 * 统一入口：从完整地址反解 key（迁移旧数据用）。
 * @returns key 字符串或 undefined（反解不出**不抛异常**）
 */
export function parseKey(channel, url) {
  return parseKeyFrom(channel, url)
}

/** 渠道元数据投影（供 RPC 给界面渲染 label / keyLabel / help）。 */
export { channelMetaProjection }

/** 取适配器；未注册返回 undefined。 */
export function getAdapter(channel) {
  return ADAPTERS.get(channel)
}

/**
 * 打包一条出站请求。
 *
 * @param target - 目标记录（含 channel / url / secretRef / headers）
 * @param input - `{ intent, session, title, secret, now }`；`secret` 是**已解析**的密钥字符串
 * @returns `{ url, headers, body }` 或 `{ error }`（**永不抛异常**）
 */
export function buildRequest(target, input) {
  const adapter = ADAPTERS.get(target?.channel)
  if (adapter === undefined) return { error: `未注册的渠道：${String(target?.channel)}` }
  try {
    return adapter.buildRequest({ target, ...input })
  } catch (error) {
    return { error: `打包失败：${String(error?.message ?? error)}` }
  }
}

/**
 * 判定一次投递是否业务成功。
 *
 * @param channel - 渠道 id
 * @param status - HTTP 状态码
 * @param parsed - 已解析的响应体（解析失败传 undefined）
 */
export function isSuccess(channel, status, parsed) {
  const adapter = ADAPTERS.get(channel)
  if (adapter === undefined) return { ok: false, reason: `未注册的渠道：${String(channel)}` }
  try {
    return adapter.isSuccess(status, parsed)
  } catch (error) {
    return { ok: false, reason: `判定失败：${String(error?.message ?? error)}` }
  }
}
