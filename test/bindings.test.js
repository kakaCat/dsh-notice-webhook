/**
 * 绑定表与原子持久化的单测（覆盖 TC-13 及 t2 验收）。
 *
 * 跑法：node --test test/bindings.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BindingStore, FILE_VERSION, isValidEndpoint } from '../src/bindings.js'

const silent = { warn() {} }

function withTempPath(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-bindings-'))
  try {
    return run(join(dir, 'nested', 'bindings.json'), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('bind 后落盘内容为 {version:1, bindings:{...}} 且可读回', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent })
    assert.equal(store.bind('session-a', 'https://example.com/hook'), true)

    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.version, FILE_VERSION)
    assert.equal(onDisk.bindings['session-a'].url, 'https://example.com/hook')
    assert.equal(typeof onDisk.bindings['session-a'].updatedAt, 'string')

    const reloaded = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.resolve('session-a'), { url: 'https://example.com/hook', source: 'binding' })
  })
})

test('文件缺失时按空表启动，且不创建文件', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(store.list(), [])
    assert.equal(existsSync(path), false)
  })
})

test('文件是非法 JSON 时按空表启动，且原文件字节不变', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent })
    // 先建目录并写坏文件
    store.bind('session-a', 'https://example.com/hook')
    const broken = '{broken\n'
    writeFileSync(path, broken, 'utf8')
    const before = readFileSync(path)

    const reloaded = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.list(), [])
    assert.deepEqual(readFileSync(path), before, '原文件必须保持不变')
  })
})

test('未知 version 时按空表启动且不覆盖原文件', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-a', 'https://example.com/hook')
    const future = JSON.stringify({ version: 99, bindings: { 'session-a': { url: 'https://example.com/old' } } })
    writeFileSync(path, future, 'utf8')

    const reloaded = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.list(), [])
    assert.equal(readFileSync(path, 'utf8'), future, '原文件必须保持不变')
  })
})

test('单条记录非法只跳过该条，其余照常加载', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-ok', 'https://example.com/ok')
    const messy = JSON.stringify({
      version: FILE_VERSION,
      bindings: {
        'session-ok': { url: 'https://example.com/ok', updatedAt: '2026-01-01T00:00:00.000Z' },
        'session-bad': { url: 'ftp://example.com/nope' },
      },
    })
    writeFileSync(path, messy, 'utf8')

    const reloaded = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.list().map(e => e.sessionId), ['session-ok'])
  })
})

test('bind 参数非法返回 false 且不写表', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent })
    assert.equal(store.bind('', 'https://example.com/hook'), false)
    assert.equal(store.bind(null, 'https://example.com/hook'), false)
    assert.equal(store.bind('session-a', 'ftp://example.com/hook'), false)
    assert.equal(store.bind('session-a', 'not-a-url'), false)
    assert.deepEqual(store.list(), [])
    assert.equal(existsSync(path), false)
  })
})

test('unbind 不存在时返回 false；存在时返回 true 并落盘', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent })
    assert.equal(store.unbind('session-a'), false)
    store.bind('session-a', 'https://example.com/hook')
    assert.equal(store.unbind('session-a'), true)
    const reloaded = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.list(), [])
  })
})

test('list 按 sessionId 升序；resolve 缺省回落默认地址', () => {
  withTempPath(path => {
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-c', 'https://example.com/c')
    store.bind('session-a', 'https://example.com/a')
    assert.deepEqual(store.list().map(e => e.sessionId), ['session-a', 'session-c'])
    assert.deepEqual(store.resolve('session-c'), { url: 'https://example.com/c', source: 'binding' })
    assert.deepEqual(store.resolve('session-none', 'https://example.com/default'), { url: 'https://example.com/default', source: 'default' })
    assert.equal(store.resolve('session-none'), null)
    assert.equal(store.resolve('session-none', ''), null)
  })
})

test('isValidEndpoint 只认 http/https 绝对地址', () => {
  assert.equal(isValidEndpoint('https://example.com/hook'), true)
  assert.equal(isValidEndpoint('http://127.0.0.1:8899/hook'), true)
  assert.equal(isValidEndpoint('ftp://example.com'), false)
  assert.equal(isValidEndpoint('example.com'), false)
  assert.equal(isValidEndpoint(''), false)
  assert.equal(isValidEndpoint(undefined), false)
})
