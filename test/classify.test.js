/**
 * 事件分类单测（覆盖 TC-1 … TC-5 与 t5 验收）。
 *
 * 跑法：node --test test/classify.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../src/config.js'
import { Classifier, errorFacts, isNestedSession, silentReasonOf } from '../src/classify.js'

const silent = { warn() {} }
const topSession = { header: { id: 'session-top' } }
const childSession = { header: { id: 'session-child', parentSession: 'session-top' } }

function classifier(overrides = {}) {
  return new Classifier(normalizeConfig(overrides, silent))
}

test('TC-1 有标题时对话完成正文为「标题 · 会话已完成」', () => {
  const c = classifier()
  assert.equal(c.classify(topSession, { type: 'session/title', data: { title: '修复登录 bug' } }), null)
  const intent = c.classify(topSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(intent.event, 'turn/end')
  assert.equal(intent.message, '修复登录 bug · 会话已完成')
  assert.equal(intent.kind, 'complete')
})

test('TC-1 无标题时正文退化为「会话已完成」', () => {
  const c = classifier()
  const intent = c.classify(topSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(intent.message, '会话已完成')
})

test('TC-2 等待授权带工具名；工具名缺失时不带括号', () => {
  const c = classifier()
  const withTool = c.classify(topSession, { type: 'approval/asked', data: { toolName: 'Bash' } })
  assert.equal(withTool.event, 'approval/asked')
  assert.equal(withTool.message, '需要你允许执行操作（Bash）')
  assert.equal(withTool.toolName, 'Bash')

  const withoutTool = c.classify(topSession, { type: 'approval/asked', data: {} })
  assert.equal(withoutTool.message, '需要你允许执行操作')
  assert.equal(withoutTool.toolName, null)
})

test('TC-3 只有「问用户」的请求触发提问意图', () => {
  const c = classifier()
  const intent = c.classify(topSession, { type: 'user-questions/request', data: { questions: [{ id: 'q1', header: '选择方案', question: '要 A 还是 B？' }] } })
  assert.equal(intent.event, 'ask_user_question')
  assert.equal(intent.message, '需要你回答一个问题（选择方案）', '文案应带上问题标题，便于一眼知道问的是什么')
})

test('TC-4 普通工具调用与无关事件不产生意图', () => {
  const c = classifier()
  assert.equal(c.classify(topSession, { type: 'tool/call', data: { name: 'read' } }), null)
  assert.equal(c.classify(topSession, { type: 'tool/call', data: { name: 'bash' } }), null)
  assert.equal(c.classify(topSession, { type: 'step/start', data: {} }), null)
  assert.equal(c.classify(topSession, { type: 'assistant/message', data: {} }), null)
  assert.equal(c.classify(topSession, { type: 'user/message', data: {} }), null)
})

test('TC-5 子代理会话不产生意图；中断回合产生中断意图；aborted 静默', () => {
  const c = classifier()
  assert.equal(c.classify(childSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } }), null)
  // REQ-261001203114-19b6：崩溃孤儿 turn（interrupted）**不再静默**——agent 中断不工作就要叫人
  assert.equal(c.classify(topSession, { type: 'turn/end', data: { reason: { kind: 'interrupted' } } }).event, 'turn/error')
  assert.equal(c.classify(topSession, { type: 'turn/end', data: { reason: { kind: 'aborted' } } }), null)
  assert.equal(c.classify(topSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).event, 'turn/end')
})

test('onlyTopLevel=false 时子会话也产生意图', () => {
  const c = classifier({ onlyTopLevel: false })
  assert.equal(c.classify(childSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).event, 'turn/end')
})

test('includeTitle=false 时不拼标题', () => {
  const c = classifier({ includeTitle: false })
  c.classify(topSession, { type: 'session/title', data: { title: '修复登录 bug' } })
  assert.equal(c.classify(topSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).message, '会话已完成')
})

test('自定义文案生效', () => {
  const c = classifier({ completeMessage: '跑完了', approvalMessage: '要你点头', questionMessage: '问你个事' })
  assert.equal(c.classify(topSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } }).message, '跑完了')
  assert.equal(c.classify(topSession, { type: 'approval/asked', data: {} }).message, '要你点头')
  assert.equal(c.classify(topSession, { type: 'user-questions/request', data: { questions: [{ id: 'q1', header: '选择方案', question: '要 A 还是 B？' }] } }).message, '问你个事（选择方案）')
})

test('titleOf 读回缓存的标题', () => {
  const c = classifier()
  assert.equal(c.titleOf(topSession), undefined)
  c.classify(topSession, { type: 'session/title', data: { title: '标题 A' } })
  assert.equal(c.titleOf(topSession), '标题 A')
})

test('isNestedSession 只认结构化字段', () => {
  assert.equal(isNestedSession(topSession), false)
  assert.equal(isNestedSession({ header: {} }), false)
  assert.equal(isNestedSession(childSession), true)
  assert.equal(isNestedSession({ header: { origin: 'subagent' } }), true)
  assert.equal(isNestedSession({ header: { delegationDepth: 2 } }), true)
  assert.equal(isNestedSession({ header: { delegationDepth: 0 } }), false)
  assert.equal(isNestedSession(undefined), false)
})

/* ── REQ-261001203114-19b6：turn/end 终态决策表（设计 TC-2 / TC-3） ── */

