/**
 * 目标集合解析与替代默认组的验收测试（t8a，覆盖 TC-19 与总开关旁路）。
 *
 * 跑法：node --test test/router.resolve.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeConfig } from '../src/config.js'
import { BindingStore } from '../src/bindings.js'
import { Router } from '../src/router.js'
import { TargetStore } from '../src/targets.js'

const silent = { warn() {} }
const sessionX = { header: { id: 'session-X' } }
const sessionY = { header: { id: 'session-Y' } }
const complete = { kind: 'complete', event: 'turn/end', message: '会话已完成' }

function setup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-resolve-'))
  const config = normalizeConfig({ webhookUrl: 'https://default.example.com/hook', ...overrides }, silent)
  const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })
  const bindings = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  return { config, targets, bindings, router: new Router(config), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function addTarget(s, over) {
  const verdict = s.targets.save({ name: over.name ?? `t-${over.url}`, channel: 'wecom', url: over.url, enabled: over.enabled ?? true, isDefault: over.isDefault ?? false, events: over.events ?? [] })
  assert.equal(verdict.ok, true, JSON.stringify(verdict.errors ?? ''))
  return verdict.target
}

test('TC-19：绑定替代默认组——绑了就不再发默认组', () => {
  const s = setup()
  try {
    const defA = addTarget(s, { url: 'https://a.example.com', isDefault: true })
    const defB = addTarget(s, { url: 'https://b.example.com', isDefault: true })
    const bound = addTarget(s, { url: 'https://c.example.com' })

    s.bindings.bindTargets('session-X', [bound.id])
    const resolved = s.router.resolveTargets(sessionX, complete, s)
    assert.deepEqual(resolved.targets.map(t => t.id), [bound.id], '绑定非空 → 只发绑定目标')
    assert.equal(resolved.source, 'binding')
    assert.equal(resolved.targets.some(t => t.id === defA.id || t.id === defB.id), false, '默认组不参与')

    // 换成默认组里的一个目标来绑，确认默认组里"没被选中的"也不发
    s.bindings.bindTargets('session-X', [defA.id, bound.id])
    const resolved2 = s.router.resolveTargets(sessionX, complete, s)
    assert.deepEqual(resolved2.targets.map(t => t.id).sort(), [defA.id, bound.id].sort())
    assert.equal(resolved2.targets.some(t => t.id === defB.id), false, '默认组里没被绑的不发')
  } finally {
    s.cleanup()
  }
})

test('绑定为空 / 不存在 → 走默认组', () => {
  const s = setup()
  try {
    const defA = addTarget(s, { url: 'https://a.example.com', isDefault: true })
    const resolved = s.router.resolveTargets(sessionY, complete, s)
    assert.deepEqual(resolved.targets.map(t => t.id), [defA.id])
    assert.equal(resolved.source, 'default')
  } finally {
    s.cleanup()
  }
})

test('绑定的目标被删或停用 → 视为未绑定，回落默认组（不报错）', () => {
  const s = setup()
  try {
    const defA = addTarget(s, { url: 'https://a.example.com', isDefault: true })
    const bound = addTarget(s, { url: 'https://c.example.com' })
    s.bindings.bindTargets('session-X', [bound.id])

    // 停用绑定目标 → 回落默认组
    s.targets.setEnabled(bound.id, false)
    const resolved = s.router.resolveTargets(sessionX, complete, s)
    assert.deepEqual(resolved.targets.map(t => t.id), [defA.id])
    assert.equal(resolved.source, 'default')

    // 重新启用并绑定，再删除 → 回落默认组
    s.targets.setEnabled(bound.id, true)
    s.targets.remove(bound.id)
    const resolved2 = s.router.resolveTargets(sessionX, complete, s)
    assert.deepEqual(resolved2.targets.map(t => t.id), [defA.id])
  } finally {
    s.cleanup()
  }
})

test('总开关只作用于默认组：关掉了默认组不推、已绑定照发', () => {
  const s = setup({ enabled: false })
  try {
    const bound = addTarget(s, { url: 'https://c.example.com' })
    s.bindings.bindTargets('session-X', [bound.id])

    const resolved = s.router.resolveTargets(sessionX, complete, s)
    assert.deepEqual(resolved.targets.map(t => t.id), [bound.id], '绑定是旁路，总开关管不到')

    const resolvedY = s.router.resolveTargets(sessionY, complete, s)
    assert.equal(resolvedY.targets.length, 0)
    assert.equal(resolvedY.reason, 'master-switch-off')
  } finally {
    s.cleanup()
  }
})

test('类型开关是内容级：关了该类，绑定也不豁免', () => {
  const s = setup({ notifyComplete: false })
  try {
    const bound = addTarget(s, { url: 'https://c.example.com' })
    s.bindings.bindTargets('session-X', [bound.id])
    const resolved = s.router.resolveTargets(sessionX, complete, s)
    assert.equal(resolved.targets.length, 0)
    assert.equal(resolved.reason, 'type-disabled')
  } finally {
    s.cleanup()
  }
})
