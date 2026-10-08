/**
 * Host Service 契约单测（覆盖 TC-14 与 t3 验收）。
 *
 * 跑法：node --test test/service.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BindingStore } from '../src/bindings.js'
import { TargetStore } from '../src/targets.js'
import { SERVICE_KEY, SERVICE_VERSION, createService, provideService } from '../src/service.js'

const silent = { warn() {} }

function freshService(defaultUrl = '') {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-service-'))
  const store = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })
  // v2 工厂签名：createService({ bindings, targets, resolveDefaultUrl, resolveAll? })；
  // 本文件回归的是 v1 的四个方法（bind/unbind/list/resolve）——行为不变（REQ-250a FR-9）。
  const service = createService({ bindings: store, targets, resolveDefaultUrl: () => defaultUrl })
  return { service, store, targets, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('服务版本为 2 且方法齐全（v1 四方法回归 + v2 新方法）', () => {
  const ctx = freshService()
  try {
    assert.equal(ctx.service.version, SERVICE_VERSION)
    assert.equal(ctx.service.version, 2, 'REQ-0862 把服务升到 v2（新增多目标方法）；旧消费方需放宽到 >= 1')
    // v1 契约回归：四个旧方法一个不少
    for (const method of ['bind', 'unbind', 'list', 'resolve']) {
      assert.equal(typeof ctx.service[method], 'function', method)
    }
    // v2 新方法
    for (const method of ['bindTargets', 'unbindTargets', 'listBindings', 'listTargets', 'resolveAll']) {
      assert.equal(typeof ctx.service[method], 'function', method)
    }
  } finally {
    ctx.cleanup()
  }
})

test('bind 参数非法一律返回 false，且不写绑定表、不抛异常', () => {
  const ctx = freshService()
  try {
    assert.equal(ctx.service.bind('', 'https://example.com/hook'), false)
    assert.equal(ctx.service.bind('   ', 'https://example.com/hook'), false)
    assert.equal(ctx.service.bind(undefined, 'https://example.com/hook'), false)
    assert.equal(ctx.service.bind('s1', 'ftp://example.com/hook'), false)
    assert.equal(ctx.service.bind('s1', 'not-a-url'), false)
    assert.equal(ctx.service.bind('s1', ''), false)
    assert.deepEqual(ctx.service.list(), [])
  } finally {
    ctx.cleanup()
  }
})

test('bind → list → resolve 往返正常', () => {
  const ctx = freshService('https://example.com/default')
  try {
    assert.equal(ctx.service.bind('s1', 'https://example.com/s1'), true)
    assert.deepEqual(ctx.service.list().map(e => e.sessionId), ['s1'])
    assert.deepEqual(ctx.service.resolve('s1'), { url: 'https://example.com/s1', source: 'binding' })
    assert.deepEqual(ctx.service.resolve('s2'), { url: 'https://example.com/default', source: 'default' })
  } finally {
    ctx.cleanup()
  }
})

test('unbind 不存在返回 false；resolve 无绑定且无默认地址返回 null', () => {
  const ctx = freshService('')
  try {
    assert.equal(ctx.service.unbind('不存在'), false)
    assert.equal(ctx.service.resolve('未绑定且无默认地址'), null)
  } finally {
    ctx.cleanup()
  }
})

test('provideService 注册到 ctx 且 dispose 可卸载；ctx 不可用时安全降级', () => {
  const ctx = freshService()
  try {
    const provided = new Map()
    const fakeCtx = {
      provide(key, value) {
        provided.set(key, value)
        return () => provided.delete(key)
      },
    }
    const dispose = provideService(fakeCtx, ctx.service)
    assert.equal(provided.get(SERVICE_KEY), ctx.service)
    assert.equal(provided.get(SERVICE_KEY).version, 2)
    dispose()
    assert.equal(provided.has(SERVICE_KEY), false)

    // 旧宿主没有 provide：不抛异常，返回空清理函数
    const noop = provideService(undefined, ctx.service)
    assert.equal(typeof noop, 'function')
    noop()
  } finally {
    ctx.cleanup()
  }
})
