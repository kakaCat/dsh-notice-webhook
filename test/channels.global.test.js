/**
 * 海外 / 通用三渠道（Slack / Discord / 通用自定义）的验收测试（t2b，覆盖 TC-4 / TC-5）。
 *
 * 跑法：node --test test/channels.global.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildRequest, isSuccess } from '../src/channels/index.js'
import { PAYLOAD_VERSION } from '../src/channels/custom.js'

const NOW = 1_790_750_000_000
const intent = { event: 'approval/asked', message: '需要你允许执行操作（Bash）', title: '修复登录 bug', toolName: 'Bash', goal: null }
const session = { id: 'session-x', workspace: '/tmp/ws' }

test('TC-4 Slack：报文为 {text}', () => {
  const request = buildRequest({ id: 's', name: 'Slack', channel: 'slack', url: 'https://hooks.slack.com/services/T/B/X' }, { intent, session, now: NOW })
  assert.deepEqual(JSON.parse(request.body), { text: '需要你允许执行操作（Bash）' })
  assert.deepEqual(isSuccess('slack', 200), { ok: true })
  assert.equal(isSuccess('slack', 404).ok, false)
})

test('TC-4 Discord：报文为 {content}，204 也算成功', () => {
  const request = buildRequest({ id: 'd', name: 'Discord', channel: 'discord', url: 'https://discord.com/api/webhooks/x/y' }, { intent, session, now: NOW })
  assert.deepEqual(JSON.parse(request.body), { content: '需要你允许执行操作（Bash）' })
  assert.deepEqual(isSuccess('discord', 204), { ok: true })
  assert.equal(isSuccess('discord', 429).ok, false)
})

test('TC-5 通用自定义：保持 v1 契约，字段逐项正确', () => {
  const target = { id: 'c', name: '兜底', channel: 'custom', url: 'https://example.com/hook', headers: { Authorization: 'Bearer abc' } }
  const request = buildRequest(target, { intent, session, title: '修复登录 bug', now: NOW })
  const payload = JSON.parse(request.body)

  assert.equal(payload.version, PAYLOAD_VERSION)
  assert.equal(payload.version, 1)
  assert.equal(payload.event, 'approval/asked')
  assert.equal(payload.message, '需要你允许执行操作（Bash）')
  assert.equal(payload.title, '修复登录 bug')
  assert.equal(payload.toolName, 'Bash')
  assert.equal(payload.goal, null)
  assert.equal(payload.sessionId, 'session-x')
  assert.equal(payload.workspace, '/tmp/ws')
  assert.equal(payload.at, new Date(NOW).toISOString())
  assert.equal(payload.source, 'dsh-notice-webhook')

  // 自定义请求头原样带上（含 Content-Type 不被覆盖）
  assert.equal(request.headers.Authorization, 'Bearer abc')
  assert.equal(request.headers['Content-Type'], 'application/json; charset=utf-8')
})

test('TC-5 通用自定义：缺少 title/session 时回落 null（不塞 undefined）', () => {
  const target = { id: 'c', name: '兜底', channel: 'custom', url: 'https://example.com/hook' }
  const payload = JSON.parse(buildRequest(target, { intent, now: NOW }).body)
  assert.equal(payload.title, null)
  assert.equal(payload.sessionId, null)
  assert.equal(payload.workspace, null)
  assert.deepEqual(isSuccess('custom', 200), { ok: true })
})
