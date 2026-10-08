/**
 * 投递结果存储的验收测试（t4）。
 *
 * 跑法：node --test test/outcomes.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_OUTCOMES, OutcomeStore } from '../src/outcomes.js'

test('每目标保留最近 5 条，超限淘汰最旧', () => {
  const store = new OutcomeStore()
  assert.equal(MAX_OUTCOMES, 5)
  for (let i = 1; i <= 7; i += 1) {
    store.record('t-a', { at: `2026-09-30T00:00:0${i}.000Z`, ok: i % 2 === 1, status: i % 2 === 1 ? 200 : 500 })
  }
  const list = store.list('t-a')
  assert.equal(list.length, 5)
  // 最新在前：第 7 条在最前，第 3 条是最旧的保留项
  assert.equal(list[0].at, '2026-09-30T00:00:07.000Z')
  assert.equal(list[4].at, '2026-09-30T00:00:03.000Z')
})

test('结果按目标隔离，snapshot 覆盖全部目标', () => {
  const store = new OutcomeStore()
  store.record('t-a', { at: '2026-09-30T00:00:01.000Z', ok: true, status: 200 })
  store.record('t-b', { at: '2026-09-30T00:00:02.000Z', ok: false, reason: 'errcode 310000' })
  assert.equal(store.list('t-a').length, 1)
  assert.equal(store.list('t-b').length, 1)
  assert.deepEqual(Object.keys(store.snapshot()).sort(), ['t-a', 't-b'])
  assert.deepEqual(store.list('t-none'), [])
})

test('失败原因与状态码按需保留，成功结果不带 reason 键', () => {
  const store = new OutcomeStore()
  const ok = store.record('t-a', { ok: true, status: 204 })
  const bad = store.record('t-b', { ok: false, status: 200, reason: 'keywords not in content' })
  assert.equal('reason' in ok, false)
  assert.equal(bad.status, 200)
  assert.equal(bad.reason, 'keywords not in content')
  assert.equal(typeof ok.at, 'string')
})

test('非法 targetId 被忽略，不产生孤儿键', () => {
  const store = new OutcomeStore()
  assert.equal(store.record('', { ok: true }), undefined)
  assert.equal(store.record(undefined, { ok: true }), undefined)
  assert.deepEqual(store.snapshot(), {})
})

test('forget 清掉某目标的结果（目标被删除时调用）', () => {
  const store = new OutcomeStore()
  store.record('t-a', { ok: true })
  assert.equal(store.forget('t-a'), true)
  assert.deepEqual(store.list('t-a'), [])
  assert.equal(store.forget('t-a'), false)
})

test('限流参数可调（单测/调试用）', () => {
  const store = new OutcomeStore({ limit: 2 })
  store.record('t-a', { at: '1', ok: true })
  store.record('t-a', { at: '2', ok: true })
  store.record('t-a', { at: '3', ok: true })
  assert.deepEqual(store.list('t-a').map(o => o.at), ['3', '2'])
})
