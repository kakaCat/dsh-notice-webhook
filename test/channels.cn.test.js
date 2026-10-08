/**
 * 国内三渠道（企业微信 / 飞书 / 钉钉）的验收测试（t2a，覆盖 TC-1 / TC-2 / TC-3 / TC-6）。
 *
 * 跑法：node --test test/channels.cn.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildRequest, getAdapter, isSuccess } from '../src/channels/index.js'
import { signRequest as dingtalkSign } from '../src/channels/dingtalk.js'
import { signRequest as feishuSign } from '../src/channels/feishu.js'

const NOW = 1_790_750_000_000
const intent = { event: 'turn/end', message: '修复登录 bug · 会话已完成', title: '修复登录 bug', toolName: null, goal: null }
const session = { id: 'session-x', workspace: '/tmp/ws' }

const wecomTarget = { id: 'w', name: '企微群', channel: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***' }
const feishuTarget = { id: 'f', name: '飞书群', channel: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/***' }
const dingtalkTarget = { id: 'd', name: '钉钉群', channel: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send?access_token=***' }

test('TC-1 企业微信：报文形状 + 业务错误码判定', () => {
  const request = buildRequest(wecomTarget, { intent, session, now: NOW })
  assert.equal(request.error, undefined)
  assert.deepEqual(JSON.parse(request.body), { msgtype: 'markdown', markdown: { content: '修复登录 bug · 会话已完成' } })
  assert.equal(request.headers['Content-Type'], 'application/json; charset=utf-8')

  assert.deepEqual(isSuccess('wecom', 200, { errcode: 0, errmsg: 'ok' }), { ok: true })
  const failed = isSuccess('wecom', 200, { errcode: 310000, errmsg: 'keywords not in content' })
  assert.equal(failed.ok, false)
  assert.match(failed.reason, /310000/)
  assert.match(failed.reason, /keywords not in content/)
  assert.equal(isSuccess('wecom', 500, {}).ok, false)
})

test('TC-2 飞书：无密钥时 body 只有 msg_type/content；有密钥时加 timestamp+sign', () => {
  const plain = JSON.parse(buildRequest(feishuTarget, { intent, session, now: NOW }).body)
  assert.deepEqual(plain, { msg_type: 'text', content: { text: '修复登录 bug · 会话已完成' } })

  const signed = JSON.parse(buildRequest(feishuTarget, { intent, session, now: NOW, secret: 'FEISHU_SECRET' }).body)
  assert.equal(signed.timestamp, String(NOW))
  assert.equal(typeof signed.sign, 'string')
  assert.ok(signed.sign.length > 0)

  // 时间戳变 → 签名变（证明签名确实参与计算）
  const later = JSON.parse(buildRequest(feishuTarget, { intent, session, now: NOW + 1000, secret: 'FEISHU_SECRET' }).body)
  assert.notEqual(later.sign, signed.sign)

  assert.deepEqual(feishuSign(undefined, NOW), undefined)
  assert.deepEqual(isSuccess('feishu', 200, { code: 0 }), { ok: true })
  assert.equal(isSuccess('feishu', 200, { code: 19021, msg: 'sign match fail' }).ok, false)
  assert.equal(isSuccess('feishu', 200, {}).ok, true, '没有 code 字段时按 HTTP 判定')
})

test('TC-3 钉钉：报文含 title/text；加签拼进 query；无密钥时不带签名参数', () => {
  const plain = buildRequest(dingtalkTarget, { intent, session, now: NOW })
  assert.deepEqual(JSON.parse(plain.body), { msgtype: 'markdown', markdown: { title: '修复登录 bug', text: '修复登录 bug · 会话已完成' } })
  assert.equal(plain.url, dingtalkTarget.url, '未开启加签时不得改 URL')

  const signed = buildRequest(dingtalkTarget, { intent, session, now: NOW, secret: 'DINGTALK_SECRET' })
  assert.match(signed.url, /[?&]timestamp=1790750000000/)
  assert.match(signed.url, /[?&]sign=/)
  const signature = dingtalkSign('DINGTALK_SECRET', NOW)
  assert.equal(signature.timestamp, String(NOW))
  assert.ok(decodeURIComponent(signed.url).includes(signature.sign))

  assert.deepEqual(isSuccess('dingtalk', 200, { errcode: 0 }), { ok: true })
  const failed = isSuccess('dingtalk', 200, { errcode: 310000, errmsg: 'token is not exist' })
  assert.equal(failed.ok, false)
  assert.match(failed.reason, /token is not exist/)
})

test('TC-6 未知渠道：返回 error 不抛异常', () => {
  const request = buildRequest({ channel: 'nope', url: 'https://example.com/hook' }, { intent, session, now: NOW })
  assert.match(request.error, /未注册的渠道/)
  assert.equal(getAdapter('nope'), undefined)
  assert.equal(isSuccess('nope', 200, {}).ok, false)
})

test('注册表含六个渠道，注册表顺序稳定', () => {
  const ids = ['wecom', 'feishu', 'dingtalk', 'slack', 'discord', 'custom']
  for (const id of ids) assert.equal(typeof getAdapter(id)?.buildRequest, 'function', `${id} 应已注册`)
  assert.deepEqual(ids.map(id => getAdapter(id).id), ids)
})