/** 造一条 turn/end 事件。 */
function turnEnd(kind, error) {
  return { type: 'turn/end', data: { reason: { kind, ...(error === undefined ? {} : { error }) } } }
}

test('T2-1/T2-2：completed 是完成；error 是中断（带错误事实），绝不产出 turn/end', () => {
  const c = classifier()
  const done = c.classify(topSession, turnEnd('completed'))
  assert.equal(done.kind, 'complete')
  assert.equal(done.event, 'turn/end')

  const failed = c.classify(topSession, turnEnd('error', { code: 'MALFORMED_RESPONSE', message: 'DeepSeek Messages stream: tool input is invalid JSON' }))
  assert.equal(failed.kind, 'interrupt')
  assert.equal(failed.event, 'turn/error')
  assert.notEqual(failed.event, 'turn/end', '报错被说成「已完成」正是本次要修的缺陷')
  assert.equal(failed.reason, 'error')
  assert.equal(failed.error.code, 'MALFORMED_RESPONSE')
  assert.equal(failed.message, '会话异常中断（MALFORMED_RESPONSE）')
})

test('T2-3：interrupted 是中断且不带错误码后缀', () => {
  const c = classifier()
  const intent = c.classify(topSession, turnEnd('interrupted'))
  assert.equal(intent.kind, 'interrupt')
  assert.equal(intent.event, 'turn/error')
  assert.equal(intent.reason, 'interrupted')
  assert.equal(intent.error, null)
  assert.equal(intent.message, '会话异常中断')
})

test('T2-4…T2-7：aborted / blocked / max-tokens / forked 都不推——但原因码说得清', () => {
  const c = classifier()
  for (const kind of ['aborted', 'blocked', 'max-tokens', 'forked']) {
    assert.equal(c.classify(topSession, turnEnd(kind)), null, `${kind} 不该推送`)
  }
  assert.deepEqual(silentReasonOf({ kind: 'aborted' }, ['aborted']), { reason: 'turn-aborted', kind: 'aborted' })
  assert.deepEqual(silentReasonOf({ kind: 'blocked' }, ['aborted']), { reason: 'turn-not-notifiable', kind: 'blocked' })
  assert.deepEqual(silentReasonOf({ kind: 'max-tokens' }, ['aborted']), { reason: 'turn-not-notifiable', kind: 'max-tokens' })
  assert.deepEqual(silentReasonOf({ kind: 'forked' }, ['aborted']), { reason: 'turn-not-notifiable', kind: 'forked' })
  assert.equal(silentReasonOf({ kind: 'completed' }, ['aborted']), null, '非静默终态不该有原因码')
})

test('T2-8：未知 / 畸形终态按「未知」上报中断，不谎报完成、也不抛异常', () => {
  const c = classifier()
  // 未知但**有名字**的终态：正文带上它的名字，便于一眼看出 DSH 又加了什么
  const named = c.classify(topSession, { type: 'turn/end', data: { reason: { kind: 'brand-new-kind' } } })
  assert.equal(named.kind, 'interrupt')
  assert.equal(named.event, 'turn/error')
  assert.equal(named.reason, 'brand-new-kind')
  assert.equal(named.message, '会话异常中断（brand-new-kind）')

  // 连名字都没有的畸形输入：同样按中断上报，绝不谎报完成
  for (const reason of [{}, { kind: 42 }, undefined, { kind: '' }]) {
    const intent = c.classify(topSession, { type: 'turn/end', data: { reason } })
    assert.equal(intent.kind, 'interrupt', `reason=${JSON.stringify(reason)} 应回落为中断`)
    assert.equal(intent.event, 'turn/error')
    assert.equal(intent.reason, 'unknown')
    assert.equal(intent.message, '会话异常中断（unknown）')
  }
})

test('T2-2 细节：错误详情单行化 + 截断 200；缺 code 回落 UNKNOWN；不是 error 终态就没有 error', () => {
  const c = classifier()
  const messy = c.classify(topSession, turnEnd('error', { message: `a\n\nb\t${'x'.repeat(300)}` }))
  assert.equal(messy.error.code, 'UNKNOWN')
  assert.equal(messy.error.message.includes('\n'), false)
  assert.equal(messy.error.message.length, 200)
  assert.equal(c.classify(topSession, turnEnd('interrupted')).error, null)
  assert.equal(errorFacts({ kind: 'completed' }), null, 'errorFacts 只认 error 终态')
})

test('T3-1/T3-2：默认名单只静默 aborted；把 error 写进名单即彻底安静（且原因码为 turn-skipped）', () => {
  const c = classifier()
  assert.equal(c.classify(topSession, turnEnd('interrupted')).kind, 'interrupt', '默认不再静默 interrupted')
  assert.equal(c.classify(topSession, turnEnd('aborted')), null)

  const strict = classifier({ skipReasons: ['error'] })
  assert.equal(strict.classify(topSession, turnEnd('error', { code: 'X' })), null)
  assert.deepEqual(silentReasonOf({ kind: 'error' }, ['error']), { reason: 'turn-skipped', kind: 'error' })
  // 名单优先于一切：名单里的 error 仍然静默，别指望 notifyInterrupt 能救回来（那是路由层的开关）
  assert.deepEqual(silentReasonOf({ kind: 'aborted' }, ['aborted', 'error']), { reason: 'turn-aborted', kind: 'aborted' })
})
