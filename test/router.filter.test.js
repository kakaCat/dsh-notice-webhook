/**
 * 逐目标事件过滤与去重的验收测试（t8b，覆盖 TC-9 / TC-12 与冷却）。
 *
 * 跑法：node --test test/router.filter.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeConfig } from '../src/config.js'
import { BindingStore } from '../src/bindings.js'
import { Router, targetAccepts, dedupKey } from '../src/router.js'
import { TargetStore } from '../src/targets.js'

const silent = { warn() {} }
const sessionX = { header: { id: 'session-X' } }

function setup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-filter-'))
  const config = normalizeConfig(overrides, silent)
  const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })
  const bindings = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  return { config, targets, bindings, router: new Router(config), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function addTarget(s, over) {
  const verdict = s.targets.save({ name: over.channel + Math.random().toString(36).slice(2, 6), channel: over.channel ?? 'wecom', url: over.url, enabled: true, isDefault: over.isDefault ?? false, events: over.events ?? [] })
  assert.equal(verdict.ok, true)
  return verdict.target
}

const approval = { kind: 'approval', event: 'approval/asked', message: '要你点头' }
const complete = { kind: 'complete', event: 'turn/end', message: '跑完了' }
const goalBlocked = { event: 'goal/blocked', message: '目标轮次耗尽（20/20）' }

test('TC-9：目标只勾「授权」→ 完成事件不到它；授权事件到它', () => {
  const s = setup()
  try {
    const onlyApproval = addTarget(s, { url: 'https://a.example.com', isDefault: true, events: ['approval/asked'] })
    const all = addTarget(s, { url: 'https://b.example.com', isDefault: true, events: [] })

    const resolvedComplete = s.router.resolveTargets(sessionX, complete, s)
    assert.deepEqual(resolvedComplete.targets.map(t => t.id), [all.id], '完成事件只到"全收"目标')

    const resolvedApproval = s.router.resolveTargets(sessionX, approval, s)
    assert.deepEqual(resolvedApproval.targets.map(t => t.id).sort(), [onlyApproval.id, all.id].sort(), '授权事件两个都到')
  } finally {
    s.cleanup()
  }
})

test('targetAccepts：空 events = 全收；goal/* 覆盖 goal 终态', () => {
  assert.equal(targetAccepts({ events: [] }, 'turn/end'), true)
  assert.equal(targetAccepts({ events: ['turn/end'] }, 'approval/asked'), false)
  assert.equal(targetAccepts({ events: ['goal/*'] }, 'goal/complete'), true)
  assert.equal(targetAccepts({ events: ['goal/*'] }, 'goal/blocked'), true)
  assert.equal(targetAccepts({ events: ['goal/*'] }, 'turn/end'), false)
})

test('TC-9：勾了 goal/* 的目标收到 goal 终态，没勾的不收', () => {
  const s = setup()
  try {
    const goalOnly = addTarget(s, { url: 'https://g.example.com', isDefault: true, events: ['goal/*'] })
    const all = addTarget(s, { url: 'https://b.example.com', isDefault: true, events: [] })
    const resolved = s.router.resolveTargets(sessionX, goalBlocked, s)
    assert.deepEqual(resolved.targets.map(t => t.id).sort(), [goalOnly.id, all.id].sort())

    const completeTarget = addTarget(s, { url: 'https://c.example.com', isDefault: true, events: ['turn/end'] })
    const resolved2 = s.router.resolveTargets(sessionX, goalBlocked, s)
    assert.equal(resolved2.targets.some(t => t.id === completeTarget.id), false, '只勾完成的目标不收 goal 终态')
  } finally {
    s.cleanup()
  }
})

test('TC-12：同渠道同地址的两个目标只发一次', () => {
  const s = setup()
  try {
    const t1 = addTarget(s, { url: 'https://dup.example.com', isDefault: true })
    const t2 = addTarget(s, { url: 'https://dup.example.com', isDefault: true })
    const t3 = addTarget(s, { url: 'https://other.example.com', isDefault: true })

    assert.equal(dedupKey(t1), dedupKey(t2))
    const resolved = s.router.resolveTargets(sessionX, complete, s)
    const ids = resolved.targets.map(t => t.id)
    assert.equal(ids.length, 2, '同渠道+同地址去重 → 只发一次')
    assert.equal(ids.filter(id => id === t3.id).length, 1)
    assert.equal(ids.includes(t1.id) || ids.includes(t2.id), true, '去重后保留其中一条')
  } finally {
    s.cleanup()
  }
})

test('冷却：确定会投递才计时；窗口内第二条被丢，被丢弃的不吃窗口', () => {
  const s = setup({ cooldownMs: 5000, webhookUrl: 'https://default.example.com/hook' })
  try {
    addTarget(s, { url: 'https://default.example.com/hook', isDefault: true })
    const resolved = s.router.resolveTargets(sessionX, complete, s)
    assert.equal(resolved.targets.length, 1)

    // 第一次 commit 成功；窗口内第二次失败；窗口外恢复
    assert.equal(s.router.commitCooldown(sessionX, 1000), true)
    assert.equal(s.router.commitCooldown(sessionX, 1500), false)
    assert.equal(s.router.commitCooldown(sessionX, 6500), true)
  } finally {
    s.cleanup()
  }
})
