/**
 * 路由层单测（覆盖 TC-6 … TC-8 与 t7 验收）。
 *
 * 跑法：node --test test/router.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeConfig } from '../src/config.js'
import { BindingStore } from '../src/bindings.js'
import { Router, DROP_COOLDOWN, DROP_MASTER_SWITCH_OFF, DROP_NO_ENDPOINT, DROP_TYPE_DISABLED } from '../src/router.js'

const silent = { warn() {} }
const sessionX = { header: { id: 'session-X' } }
const sessionY = { header: { id: 'session-Y' } }
const complete = { kind: 'complete', event: 'turn/end', message: '会话已完成', toolName: null }
const approval = { kind: 'approval', event: 'approval/asked', message: '需要你允许执行操作（Bash）', toolName: 'Bash' }
const goalBlocked = { event: 'goal/blocked', message: '目标阻塞（round-limit）', goal: { id: 'g', phase: 'blocked', round: 20 } }

function setup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-router-'))
  const config = normalizeConfig(overrides, silent)
  const store = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  return { config, store, router: new Router(config), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('TC-6 绑定优先于默认地址：X 走绑定、Y 走默认，且不重复投递', () => {
  const s = setup({ webhookUrl: 'https://default.example.com/hook' })
  try {
    s.store.bind('session-X', 'https://bound.example.com/hook')
    const forX = s.router.route(sessionX, complete, s.store)
    assert.deepEqual(forX, { endpoint: 'https://bound.example.com/hook', source: 'binding' })
    const forY = s.router.route(sessionY, complete, s.store)
    assert.deepEqual(forY, { endpoint: 'https://default.example.com/hook', source: 'default' })
    assert.notEqual(forX.endpoint, forY.endpoint)
  } finally {
    s.cleanup()
  }
})

test('TC-7 总开关只管默认通道：关了以后已绑定会话照发、未绑定会话不发', () => {
  const s = setup({ enabled: false, webhookUrl: 'https://default.example.com/hook' })
  try {
    s.store.bind('session-X', 'https://bound.example.com/hook')
    assert.deepEqual(s.router.route(sessionX, complete, s.store), { endpoint: 'https://bound.example.com/hook', source: 'binding' })
    assert.deepEqual(s.router.route(sessionY, complete, s.store), { endpoint: null, reason: DROP_MASTER_SWITCH_OFF })
  } finally {
    s.cleanup()
  }
})

test('TC-8 类型开关是内容级过滤：命中绑定也不豁免', () => {
  const s = setup({ notifyApproval: false, webhookUrl: 'https://default.example.com/hook' })
  try {
    s.store.bind('session-X', 'https://bound.example.com/hook')
    assert.deepEqual(s.router.route(sessionX, approval, s.store), { endpoint: null, reason: DROP_TYPE_DISABLED })
    // 同一会话的完成类事件仍照常走（关的是"授权"这一类，不是这个会话）
    assert.deepEqual(s.router.route(sessionX, complete, s.store), { endpoint: 'https://bound.example.com/hook', source: 'binding' })
  } finally {
    s.cleanup()
  }
})

test('既无绑定也无默认地址 → 丢弃且原因为 no-endpoint', () => {
  const s = setup({})
  try {
    assert.deepEqual(s.router.route(sessionX, complete, s.store), { endpoint: null, reason: DROP_NO_ENDPOINT })
  } finally {
    s.cleanup()
  }
})

test('冷却：窗口内第二条被丢；窗口过后恢复', () => {
  const s = setup({ webhookUrl: 'https://default.example.com/hook', cooldownMs: 5000 })
  try {
    assert.equal(s.router.route(sessionX, complete, s.store, 1_000).endpoint, 'https://default.example.com/hook')
    assert.deepEqual(s.router.route(sessionX, complete, s.store, 1_500), { endpoint: null, reason: DROP_COOLDOWN })
    assert.equal(s.router.route(sessionX, complete, s.store, 6_500).endpoint, 'https://default.example.com/hook')
    // 冷却按会话隔离：Y 不受 X 影响
    assert.equal(s.router.route(sessionY, complete, s.store, 1_500).endpoint, 'https://default.example.com/hook')
  } finally {
    s.cleanup()
  }
})

test('冷却不消耗在"本来就不会发"的意图上', () => {
  const s = setup({ webhookUrl: 'https://default.example.com/hook', cooldownMs: 5000, notifyApproval: false })
  try {
    // 被类型开关丢掉的意图不该吃掉冷却窗口
    s.router.route(sessionX, approval, s.store, 1_000)
    assert.equal(s.router.route(sessionX, complete, s.store, 1_100).endpoint, 'https://default.example.com/hook')
  } finally {
    s.cleanup()
  }
})

test('goal 终态不受三类开关影响（它们是目标级事件）', () => {
  const s = setup({ notifyComplete: false, notifyApproval: false, notifyQuestion: false, webhookUrl: 'https://default.example.com/hook' })
  try {
    assert.equal(s.router.route(sessionX, goalBlocked, s.store).endpoint, 'https://default.example.com/hook')
  } finally {
    s.cleanup()
  }
})

test('意图为 null 时安全丢弃', () => {
  const s = setup({ webhookUrl: 'https://default.example.com/hook' })
  try {
    assert.deepEqual(s.router.route(sessionX, null, s.store), { endpoint: null, reason: DROP_NO_ENDPOINT })
  } finally {
    s.cleanup()
  }
})
