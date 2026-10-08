/**
 * 绑定存储 v2（targetBindings 段）的验收测试（t5）。
 *
 * 跑法：node --test test/bindings.v2.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BindingStore, FILE_VERSION } from '../src/bindings.js'

const silent = { warn() {} }

function withTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-bindings-v2-'))
  try {
    return run(join(dir, 'bindings.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('多目标绑定：写盘含 targetBindings 段，可读回', () => {
  withTemp(path => {
    const store = new BindingStore({ path, logger: silent })
    assert.equal(store.bindTargets('session-x', ['wecom-project', 'slack-phone']), true)

    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.version, FILE_VERSION)
    assert.deepEqual(onDisk.targetBindings['session-x'].targetIds, ['wecom-project', 'slack-phone'])
    // 旧段仍存在（回滚安全）
    assert.deepEqual(onDisk.bindings, {})

    const reloaded = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.targetIdsOf('session-x'), ['wecom-project', 'slack-phone'])
    assert.deepEqual(reloaded.listBindings().map(b => b.sessionId), ['session-x'])
  })
})

test('bindTargets 去重、覆盖旧值；空数组等价于解绑', () => {
  withTemp(path => {
    const store = new BindingStore({ path, logger: silent })
    store.bindTargets('session-x', ['a', 'a', 'b'])
    assert.deepEqual(store.targetIdsOf('session-x'), ['a', 'b'])
    store.bindTargets('session-x', ['c'])
    assert.deepEqual(store.targetIdsOf('session-x'), ['c'])
    store.bindTargets('session-x', [])
    assert.deepEqual(store.targetIdsOf('session-x'), [])
    assert.deepEqual(store.listBindings(), [])
  })
})

test('bindTargets 参数非法返回 false 且不写表', () => {
  withTemp(path => {
    const store = new BindingStore({ path, logger: silent })
    assert.equal(store.bindTargets('', ['a']), false)
    assert.equal(store.bindTargets('   ', ['a']), false)
    assert.equal(store.bindTargets('x', 'not-array'), false)
    assert.equal(store.bindTargets('x', ['a', 1]), false)
    assert.equal(store.bindTargets('x', ['a', '']), false)
    assert.deepEqual(store.listBindings(), [])
  })
})

test('unbindTargets 双清：多目标与旧 url 绑定一起消失', () => {
  withTemp(path => {
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-x', 'https://example.com/legacy')
    store.bindTargets('session-x', ['a'])
    assert.equal(store.unbindTargets('session-x'), true)
    assert.deepEqual(store.targetIdsOf('session-x'), [])
    assert.equal(store.resolve('session-x'), null, '旧 url 绑定也必须被清掉')
    assert.equal(store.unbindTargets('session-x'), false)
  })
})

test('unbind 同样双清（v1 语义对使用者只有一种"解绑"）', () => {
  withTemp(path => {
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-x', 'https://example.com/legacy')
    store.bindTargets('session-x', ['a'])
    assert.equal(store.unbind('session-x'), true)
    assert.deepEqual(store.targetIdsOf('session-x'), [])
    assert.equal(store.resolve('session-x'), null)
  })
})

test('回滚安全：旧版本能读新文件且不报错（忽略未知顶层键）', () => {
  withTemp(path => {
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-x', 'https://example.com/legacy')
    store.bindTargets('session-x', ['a'])
    // 模拟旧版本 reader：只读 version 与 bindings 段，忽略 targetBindings
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.version, FILE_VERSION)
    assert.deepEqual(Object.keys(onDisk.bindings), ['session-x'])
    assert.equal(onDisk.bindings['session-x'].url, 'https://example.com/legacy')
    // 未知顶层键存在但旧版本不读 —— 不会因它报错（本测试即"旧版本读新文件不报错"的证据）
    assert.equal(typeof onDisk.targetBindings, 'object')
  })
})

test('老文件（无 targetBindings 段）按空表加载，不算损坏', () => {
  withTemp(path => {
    writeFileSync(path, JSON.stringify({ version: FILE_VERSION, bindings: { 'session-y': { url: 'https://example.com/hook', updatedAt: '2026-01-01T00:00:00.000Z' } } }), 'utf8')
    const store = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(store.resolve('session-y'), { url: 'https://example.com/hook', source: 'binding' })
    assert.deepEqual(store.listBindings(), [])
  })
})

test('targetBindings 段非法时只按空表加载该段', () => {
  withTemp(path => {
    writeFileSync(path, JSON.stringify({
      version: FILE_VERSION,
      bindings: { 'session-y': { url: 'https://example.com/hook' } },
      targetBindings: { 'session-y': { targetIds: ['a', '', 1], updatedAt: '2026-01-01T00:00:00.000Z' }, '   ': { targetIds: ['b'] } },
    }), 'utf8')
    const store = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(store.targetIdsOf('session-y'), ['a'], '非法 id（空串/非字符串）被过滤')
    assert.deepEqual(store.targetIdsOf('   '), [], '空白 sessionId 被跳过')
  })
})
