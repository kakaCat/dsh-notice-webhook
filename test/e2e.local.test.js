/**
 * 本地端到端联调（t8 验收）：起一个真实 HTTP 接收端，把五类事件灌进主链路，
 * 断言接收端真的按契约收到东西；再验证接收端不可用时进程安然无恙。
 *
 * 跑法：node --test test/e2e.local.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNotifier } from '../index.js'
import { BindingStore } from '../src/bindings.js'
import { TargetStore } from '../src/targets.js'

const silent = { warn() {}, info() {}, debug() {} }

function withReceiver() {
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    try {
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      received.push({ parseError: true })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        received,
        url: `http://127.0.0.1:${port}/hook`,
        close: () => new Promise(done => server.close(done)),
      })
    })
  })
}

/**
 * 等到接收端至少收到 `count` 条。
 *
 * 超时**直接抛出带具体条数的错误**：全量并发跑测试时投递可能被拖慢，
 * 静默返回计数只会让断言报出"4 !== 5"这种看不出原因的信息（曾偶发过一次）。
 * 期限给足（默认 8s），超时才判定失败。
 */
async function waitFor(received, count, timeoutMs = 8000) {
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
 * 两份状态都指向临时目录——**测试绝不写用户的真实状态目录**
 * （只传 store 会让目标清单落到 $DSH_HOME，测试跑一遍就污染一份残留）。
 */
function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-e2e-'))
  return {
    store: new BindingStore({ path: join(dir, 'bindings.json'), logger: silent }),
    targets: new TargetStore({ path: join(dir, 'targets.json'), logger: silent }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('五类事件端到端：本地接收端按序收到并符合载荷契约', async () => {
  const receiver = await withReceiver()
  const { store, targets, cleanup } = tempStore()
  try {
    const notifier = createNotifier({ webhookUrl: receiver.url, includeTitle: true }, { logger: silent, store, targets })
    const session = { header: { id: 'session-e2e', cwd: '/tmp/workspace' } }

    notifier.handle(session, { type: 'session/title', data: { title: '修复登录 bug' } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).action, 'sent')
    assert.equal(notifier.handle(session, { type: 'approval/asked', data: { toolName: 'Bash' } }).action, 'sent')
    assert.equal(notifier.handle(session, { type: 'user-questions/request', data: { questions: [{ id: 'q1', header: '选择方案', question: '要 A 还是 B？' }] } }).action, 'sent')
    assert.equal(notifier.handle(session, { type: 'goal/change', data: { goal: { id: 'goal-A', revision: 1, phase: 'complete' } } }).action, 'sent')
    assert.equal(
      notifier.handle(session, {
        type: 'goal/change',
        data: { goal: { id: 'goal-B', revision: 2, phase: 'blocked', maxGoalRounds: 20, blockedReason: { code: 'round-limit', message: 'limit' } } },
      }).action,
      'sent',
    )

    const arrived = await waitFor(receiver.received, 5)
    assert.equal(arrived, 5, `接收端应收到 5 条，实际 ${arrived}`)

    const events = receiver.received.map(item => item.event)
    assert.deepEqual(events, ['turn/end', 'approval/asked', 'ask_user_question', 'goal/complete', 'goal/blocked'])

    const [turnEnd, approval, question, goalComplete, goalBlocked] = receiver.received
    assert.equal(turnEnd.message, '修复登录 bug · 会话已完成')
    assert.equal(turnEnd.title, '修复登录 bug')
    assert.equal(turnEnd.toolName, null)
    assert.equal(turnEnd.goal, null)
    assert.equal(turnEnd.sessionId, 'session-e2e')
    assert.equal(turnEnd.workspace, '/tmp/workspace')
    assert.equal(turnEnd.source, 'dsh-notice-webhook')
    assert.equal(turnEnd.version, 1)
    assert.equal(typeof turnEnd.at, 'string')

    assert.equal(approval.message, '需要你允许执行操作（Bash）')
    assert.equal(approval.toolName, 'Bash')
    assert.equal(question.message, '需要你回答一个问题（选择方案）')
    assert.equal(goalComplete.message, '修复登录 bug · 目标已完成')
    assert.equal(goalComplete.goal.phase, 'complete')
    assert.ok(goalBlocked.message.includes('轮次耗尽'), '阻塞正文应写明轮次耗尽')
    assert.equal(goalBlocked.goal.round, 20)
  } finally {
    await receiver.close()
    cleanup()
  }
})

test('接收端不可达：主链路不抛异常，进程退出码保持 0', async () => {
  const { store, targets, cleanup } = tempStore()
  try {
    const warnings = []
    const notifier = createNotifier({ webhookUrl: 'http://127.0.0.1:1/hook', timeoutMs: 500 }, {
      logger: { warn: m => warnings.push(String(m)), info() {}, debug() {} },
      store,
      targets,
    })
    const session = { header: { id: 'session-down' } }
    const result = notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    assert.equal(result.action, 'sent', '投递失败不影响"已派发"的判定')

    // 给异步投递留出失败时间，期间不能冒未捕获异常
    await new Promise(resolve => setTimeout(resolve, 900))
    assert.ok(warnings.some(line => line.includes('投递失败')), '应留下一条可见的失败告警')
  } finally {
    cleanup()
  }
})

test('已完成的事件类型不被误判：普通工具调用不产生请求', async () => {
  const receiver = await withReceiver()
  const { store, targets, cleanup } = tempStore()
  try {
    const notifier = createNotifier({ webhookUrl: receiver.url }, { logger: silent, store, targets })
    const session = { header: { id: 'session-quiet' } }
    assert.equal(notifier.handle(session, { type: 'tool/call', data: { name: 'read' } }).action, 'ignored')
    assert.equal(notifier.handle(session, { type: 'assistant/message', data: {} }).action, 'ignored')
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(receiver.received.length, 0)
  } finally {
    await receiver.close()
    cleanup()
  }
})

test('绑定旁路端到端：总开关关闭时已绑定会话仍到绑定地址，未绑定会话静默', async () => {
  const bound = await withReceiver()
  const fallback = await withReceiver()
  const { store, targets, cleanup } = tempStore()
  try {
    const notifier = createNotifier({ enabled: false, webhookUrl: fallback.url }, { logger: silent, store, targets })
    const boundSession = { header: { id: 'session-bound' } }
    const otherSession = { header: { id: 'session-other' } }
    assert.equal(notifier.service.bind('session-bound', bound.url), true)

    assert.equal(notifier.handle(boundSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).action, 'sent')
    assert.equal(notifier.handle(otherSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).action, 'dropped')

    await waitFor(bound.received, 1)
    assert.equal(bound.received.length, 1, '已绑定会话必须照发（旁路）')
    assert.equal(fallback.received.length, 0, '未绑定会话在总开关关闭时不得发送')
  } finally {
    await bound.close()
    await fallback.close()
    cleanup()
  }
})

// ── REQ-261002150038-344a：注入轮静默与卡片去重的端到端（TC-24…TC-27）────────

const DIVE_PROMPT = '继续执行需求 REQ-261002150038-344a（Dive 模式自动续跑，第 35 回合）'
const diveEvent = round => ({
  type: 'user/message',
  data: { source: { kind: 'dive', requirementId: 'REQ-261002150038-344a', revision: 11, round }, content: [{ type: 'text', text: DIVE_PROMPT }] },
})

test('TC-24/25/26 端到端：自动续跑不响、人插话就响、注入轮报错仍叫', async () => {
  const receiver = await withReceiver()
  const { store, targets, cleanup } = tempStore()
  try {
    const notifier = createNotifier({ webhookUrl: receiver.url, includeTitle: true }, { logger: silent, store, targets })
    const session = { header: { id: 'session-dive', cwd: '/tmp/workspace' } }

    // ① Dive 自动续跑一轮 → 决定为静默，且接收端 0 条
    notifier.handle(session, diveEvent(35))
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).action, 'silent')
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(receiver.received.length, 0, '自动续跑不该推「对话完成」')

    // ② 人在同一窗口说话 → 1 条，且正文的「任务」是人那句话、不含注入正文
    notifier.handle(session, { type: 'user/message', data: { content: [{ type: 'text', text: '这张卡先停一下' }] } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)
    assert.equal(receiver.received[0].event, 'turn/end')
    assert.ok(String(receiver.received[0].context).includes('这张卡先停一下'), '「任务」应是人的话')
    assert.ok(!String(receiver.received[0].context).includes(DIVE_PROMPT), '注入正文不该出现在「任务」里')

    // ③ Dive 轮里 agent 报错 → 照常推中断（静默只挡完成）
    notifier.handle(session, diveEvent(36))
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'x' } } } }).action, 'sent')
    await waitFor(receiver.received, 2)
    assert.equal(receiver.received[1].event, 'turn/error')
    assert.ok(String(receiver.received[1].message).includes('会话异常中断'))
  } finally {
    await receiver.close()
    cleanup()
  }
})

