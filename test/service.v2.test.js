/**
 * Host Service v2 的验收测试（t6，覆盖 TC-20 与绑定语义）。
 *
 * 跑法：node --test test/service.v2.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BindingStore } from '../src/bindings.js'
import { TargetStore } from '../src/targets.js'
import { SERVICE_VERSION, createService } from '../src/service.js'

const silent = { warn() {} }

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-service-v2-'))
  const bindings = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })
  targets.save({ name: '项目群-企微', channel: 'wecom', url: 'https://example.com/a' })
  targets.save({ name: '我的手机', channel: 'slack', url: 'https://example.com/b' })
  const tA = targets.list().find(t => t.channel === 'wecom').id
  const tB = targets.list().find(t => t.channel === 'slack').id
  const service = createService({
    bindings,
    targets,
    resolveDefaultUrl: () => '',
    resolveAll: (sid) => bindings.targetIdsOf(sid).map(id => ({ id })),
  })
  return { service, bindings, targets, tA, tB, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('版本为 2，且新旧方法齐全', () => {
  const ctx = fresh()
  try {
    assert.equal(ctx.service.version, SERVICE_VERSION)
    assert.equal(ctx.service.version, 2)
    for (const m of ['bind', 'unbind', 'list', 'resolve', 'bindTargets', 'unbindTargets', 'listBindings', 'listTargets', 'resolveAll']) {
      assert.equal(typeof ctx.service[m], 'function', m)
    }
  } finally {
    ctx.cleanup()
  }
})

test('旧四方法行为不变（REQ-250a FR-9 回归）', () => {
  const ctx = fresh()
  try {
    assert.equal(ctx.service.bind('', 'https://example.com/hook'), false)
    assert.equal(ctx.service.bind('s1', 'ftp://x'), false)
    assert.equal(ctx.service.bind('s1', 'https://example.com/hook'), true)
    assert.deepEqual(ctx.service.resolve('s1'), { url: 'https://example.com/hook', source: 'binding' })
    assert.deepEqual(ctx.service.list().map(e => e.sessionId), ['s1'])
    assert.equal(ctx.service.unbind('s1'), true)
    assert.equal(ctx.service.unbind('s1'), false)
  } finally {
    ctx.cleanup()
  }
})

test('bindTargets：多目标绑定；任一 id 不存在则整笔不生效', () => {
  const ctx = fresh()
  try {
    assert.equal(ctx.service.bindTargets('session-x', [ctx.tA, ctx.tB]), true)
    assert.deepEqual(ctx.bindings.targetIdsOf('session-x').sort(), [ctx.tA, ctx.tB].sort())
    assert.equal(ctx.service.bindTargets('session-x', [ctx.tA, 'not-a-target']), false)
    assert.deepEqual(ctx.bindings.targetIdsOf('session-x').sort(), [ctx.tA, ctx.tB].sort(), '部分绑定不得生效')
    assert.equal(ctx.service.bindTargets('', [ctx.tA]), false)
  } finally {
    ctx.cleanup()
  }
})

test('TC-20：unbindTargets 与 bindTargets(sid, []) 等价，解绑后回落', () => {
  const ctx = fresh()
  try {
    ctx.service.bindTargets('session-x', [ctx.tA])
    assert.equal(ctx.service.unbindTargets('session-x'), true)
    assert.deepEqual(ctx.bindings.targetIdsOf('session-x'), [])
    assert.equal(ctx.service.unbindTargets('session-x'), false)

    ctx.service.bindTargets('session-y', [ctx.tA])
    assert.equal(ctx.service.bindTargets('session-y', []), true)
    assert.deepEqual(ctx.bindings.targetIdsOf('session-y'), [])
  } finally {
    ctx.cleanup()
  }
})

test('listBindings 展开目标（含 name/channel/enabled），不带 url 与密钥', () => {
  const ctx = fresh()
  try {
    ctx.service.bindTargets('session-x', [ctx.tA, ctx.tB])
    const rows = ctx.service.listBindings()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].sessionId, 'session-x')
    assert.deepEqual(rows[0].targets.map(t => t.name).sort(), ['我的手机', '项目群-企微'].sort())
    for (const t of rows[0].targets) {
      assert.equal(typeof t.id, 'string')
      assert.equal(typeof t.channel, 'string')
      assert.equal(typeof t.enabled, 'boolean')
      assert.equal('url' in t, false, '展开不得带地址')
      assert.equal('secretRef' in t, false)
    }
  } finally {
    ctx.cleanup()
  }
})

test('listTargets 不回密钥明文，只回"是否已配置"', () => {
  const ctx = fresh()
  try {
    ctx.targets.save({ name: '钉钉群', channel: 'dingtalk', url: 'https://example.com/c', secretRef: 'DINGTALK_SECRET' })
    const rows = ctx.service.listTargets()
    for (const r of rows) {
      assert.equal(typeof r.secretConfigured, 'boolean')
      if (r.secretConfigured) assert.equal(typeof r.secretRef, 'string')
      assert.equal('url' in r, true, '目标要带地址（调用方是同进程插件）')
    }
    const withSecret = rows.find(r => r.secretConfigured)
    assert.ok(withSecret !== undefined)
    assert.equal(withSecret.secretRef, 'DINGTALK_SECRET')
  } finally {
    ctx.cleanup()
  }
})

test('resolveAll 走注入的路由解析；未注入时返回 null', () => {
  const ctx = fresh()
  try {
    ctx.service.bindTargets('session-x', [ctx.tA])
    const all = ctx.service.resolveAll('session-x', { event: 'turn/end' })
    assert.deepEqual(all.map(t => t.id), [ctx.tA])
  } finally {
    ctx.cleanup()
  }

  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-no-resolve-'))
  try {
    const service = createService({
      bindings: new BindingStore({ path: join(dir, 'b.json'), logger: silent }),
      targets: new TargetStore({ path: join(dir, 't.json'), logger: silent }),
      resolveDefaultUrl: () => '',
    })
    assert.equal(service.resolveAll('s', { event: 'turn/end' }), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
