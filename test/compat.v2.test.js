/**
 * 兼容与回滚的验收测试（t15，覆盖 TC-15 / TC-16 与回滚安全）。
 *
 * 跑法：node --test test/compat.v2.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNotifier } from '../index.js'
import { BindingStore, FILE_VERSION } from '../src/bindings.js'
import { OutcomeStore } from '../src/outcomes.js'
import { TARGET_FILE_VERSION, TargetStore } from '../src/targets.js'

const silent = { warn() {}, info() {}, debug() {} }

async function withReceiver() {
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    received.push((() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null } })())
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"errcode":0}')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { received, url: `http://127.0.0.1:${port}/hook`, close: () => new Promise(d => server.close(d)) }
}

/** 等到接收端至少收到 n 条；超时抛出带条数的错误（并发跑测试时投递可能被拖慢）。 */
async function waitFor(list, n, ms = 8000) {
  const end = Date.now() + ms
  while (list.length < n && Date.now() < end) await new Promise(r => setTimeout(r, 20))
  if (list.length < n) throw new Error(`等待投递超时：期望至少 ${n} 条，实际 ${list.length} 条（${ms}ms）`)
  return list.length
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-compat-v2-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const session = { header: { id: 'session-legacy' } }
const turnEnd = { type: 'turn/end', data: { reason: { kind: 'completed' } } }

test('TC-15 legacy：webhookUrl 映射出隐式 custom 默认目标', () => {
  const t = tempDir()
  try {
    const targets = new TargetStore({ path: join(t.dir, 'targets.json'), logger: silent })
    const bindings = new BindingStore({ path: join(t.dir, 'bindings.json'), logger: silent })
    createNotifier({ webhookUrl: 'https://example.com/hook' }, { logger: silent, targets, bindings })

    const list = targets.list()
    assert.equal(list.length, 1)
    assert.equal(list[0].channel, 'custom')
    assert.equal(list[0].url, 'https://example.com/hook')
    assert.equal(list[0].isDefault, true)
    assert.equal(list[0].enabled, true)
    // 再启动一次：靠 channel+url 匹配，不重复建（id 稳定）
    createNotifier({ webhookUrl: 'https://example.com/hook' }, { logger: silent, targets, bindings })
    assert.equal(targets.list().length, 1, '重复启动不重复建隐式目标')
    assert.equal(targets.list()[0].id, list[0].id)
  } finally {
    t.cleanup()
  }
})

test('legacy 与显式清单同 url 时只保留一条（不重复建、不双发）', async () => {
  const receiver = await withReceiver()
  const t = tempDir()
  try {
    const targets = new TargetStore({ path: join(t.dir, 'targets.json'), logger: silent })
    const bindings = new BindingStore({ path: join(t.dir, 'bindings.json'), logger: silent })
    // 显式清单里已有同 url 的 custom 目标
    targets.save({ name: '显式同名', channel: 'custom', url: receiver.url, enabled: true, events: [], isDefault: true })

    createNotifier({ webhookUrl: receiver.url }, { logger: silent, targets, bindings })
    assert.equal(targets.list().length, 1, '同 url 只保留一条')

    const notifier = createNotifier({ webhookUrl: receiver.url }, { logger: silent, targets, bindings, outcomes: new OutcomeStore() })
    notifier.handle(session, turnEnd)
    await waitFor(receiver.received, 1)
    await new Promise(r => setTimeout(r, 150))
    assert.equal(receiver.received.length, 1, '同 url 不得发两遍')
  } finally {
    await receiver.close(); t.cleanup()
  }
})

test('老 bindings.json（sessionId → url）映射为目标绑定，且报文仍是 v1 契约', async () => {
  const receiver = await withReceiver()
  const t = tempDir()
  try {
    // 先用 v1 语义写一份老绑定文件
    const seed = new BindingStore({ path: join(t.dir, 'bindings.json'), logger: silent })
    seed.bind('session-legacy', receiver.url)

    const bindings = new BindingStore({ path: join(t.dir, 'bindings.json'), logger: silent }).load()
    const targets = new TargetStore({ path: join(t.dir, 'targets.json'), logger: silent })
    const notifier = createNotifier({}, { logger: silent, targets, bindings, outcomes: new OutcomeStore() })

    assert.equal(bindings.targetIdsOf('session-legacy').length, 1, '老绑定被映射为目标绑定')
    notifier.handle(session, turnEnd)
    await waitFor(receiver.received, 1)

    const payload = receiver.received[0]
    assert.equal(payload.version, 1, 'v1 契约版本不变')
    assert.equal(payload.event, 'turn/end')
    assert.equal(payload.source, 'dsh-notice-webhook')
    assert.ok(payload.message.includes('会话已完成'))
  } finally {
    await receiver.close(); t.cleanup()
  }
})

test('TC-16 坏文件：targets.json 非法 / 未知 version → 空清单且不覆盖，legacy 仍工作', async () => {
  const receiver = await withReceiver()
  const t = tempDir()
  try {
    const path = join(t.dir, 'targets.json')
    for (const bad of ['{broken\n', JSON.stringify({ version: TARGET_FILE_VERSION + 98, targets: [] })]) {
      writeFileSync(path, bad, 'utf8')
      const targets = new TargetStore({ path, logger: silent }).load()
      assert.deepEqual(targets.list(), [])
      assert.equal(readFileSync(path, 'utf8'), bad, '原文件必须保持不变')

      // 坏清单不影响 legacy 通道
      const bindings = new BindingStore({ path: join(t.dir, 'bindings.json'), logger: silent })
      const notifier = createNotifier({ webhookUrl: receiver.url }, { logger: silent, targets: new TargetStore({ path: join(t.dir, 'targets2.json'), logger: silent }), bindings, outcomes: new OutcomeStore() })
      notifier.handle({ header: { id: 'session-x' } }, turnEnd)
      await waitFor(receiver.received, receiver.received.length + 1)
    }
    assert.ok(receiver.received.length >= 2, '坏清单下 legacy 通道照常发')
  } finally {
    await receiver.close(); t.cleanup()
  }
})

test('坏 bindings.json：空表且不覆盖（沿用既有口径）', () => {
  const t = tempDir()
  try {
    const path = join(t.dir, 'bindings.json')
    const bad = '{"version": 1, "bindings": '  // 截断
    writeFileSync(path, bad, 'utf8')
    const store = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(store.list(), [])
    assert.deepEqual(store.listBindings(), [])
    assert.equal(readFileSync(path, 'utf8'), bad)
  } finally {
    t.cleanup()
  }
})

test('回滚安全：旧版本读新 bindings.json 不报错（忽略 targetBindings 未知键）', () => {
  const t = tempDir()
  try {
    const path = join(t.dir, 'bindings.json')
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-a', 'https://example.com/a')
    store.bindTargets('session-a', ['t-1'])

    // 旧版本：只认 version 与 bindings 段
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(raw.version, FILE_VERSION, '文件版本不变，旧版本不会走"未知版本"分支')
    assert.equal(raw.bindings['session-a'].url, 'https://example.com/a', '旧段仍被维护')
    assert.equal(typeof raw.targetBindings, 'object', '新段存在但旧版本忽略它')
  } finally {
    t.cleanup()
  }
})

test('卸载残留：状态目录只留 targets.json 与 bindings.json（无 .tmp）', () => {
  const t = tempDir()
  try {
    const stateDir = join(t.dir, 'state', 'dsh-notice-webhook')
    const targets = new TargetStore({ path: join(stateDir, 'targets.json'), logger: silent })
    const bindings = new BindingStore({ path: join(stateDir, 'bindings.json'), logger: silent })
    targets.save({ name: '群', channel: 'wecom', url: 'https://example.com/hook' })
    bindings.bindTargets('session-a', ['t-1'])

    assert.deepEqual(readdirSync(stateDir).sort(), ['bindings.json', 'targets.json'], '无 .tmp 等中间文件')
    // 卸载 = 删掉这个目录即完全回滚（不碰任何会话数据）
    rmSync(stateDir, { recursive: true, force: true })
    assert.equal(existsSync(stateDir), false)
    assert.deepEqual(new TargetStore({ path: join(stateDir, 'targets.json'), logger: silent }).load().list(), [])
  } finally {
    t.cleanup()
  }
})

test('未配置任何东西：不建文件、不报错（零迁移）', () => {
  const t = tempDir()
  try {
    const stateDir = join(t.dir, 'state', 'dsh-notice-webhook')
    mkdirSync(stateDir, { recursive: true })
    const targets = new TargetStore({ path: join(stateDir, 'targets.json'), logger: silent })
    const bindings = new BindingStore({ path: join(stateDir, 'bindings.json'), logger: silent }).load()
    const notifier = createNotifier({}, { logger: silent, targets, bindings, outcomes: new OutcomeStore() })
    assert.deepEqual(notifier.handle({ header: { id: 's' } }, turnEnd), { action: 'dropped', reason: 'no-targets', intent: notifier.handle({ header: { id: 's' } }, turnEnd).intent })
    assert.deepEqual(readdirSync(stateDir), [], '不推送就不该创建任何文件')
  } finally {
    t.cleanup()
  }
})
