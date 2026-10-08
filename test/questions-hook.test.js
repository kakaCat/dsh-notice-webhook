/**
 * 弹框类提问的旁听（用户反馈的 bug：pm 插件的二次开发弹框收不到通知）。
 *
 * 跑法：node --test test/questions-hook.test.js
 *
 * 关键事实：DSH 的提问走 **ctx 的 waterfall 事件 `user-questions/request`**，
 * 不在 `session/event` 流里——所以只订阅会话事件的插件完全看不到插件弹框。
 * 本用例钉两件事：① 按到就发通知；② 必须 `next()` 放行（吞掉提问会让弹框不弹）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { TargetStore } from '../src/targets.js'

/** 假 ctx：只提供插件用到的那几样，并记录事件订阅。 */
function fakeCtx() {
  const handlers = new Map()
  return {
    handlers,
    logger: { info() {}, warn() {}, debug() {} },
    on(name, cb) { handlers.set(name, cb); return () => handlers.delete(name) },
    provide() { return () => {} },
    effect(fn) { fn(); return () => {} },
    inject() {},
  }
}

test('弹框提问（user-questions/request）会发通知，且必须放行 next', async () => {
  const got = []
  const receiver = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { got.push(JSON.parse(body)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}') })
  })
  await new Promise(r => receiver.listen(0, '127.0.0.1', r))

  const store = new TargetStore({ path: join(mkdtempSync(join(tmpdir(), 'dnw-q-')), 'targets.json'), logger: { warn() {} } })
  store.save({ name: '本地', channel: 'custom', url: `http://127.0.0.1:${receiver.address().port}/hook`, isDefault: true })

  const ctx = fakeCtx()
  apply(ctx, {})
  // 让插件用隔离的目标存储（默认走真实路径，这里换成临时库）
  const { createNotifier } = await import('../index.js')
  const notifier = createNotifier({}, { logger: ctx.logger, targets: store })
  // 直接验证 runtime 的处理函数（与 apply 里订阅的是同一个）
  const result = notifier.handleExternalQuestion({
    question: '要 A 方案还是 B 方案？', header: '选择方案', sessionId: 'sess-q-1', workspace: '/tmp/x',
  })
  await new Promise(r => setTimeout(r, 800))
  receiver.close()

  assert.equal(result.action, 'sent', '弹框提问应触发投递')
  assert.ok(got.length >= 1, '本地接收端应收到通知')
  assert.ok(got[0].message.includes('（选择方案）'), '通知文案应带问题标题')
  assert.ok(String(got[0].context).includes('**类型**'), '应带类型行')
  assert.ok(String(got[0].context).includes('要 A 方案还是 B 方案？'), '应带问题正文')
})

test('apply 会在 ctx 上订阅 user-questions/request，并且放行 next', async () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  const hook = ctx.handlers.get('user-questions/request')
  assert.equal(typeof hook, 'function', '必须在 ctx 上订阅 waterfall 事件（否则插件弹框看不到）')

  let released = false
  await hook({ questions: [{ header: '确认', question: '继续吗？' }] }, () => { released = true; return 'answered' })
  assert.equal(released, true, '必须调用 next() 放行——吞掉提问会导致弹框不弹')

  const sessionHook = ctx.handlers.get('session/event')
  assert.equal(typeof sessionHook, 'function', '会话事件订阅也要在')
})
