/**
 * 多目标主链路端到端（t9，覆盖五类事件、扇出隔离、legacy 兼容、绑定替代默认组）。
 *
 * 跑法：node --test test/e2e.multi.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNotifier } from '../index.js'
import { BindingStore } from '../src/bindings.js'
import { OutcomeStore } from '../src/outcomes.js'
import { TargetStore } from '../src/targets.js'

const silent = { warn() {}, info() {}, debug() {} }

function withReceiver(respond) {
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    received.push({ path: req.url, body: (() => { try { return JSON.parse(body) } catch { return body } })() })
    if (respond) await respond(req, res)
    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"errcode":0,"errmsg":"ok"}') }
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ received, url: `http://127.0.0.1:${port}/hook`, close: () => new Promise(done => server.close(done)) })
    })
  })
}

/** 等到接收端至少收到 `count` 条；超时抛出带条数的错误。 */
async function waitFor(received, count, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (received.length < count && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  if (received.length < count) {
    throw new Error(`等待投递超时：期望至少 ${count} 条，实际 ${received.length} 条（${timeoutMs}ms）`)
  }
  return received.length
}

/**
 * 等到投递结果记录到 `count` 条。
 *
 * 投递结果是投递 Promise 落定后写入的（异步），与"接收端收到"不同步——
 * 只等接收端就断言会偶发少一条。
 */
async function waitForOutcomes(list, count, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (list.length < count && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  if (list.length < count) {
    throw new Error(`等待投递结果超时：期望 ${count} 条，实际 ${list.length} 条（${timeoutMs}ms）`)
  }
  return list.length
}

function tempStores() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-e2e-multi-'))
  return {
    targets: new TargetStore({ path: join(dir, 'targets.json'), logger: silent }),
    bindings: new BindingStore({ path: join(dir, 'bindings.json'), logger: silent }),
    outcomes: new OutcomeStore(),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const session = { header: { id: 'session-e2e', cwd: '/tmp/ws' } }
const events = [
  { type: 'session/title', data: { title: '修复登录 bug' } },
  { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  { type: 'approval/asked', data: { toolName: 'Bash' } },
  { type: 'user-questions/request', data: { questions: [{ id: 'q1', header: '选择方案', question: '要 A 还是 B？' }] } },
  { type: 'goal/change', data: { goal: { id: 'goal-A', revision: 1, phase: 'complete' } } },
  { type: 'goal/change', data: { goal: { id: 'goal-B', revision: 1, phase: 'blocked', maxGoalRounds: 20, blockedReason: { code: 'round-limit', message: 'x' } } } },
]

test('五类事件按目标集合投递到渠道报文', async () => {
  const receiver = await withReceiver()
  const s = tempStores()
  try {
    const t = s.targets.save({ name: '企微群', channel: 'wecom', url: receiver.url, enabled: true, isDefault: true, events: [] }).target
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    for (const e of events) notifier.handle(session, e)
    await waitFor(receiver.received, 5)

    assert.equal(receiver.received.length, 5)
    const got = receiver.received.map(r => r.body)
    for (const body of got) {
      assert.equal(body.msgtype, 'markdown', '企业微信渠道报文')
      assert.equal(typeof body.markdown.content, 'string')
    }
    const contents = got.map(b => b.markdown.content)
    assert.ok(contents.some(c => c.includes('会话已完成')))
    assert.ok(contents.some(c => c.includes('需要你允许执行操作（Bash）')))
    assert.ok(contents.some(c => c.includes('需要你回答一个问题')))
    assert.ok(contents.some(c => c.includes('目标已完成')))
    assert.ok(contents.some(c => c.includes('轮次耗尽')))

    // 结果都记上了。注意：投递结果是在投递 Promise 落定后**异步**写入的，
    // 接收端收到第 5 条时它的 outcome 可能还差一个 tick——所以这里也要等待，
    // 不能直接断言（曾因此在全量并发时偶发 4 !== 5）。
    await waitForOutcomes(s.outcomes.list(t.id), 5)
    const outcomes = s.outcomes.list(t.id)
    assert.equal(outcomes.length, 5)
    assert.ok(outcomes.every(o => o.ok))
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('扇出隔离：一个目标不可达不影响另一个，且失败记了原因', async () => {
  const receiver = await withReceiver()
  const s = tempStores()
  try {
    const ok = s.targets.save({ name: '可达', channel: 'custom', url: receiver.url, enabled: true, isDefault: true, events: [] }).target
    const bad = s.targets.save({ name: '不可达', channel: 'custom', url: 'http://127.0.0.1:1/hook', enabled: true, isDefault: true, events: [] }).target
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await waitFor(receiver.received, 1)

    assert.equal(receiver.received.length, 1, '可达目标收到')
    // 失败的投递同样异步记录结果
    await waitForOutcomes(s.outcomes.list(bad.id), 1)
    const badOutcomes = s.outcomes.list(bad.id)
    assert.equal(badOutcomes.length, 1)
    assert.equal(badOutcomes[0].ok, false)
    assert.ok(badOutcomes[0].reason)
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('TC-15：legacy 兼容——只配 webhookUrl 与老 bindings.json，报文仍是 v1 契约', async () => {
  const receiver = await withReceiver()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-legacy-'))
  try {
    // 老形态的 bindings.json（sessionId → url）
    const bindings = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
    bindings.bind('session-old', receiver.url)
    const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })

    const notifier = createNotifier({ webhookUrl: 'https://example.com/default' }, { logger: silent, targets, bindings })
    // legacy 映射应建立隐式默认目标
    assert.ok(targets.list().length >= 1, 'webhookUrl 映射出隐式目标')

    const old = { header: { id: 'session-old' } }
    notifier.handle(old, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await waitFor(receiver.received, 1)

    assert.equal(receiver.received.length, 1)
    const payload = receiver.received[0].body
    assert.equal(payload.version, 1)
    assert.equal(payload.event, 'turn/end')
    assert.equal(payload.source, 'dsh-notice-webhook')
    assert.ok(payload.message.includes('会话已完成'))
  } finally {
    await receiver.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test('绑定替代默认组：绑定的会话只发绑定目标，默认组不发', async () => {
  const boundReceiver = await withReceiver()
  const defaultReceiver = await withReceiver()
  const s = tempStores()
  try {
    s.targets.save({ name: '默认群', channel: 'custom', url: defaultReceiver.url, enabled: true, isDefault: true, events: [] })
    const bound = s.targets.save({ name: '绑定群', channel: 'custom', url: boundReceiver.url, enabled: true, isDefault: false, events: [] }).target
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    // 会话 X 绑定 bound；会话 Y 不绑
    notifier.service.bindTargets('session-x', [bound.id])
    notifier.handle({ header: { id: 'session-x' } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    notifier.handle({ header: { id: 'session-y' } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await waitFor(boundReceiver.received, 1)
    await waitFor(defaultReceiver.received, 1)

    assert.equal(boundReceiver.received.length, 1, '绑定会话只到绑定目标')
    assert.equal(defaultReceiver.received.length, 1, '未绑定会话到默认组')
  } finally {
    await boundReceiver.close(); await defaultReceiver.close(); s.cleanup()
  }
})

test('业务码失败：HTTP 200 但 errcode≠0 判定失败并记原因', async () => {
  const receiver = await withReceiver((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"errcode":310000,"errmsg":"keywords not in content"}')
  })
  const s = tempStores()
  try {
    const t = s.targets.save({ name: '企微群', channel: 'wecom', url: receiver.url, enabled: true, isDefault: true, events: [] }).target
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await waitFor(receiver.received, 1)

    await waitForOutcomes(s.outcomes.list(t.id), 1)
    const outcomes = s.outcomes.list(t.id)
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0].ok, false, 'HTTP 200 但 errcode≠0 → 失败')
    assert.match(outcomes[0].reason, /310000|keywords not in content/)
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('goal 自动轮静默：整轮系统注入的 turn/end 不投递', async () => {
  const receiver = await withReceiver()
  const s = tempStores()
  try {
    s.targets.save({ name: '群', channel: 'custom', url: receiver.url, enabled: true, isDefault: true, events: [] })
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    // 三轮自动轮（goal 注入）
    for (let r = 1; r <= 3; r += 1) {
      notifier.handle(session, { type: 'user/message', data: { source: { kind: 'goal', goalId: 'g', revision: 1, round: r } } })
      notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    }
    await new Promise(r => setTimeout(r, 200))
    assert.equal(receiver.received.length, 0, '自动轮一律静默')

    // 人工轮照常
    notifier.handle(session, { type: 'user/message', data: { source: { kind: 'user' } } })
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await waitFor(receiver.received, 1)
    assert.equal(receiver.received.length, 1)
  } finally {
    await receiver.close(); s.cleanup()
  }
})
