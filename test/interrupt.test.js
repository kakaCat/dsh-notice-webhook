/**
 * 会话异常中断通知的链路验收 —— REQ-261001203114-19b6（t7，覆盖设计 TC-4 / TC-5）。
 *
 * 钉死的三件事：
 * 1. `turn/end(error)` 出来的报文是 `turn/error`（带 reason / error），**不再是** `turn/end`「会话已完成」；
 * 2. 错误详情单行化 + 限长，缺字段不抛异常；
 * 3. 开关与静默名单各管各的，且自动轮里报错**照叫**（只有「完成」才受自动轮静默约束）。
 *
 * 跑法：node --test test/interrupt.test.js
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
import { eventMeta } from '../src/payload.js'

const silent = { warn() {}, info() {}, debug() {} }

function withReceiver() {
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    received.push((() => { try { return JSON.parse(body) } catch { return body } })())
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ received, url: `http://127.0.0.1:${port}/hook`, close: () => new Promise(done => server.close(done)) })
    })
  })
}

/** 等到收到 `count` 条；超时抛出带条数的错误（默认 20s，失败要快而清楚）。 */
async function waitFor(received, count, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (received.length < count && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
  if (received.length < count) throw new Error(`等待投递超时：期望至少 ${count} 条，实际 ${received.length} 条`)
  return received.length
}

/** 给「不该收到任何东西」的用例一个确定的静默期（投递是异步的，立刻断言会假绿）。 */
async function settle(ms = 150) {
  await new Promise(r => setTimeout(r, ms))
}

function setup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-interrupt-'))
  const targets = new TargetStore({ path: join(dir, 'targets.json'), logger: silent })
  const bindings = new BindingStore({ path: join(dir, 'bindings.json'), logger: silent })
  const outcomes = new OutcomeStore()
  return { dir, targets, bindings, outcomes, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const session = { header: { id: 'session-interrupt', cwd: '/tmp/ws' } }

/** custom 渠道目标（原样 JSON，字段可逐字断言）。 */
function customTarget(stores, url, extra = {}) {
  const verdict = stores.targets.save({ name: '手机', channel: 'custom', url, enabled: true, isDefault: true, events: [], ...extra })
  assert.equal(verdict.ok, true, JSON.stringify(verdict.errors))
  return verdict.target
}

const MALFORMED = { code: 'MALFORMED_RESPONSE', message: 'DeepSeek Messages stream: tool input is invalid JSON' }

test('T4-1/T4-6：流报错 → 推 turn/error（带 reason/error），不再推「会话已完成」', async () => {
  const receiver = await withReceiver()
  const s = setup()
  try {
    customTarget(s, receiver.url)
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: MALFORMED } } })
    await waitFor(receiver.received, 1)
    await settle()

    assert.equal(receiver.received.length, 1, '一次中断只推一条')
    const body = receiver.received[0]
    assert.equal(body.event, 'turn/error')
    assert.equal(body.version, 1)
    assert.equal(body.reason, 'error')
    assert.deepEqual(body.error, MALFORMED)
    assert.ok(body.message.includes('会话异常中断（MALFORMED_RESPONSE）'), body.message)
    assert.equal(receiver.received.some(b => b.event === 'turn/end'), false, '**绝不能**同时推一条「已完成」')
    assert.deepEqual(eventMeta('turn/error'), { title: '⚠️ 会话中断', color: 'red' })
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('T4-2/T4-3：错误详情单行化 + 限长；缺字段回落 UNKNOWN 且不抛异常', async () => {
  const receiver = await withReceiver()
  const s = setup()
  try {
    customTarget(s, receiver.url)
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    const long = `第一行\n第二行\t第三行 ${'x'.repeat(300)}`
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'BOOM', message: long } } } })
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'error', error: {} } } })
    await waitFor(receiver.received, 2)
    await settle()

    const [first, second] = receiver.received
    assert.equal(first.error.code, 'BOOM')
    assert.equal(first.error.message.includes('\n'), false, '必须单行化')
    assert.equal(first.error.message.length, 200, '必须限长到 200')
    assert.equal(second.error.code, 'UNKNOWN')
    assert.equal(second.error.message, '')
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('T4-4：正文带标题与原因；includeTitle=false 时只剩骨架', async () => {
  const receiver = await withReceiver()
  const s = setup()
  try {
    customTarget(s, receiver.url)
    const notifier = createNotifier({ includeTitle: false }, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })
    notifier.handle(session, { type: 'session/title', data: { title: '修复登录 bug' } })
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'interrupted' } } })
    await waitFor(receiver.received, 1)

    const body = receiver.received[0]
    assert.equal(body.reason, 'interrupted')
    assert.equal(body.error, null, 'interrupted 没有错误码')
    assert.equal(body.message, '会话异常中断', 'interrupted 不带括号后缀；includeTitle=false 不拼标题')
    assert.equal(body.title, '修复登录 bug', '标题仍作为结构化字段给出')
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('T4-5：完成事件的报文键集合不变（不许被中断字段污染）', async () => {
  const receiver = await withReceiver()
  const s = setup()
  try {
    customTarget(s, receiver.url)
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await waitFor(receiver.received, 1)

    const body = receiver.received[0]
    assert.equal(body.event, 'turn/end')
    assert.equal(body.message, '会话已完成')
    assert.equal(Object.keys(body).includes('reason'), false)
    assert.equal(Object.keys(body).includes('error'), false)
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('T5-1/T5-2：自动轮里报错照叫，自动轮里的「完成」仍静默', async () => {
  const receiver = await withReceiver()
  const s = setup()
  try {
    customTarget(s, receiver.url)
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    // 自动轮：整轮只有系统注入的 user/message（source.kind = goal），没有人插话
    notifier.handle(session, { type: 'user/message', data: { source: { kind: 'goal' } } })
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'error', error: MALFORMED } } })
    await waitFor(receiver.received, 1)
    assert.equal(receiver.received[0].event, 'turn/error', '无人值守时 agent 停下，正是最该叫人的时刻')

    // 再来一个自动轮的「完成」：应当静默
    notifier.handle(session, { type: 'user/message', data: { source: { kind: 'goal' } } })
    notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await settle()
    assert.equal(receiver.received.length, 1, '自动轮完成不该吵人（既有语义不变）')
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('T5-3/T5-4：静默原因码可观测；非 turn/end 事件仍是 ignored', async () => {
  const receiver = await withReceiver()
  const s = setup()
  try {
    customTarget(s, receiver.url)
    const notifier = createNotifier({}, { logger: silent, targets: s.targets, bindings: s.bindings, outcomes: s.outcomes })

    assert.deepEqual(
      notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'blocked' } } }),
      { action: 'dropped', reason: 'turn-not-notifiable', turnKind: 'blocked' },
    )
    assert.deepEqual(
      notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }),
      { action: 'dropped', reason: 'turn-not-notifiable', turnKind: 'max-tokens' },
    )
    assert.deepEqual(
      notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }),
      { action: 'dropped', reason: 'turn-aborted', turnKind: 'aborted' },
    )
    assert.deepEqual(notifier.handle(session, { type: 'step/start', data: {} }), { action: 'ignored' })
    await settle()
    assert.equal(receiver.received.length, 0, '三种静默终态一条都不该发')
  } finally {
    await receiver.close(); s.cleanup()
  }
})

