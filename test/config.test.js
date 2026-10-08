/**
 * 插件 Config schema 的验收测试（t1）。
 *
 * 跑法：node --test test/config.test.js
 *
 * 断言三件事：
 * 1. schema 能解析出全部默认值（且与 DEFAULTS 一致——两处默认值不许漂移）；
 * 2. 标了 .volatile() 的字段集合与设计一致（volatile 字段解析成引用，用 .get() 读）；
 * 3. 取值规整（normalizeConfig）对越界值回落默认并告警。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Config, DEFAULTS, VOLATILE_KEYS, normalizeConfig } from '../src/config.js'

const silent = { warn() {} }

/** volatile 字段解析成"稳定引用"，用 .get() 读；普通字段就是普通值。 */
function unwrap(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

test('Config 解析出全部默认值，且与 DEFAULTS 一致（两处默认值不许漂移）', () => {
  const parsed = Config({})
  for (const [key, expected] of Object.entries(DEFAULTS)) {
    const actual = unwrap(parsed[key])
    assert.deepEqual(actual, expected, `字段 ${key} 的默认值与 DEFAULTS 不一致`)
  }
  // 反向：schema 不许出现 DEFAULTS 里没有的字段（避免"声明了却没实现"）
  for (const key of Object.keys(parsed)) {
    assert.ok(key in DEFAULTS, `Config 声明的 ${key} 不在 DEFAULTS 里`)
  }
})

test('volatile 字段集合与设计一致：恰好这 11 个', () => {
  const parsed = Config({})
  const actual = Object.entries(parsed)
    .filter(([, value]) => value !== null && typeof value === 'object' && typeof value.get === 'function')
    .map(([key]) => key)
    .sort()
  assert.deepEqual(actual, [...VOLATILE_KEYS].sort())
  // 抽查两个代表：一个 volatile（总开关）、一个普通（webhookUrl）
  assert.equal(typeof parsed.enabled.get, 'function')
  assert.equal(parsed.webhookUrl, '')
})

test('volatile 字段仍能读到默认值本身', () => {
  const parsed = Config({})
  assert.equal(parsed.timeoutMs.get(), 5000)
  assert.equal(parsed.enabled.get(), true)
  // REQ-261001203114-19b6：skipReasons 收紧为「静默名单」，默认只留用户自己按的 Esc；
  // interrupted 由静默改为推送中断通知（这是该需求的目的）。
  assert.deepEqual(parsed.skipReasons, ['aborted'])
})

test('schema 能接受覆盖值', () => {
  const parsed = Config({ enabled: false, timeoutMs: 1000, webhookUrl: 'https://example.com/hook' })
  assert.equal(parsed.enabled.get(), false)
  assert.equal(parsed.timeoutMs.get(), 1000)
  assert.equal(parsed.webhookUrl, 'https://example.com/hook')
})

test('normalizeConfig：越界与类型不符回落默认并告警（不抛异常）', () => {
  const warnings = []
  const out = normalizeConfig({ timeoutMs: -1, retry: 'many', notifyApproval: 'yes', skipReasons: 'nope' }, {
    warn: m => warnings.push(String(m)),
  })
  assert.equal(out.timeoutMs, DEFAULTS.timeoutMs)
  assert.equal(out.retry, DEFAULTS.retry)
  assert.equal(out.notifyApproval, DEFAULTS.notifyApproval)
  assert.deepEqual(out.skipReasons, DEFAULTS.skipReasons)
  assert.equal(warnings.length, 4, `每条坏配置都要有告警，实际 ${warnings.length} 条`)
})

test('normalizeConfig：合法配置原样保留', () => {
  const out = normalizeConfig({ enabled: false, webhookUrl: 'https://example.com/hook', retry: 2, cooldownMs: 500 }, silent)
  assert.equal(out.enabled, false)
  assert.equal(out.webhookUrl, 'https://example.com/hook')
  assert.equal(out.retry, 2)
  assert.equal(out.cooldownMs, 500)
})
