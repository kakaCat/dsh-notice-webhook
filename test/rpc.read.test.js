/**
 * RPC 只读端点的验收测试（t7a，覆盖 TC-21 的读侧与凭据脱敏）。
 *
 * 跑法：node --test test/rpc.read.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BindingStore } from '../src/bindings.js'
import { OutcomeStore } from '../src/outcomes.js'
import { RPC_PREFIX, createRpcHandler } from '../src/rpc.js'
import { TargetStore } from '../src/targets.js'

const silent = { warn() {} }

async function withServer(depsOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-rpc-read-'))
  const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })
  const bindings = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  const outcomes = new OutcomeStore()
  targets.save({ name: '项目群-企微', channel: 'wecom', url: 'https://example.com/a', isDefault: true })
  targets.save({ name: '钉钉群', channel: 'dingtalk', url: 'https://example.com/b', secretRef: 'DINGTALK_SECRET' })
  bindings.bindTargets('session-x', targets.list().map(t => t.id))
  outcomes.record(targets.list()[0].id, { ok: true, status: 200 })

  let revision = 0
  const deps = {
    targets,
    bindings,
    outcomes,
    defaults: () => ({ enabled: true, timeoutMs: 5000, retry: 0, cooldownMs: 0 }),
    revision: () => revision,
    bumpRevision: () => { revision += 1 },
    resolveSecret: () => undefined,
    deliverTest: async () => ({ ok: true, status: 200 }),
    logger: silent,
    ...depsOverrides,
  }

  const server = createServer(createRpcHandler(deps))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}${RPC_PREFIX}`,
    get revision() { return revision },
    targets,
    bindings,
    close: async () => { await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }) },
  }
}

const get = (base, path) => fetch(`${base}${path}`).then(r => r.json())

test('GET /state 返回完整状态投影（targets/bindings/defaults/outcomes/secrets/revision）', async () => {
  const ctx = await withServer()
  try {
    const state = await get(ctx.base, '/state')
    assert.equal(state.revision, 0)
    assert.equal(Array.isArray(state.targets), true)
    assert.equal(state.targets.length, 2)
    assert.equal(Array.isArray(state.bindings), true)
    assert.equal(state.bindings.length, 1)
    assert.equal(state.bindings[0].sessionId, 'session-x')
    assert.equal(typeof state.defaults, 'object')
    assert.equal(typeof state.outcomes, 'object')
    assert.equal(typeof state.secrets, 'object')
  } finally {
    await ctx.close()
  }
})

test('targets 投影不回密钥明文：secretRef 只回"是否已配置"', async () => {
  const ctx = await withServer({ resolveSecret: ref => ref === 'DINGTALK_SECRET' ? 'SECRET_VALUE' : undefined })
  try {
    const state = await get(ctx.base, '/state')
    const withSecret = state.targets.find(t => t.secretConfigured)
    assert.ok(withSecret !== undefined, '有一条目标配了密钥')
    assert.equal(withSecret.secretRef, 'DINGTALK_SECRET')
    assert.equal(withSecret.secretConfigured, true)
    assert.equal(withSecret.channel, 'dingtalk')
    // 密钥值绝不能出现在返回里
    assert.equal(JSON.stringify(state).includes('SECRET_VALUE'), false)

    const plain = state.targets.find(t => !t.secretConfigured)
    assert.equal(plain.secretRef, null)
    assert.equal(plain.secretConfigured, false)

    // secrets 段只回"是否已配置"
    assert.deepEqual(state.secrets, { DINGTALK_SECRET: true })
  } finally {
    await ctx.close()
  }
})

test('bindings 投影展开目标（name/channel/enabled），页面不必再 JOIN', async () => {
  const ctx = await withServer()
  try {
    const state = await get(ctx.base, '/state')
    const binding = state.bindings[0]
    assert.deepEqual(binding.targetIds.sort(), ctx.targets.list().map(t => t.id).sort())
    assert.equal(binding.targets.length, 2)
    for (const t of binding.targets) {
      assert.equal(typeof t.name, 'string')
      assert.equal(typeof t.channel, 'string')
      assert.equal(typeof t.enabled, 'boolean')
      assert.equal('url' in t, false, '展开不得带地址')
      assert.equal('secretRef' in t, false)
    }
  } finally {
    await ctx.close()
  }
})

test('目标被删除后，绑定里的悬空引用在投影里带"已删"标记（targets 里找不到该 id）', async () => {
  const ctx = await withServer()
  try {
    const removedId = ctx.targets.list()[1].id
    ctx.targets.remove(removedId)
    const state = await get(ctx.base, '/state')
    const binding = state.bindings[0]
    // 悬空 id 仍在 targetIds 里（数据真相），但展开里没有对应项
    assert.ok(binding.targetIds.includes(removedId), '悬空 id 应保留在 targetIds 供清理')
    assert.equal(binding.targets.some(t => t.id === removedId), false)
  } finally {
    await ctx.close()
  }
})

test('outcomes 与未知路径：GET / 等价 /state；未知路径 404', async () => {
  const ctx = await withServer()
  try {
    const state = await get(ctx.base, '/state')
    assert.equal(Object.keys(state.outcomes).length, 1)
    const state2 = await get(ctx.base, '/')
    assert.equal(state2.revision, 0)
    const res = await fetch(`${ctx.base}/nope`)
    assert.equal(res.status, 404)
  } finally {
    await ctx.close()
  }
})

/* ── t5：channelMeta 投影与 key ── */

test('t5：GET /state 含 channelMeta（六项、每项有 help）与目标的 key', async () => {
  const ctx = await withServer()
  try {
    const state = await get(ctx.base, '/state')
    const meta = state.channelMeta
    assert.ok(meta !== undefined, '必须有 channelMeta')
    assert.deepEqual(Object.keys(meta), ['wecom', 'dingtalk', 'feishu', 'slack', 'discord', 'custom'])
    for (const [channel, m] of Object.entries(meta)) {
      assert.equal(typeof m.label, 'string', `${channel} 缺 label`)
      assert.ok(['key', 'url'].includes(m.input), `${channel} input 取值不对`)
      assert.ok(m.help !== undefined && m.help.steps.length >= 2, `${channel} 缺 help`)
    }
    assert.equal(meta.wecom.keyLabel, '机器人 key')
    assert.equal('keyPattern' in meta.wecom, false, '正则不该进投影')
  } finally {
    await ctx.close()
  }
})

test('t5：目标投影带上 key（key 是地址的一部分，可回显）', async () => {
  const ctx = await withServer()
  try {
    // 种子数据是 url 形态的老目标，这里补一条「只填 key」的新目标
    const saved = ctx.targets.save({ name: '企微-新', channel: 'wecom', key: '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa' })
    assert.equal(saved.ok, true, JSON.stringify(saved.errors ?? ''))

    const state = await get(ctx.base, '/state')
    const withKey = state.targets.find(t => typeof t.key === 'string')
    assert.ok(withKey !== undefined, '应至少有一条带 key 的目标')
    assert.equal(withKey.url, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + withKey.key, 'key 与派生 url 应一致')
  } finally {
    await ctx.close()
  }
})