test('T3-2/T3-3：静默名单与开关各自生效，且绝不回落到「已完成」', async () => {
  const receiver = await withReceiver()
  const s1 = setup()
  const s2 = setup()
  try {
    customTarget(s1, receiver.url)
    customTarget(s2, receiver.url)

    // ① skipReasons 命中：静默，且留痕为 turn-skipped
    const strict = createNotifier({ skipReasons: ['error'] }, { logger: silent, targets: s1.targets, bindings: s1.bindings, outcomes: s1.outcomes })
    assert.deepEqual(
      strict.handle(session, { type: 'turn/end', data: { reason: { kind: 'error', error: MALFORMED } } }),
      { action: 'dropped', reason: 'turn-skipped', turnKind: 'error' },
    )

    // ② notifyInterrupt=false：路由丢弃（不是「当完成推」）
    const muted = createNotifier({ notifyInterrupt: false }, { logger: silent, targets: s2.targets, bindings: s2.bindings, outcomes: s2.outcomes })
    const verdict = muted.handle(session, { type: 'turn/end', data: { reason: { kind: 'error', error: MALFORMED } } })
    assert.equal(verdict.action, 'dropped')
    assert.equal(verdict.reason, 'type-disabled')

    await settle()
    assert.equal(receiver.received.length, 0, '两种关法都不许出现任何报文（尤其不许出现「会话已完成」）')
  } finally {
    await receiver.close(); s1.cleanup(); s2.cleanup()
  }
})
