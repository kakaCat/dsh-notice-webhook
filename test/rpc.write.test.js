/**
 * RPC 写入端点与 revision 栅栏的验收测试（t7b，覆盖 TC-14/TC-17/TC-21 与 FR-8）。
 *
 * 跑法：node --test test/rpc.write.test.js
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

async function withServer() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-rpc-write-'))
  const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })
  const bindings = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  const outcomes = new OutcomeStore()
  let revision = 0
  const deps = {
    targets, bindings, outcomes,
    defaults: () => ({ enabled: true }),
    revision: () => revision,
    bumpRevision: () => { revision += 1 },
    resolveSecret: () => undefined,
    deliverTest: async (target) => ({ ok: true, status: 200, note: `delivered to ${target.id}` }),
    logger: silent,
  }
  const server = createServer(createRpcHandler(deps))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}${RPC_PREFIX}`,
    get revision() { return revision },
    targets, bindings,
    close: async () => { await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }) },
  }
}

const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }))

const goodTarget = { name: '企微群', channel: 'wecom', url: 'https://example.com/hook', enabled: true, events: [], isDefault: true }

test('POST /targets：合法写入返回 ok 与递增 revision', async () => {
  const ctx = await withServer()
  try {
    const res = await post(ctx.base, '/targets', { revision: 0, target: goodTarget })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.revision, 1)
    assert.equal(res.body.targets.length, 1)
  } finally {
    await ctx.close()
  }
})

test('POST /targets：过期 revision → 409 且清单不变', async () => {
  const ctx = await withServer()
  try {
    await post(ctx.base, '/targets', { revision: 0, target: goodTarget })
    const stale = await post(ctx.base, '/targets', { revision: 0, target: { ...goodTarget, name: '另一个' } })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.ok, false)
    assert.match(stale.body.reason, /已被其他页面修改/)
    assert.equal(stale.body.targets.length, 1, '清单必须保持 1 条（没被第二个写进去）')
    assert.equal(stale.body.revision, 1, '返回最新 revision 供客户端重试')
  } finally {
    await ctx.close()
  }
})

test('POST /targets：校验失败 → 400 且不落盘', async () => {
  const ctx = await withServer()
  try {
    const res = await post(ctx.base, '/targets', { revision: 0, target: { ...goodTarget, url: 'ftp://x' } })
    assert.equal(res.status, 400)
    assert.equal(res.body.ok, false)
    assert.ok(res.body.errors.length > 0)
    assert.equal(ctx.targets.list().length, 0, '校验失败不得落盘')
    assert.equal(ctx.revision, 0, '失败的写不 bump revision')
  } finally {
    await ctx.close()
  }
})

test('POST /targets/delete：删存在的返回 ok，删不存在的 404', async () => {
  const ctx = await withServer()
  try {
    const created = await post(ctx.base, '/targets', { revision: 0, target: goodTarget })
    const id = created.body.targets[0].id
    const res = await post(ctx.base, '/targets/delete', { revision: ctx.revision, id })
    assert.equal(res.status, 200)
    assert.equal(ctx.targets.list().length, 0)

    const again = await post(ctx.base, '/targets/delete', { revision: ctx.revision, id })
    assert.equal(again.status, 404)
  } finally {
    await ctx.close()
  }
})

test('POST /bind：绑定会话到目标；目标不存在 400 且整笔不生效', async () => {
  const ctx = await withServer()
  try {
    const created = await post(ctx.base, '/targets', { revision: 0, target: goodTarget })
    const id = created.body.targets[0].id
    const res = await post(ctx.base, '/bind', { revision: ctx.revision, sessionId: 'session-x', targetIds: [id] })
    assert.equal(res.status, 200)
    assert.deepEqual(ctx.bindings.targetIdsOf('session-x'), [id])
    assert.equal(res.body.bindings.length, 1)

    const bad = await post(ctx.base, '/bind', { revision: ctx.revision, sessionId: 'session-y', targetIds: [id, 'nope'] })
    assert.equal(bad.status, 400)
    assert.deepEqual(ctx.bindings.targetIdsOf('session-y'), [], '部分绑定不得生效')
  } finally {
    await ctx.close()
  }
})

test('POST /bindings/delete：解绑回落；无绑定 404', async () => {
  const ctx = await withServer()
  try {
    const created = await post(ctx.base, '/targets', { revision: 0, target: goodTarget })
    const id = created.body.targets[0].id
    await post(ctx.base, '/bind', { revision: ctx.revision, sessionId: 'session-x', targetIds: [id] })
    const res = await post(ctx.base, '/bindings/delete', { revision: ctx.revision, sessionId: 'session-x' })
    assert.equal(res.status, 200)
    assert.deepEqual(ctx.bindings.targetIdsOf('session-x'), [])

    const again = await post(ctx.base, '/bindings/delete', { revision: ctx.revision, sessionId: 'session-x' })
    assert.equal(again.status, 404)
  } finally {
    await ctx.close()
  }
})

test('POST /test：调 deliverTest 并原样回传；目标不存在 404', async () => {
  const ctx = await withServer()
  try {
    const created = await post(ctx.base, '/targets', { revision: 0, target: goodTarget })
    const id = created.body.targets[0].id
    const res = await post(ctx.base, '/test', { id })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.match(res.body.note, /delivered/)

    const missing = await post(ctx.base, '/test', { id: 'nope' })
    assert.equal(missing.status, 404)
  } finally {
    await ctx.close()
  }
})

test('写操作缺失 revision 一律 409', async () => {
  const ctx = await withServer()
  try {
    const res = await post(ctx.base, '/targets', { target: goodTarget })
    assert.equal(res.status, 409, '没带 revision 的写被拒')
  } finally {
    await ctx.close()
  }
})

/* ── 保存后回传目标（新建后要立刻能发送测试） ── */

test('POST /targets 成功后响应里带回该目标（含新生成的 id）', async () => {
  const ctx = await withServer()
  try {
    const res = await post(ctx.base, '/targets', {
      revision: 0,
      target: { name: '新建的企微', channel: 'wecom', key: '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa' },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.ok(res.body.target !== undefined, '响应必须带回保存后的目标')
    assert.equal(typeof res.body.target.id, 'string')
    assert.equal(res.body.target.name, '新建的企微')
    assert.ok(res.body.target.url.endsWith('693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa'))
    // 兼容性：老字段仍在
    assert.ok(Array.isArray(res.body.targets))
    assert.equal(res.body.revision > 0, true)
  } finally {
    await ctx.close()
  }
})