test('TC-27 端到端：飞书收到的是卡片，正文不再有重复的「类型」行', async () => {
  const receiver = await withReceiver()
  const { store, targets, cleanup } = tempStore()
  try {
    // 只给完整地址（不走 key 派生）：本地接收端才能收到报文；key 渠道会被 composeUrl 改写成飞书官方地址
    const saved = targets.save({ name: '飞书-端到端', channel: 'feishu', url: receiver.url, enabled: true, isDefault: true, events: [] })
    assert.equal(saved.ok, true, `目标应保存成功：${saved.errors?.join('；')}`)
    const notifier = createNotifier({}, { logger: silent, store, targets })
    const session = { header: { id: 'session-feishu', cwd: '/tmp/workspace' } }

    notifier.handle(session, { type: 'user/message', data: { content: [{ type: 'text', text: '把卡片改一下' }] } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)

    const body = receiver.received[0]
    assert.equal(body.msg_type, 'interactive', '飞书应发交互式卡片')
    assert.equal(body.card.header.title.content, '✅ 对话完成')
    const text = JSON.stringify(body.card)
    assert.ok(!text.includes('类型'), '卡片正文不该再有与标题重复的「类型」行')
    assert.ok(text.includes('把卡片改一下'), '「任务」字段仍照常渲染')
  } finally {
    await receiver.close()
    cleanup()
  }
})
