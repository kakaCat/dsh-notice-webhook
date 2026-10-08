/**
 * goal 自动轮识别的单测（覆盖 TC-9 与 t6a 验收）。
 *
 * 跑法：node --test test/goal.auto.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../src/config.js'
import { Classifier } from '../src/classify.js'
import { GoalTracker } from '../src/goal.js'

const silent = { warn() {} }
const session = { header: { id: 'session-goal' } }

/** 组装与 index.js 同构的最小流水线：goal 观察 → 分类 → 自动轮抑制。 */
function pipeline(overrides = {}) {
  const config = normalizeConfig(overrides, silent)
  const classifier = new Classifier(config)
  const tracker = new GoalTracker(config, s => classifier.titleOf(s))
  const emitted = []
  const feed = (target, event) => {
    const terminal = tracker.observe(target, event)
    if (terminal !== null) {
      emitted.push(terminal)
      return terminal
    }
    const intent = classifier.classify(target, event)
    if (intent === null) return null
    if (intent.kind === 'complete') {
      const auto = tracker.isAutoRound(target)
      tracker.endRound(target)
      if (auto) return null
    }
    emitted.push(intent)
    return intent
  }
  return { feed, emitted, tracker }
}

const goalUser = round => ({ type: 'user/message', data: { source: { kind: 'goal', goalId: 'goal-1', revision: 1, round } } })
const humanUser = { type: 'user/message', data: { source: { kind: 'user' } } }
const turnEnd = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }

test('TC-9 三条自动轮各接一个 turn/end → 产生 0 条意图', () => {
  const p = pipeline()
  for (let round = 1; round <= 3; round += 1) {
    p.feed(session, goalUser(round))
    assert.equal(p.feed(session, turnEnd), null, `第 ${round} 轮自动轮不该产生意图`)
  }
  assert.deepEqual(p.emitted, [])
})

test('TC-9 自动轮之后的人一轮照常产生意图（自动轮被抑制、人工轮不被误伤）', () => {
  const p = pipeline()
  for (let round = 1; round <= 3; round += 1) {
    p.feed(session, goalUser(round))
    p.feed(session, turnEnd)
  }
  p.feed(session, humanUser)
  const intent = p.feed(session, turnEnd)
  assert.equal(intent.event, 'turn/end')
  assert.equal(p.emitted.length, 1)
})

test('自动轮进行中使用者插话（/steer）→ 该轮按人工轮放行', () => {
  const p = pipeline()
  p.feed(session, goalUser(1))
  p.feed(session, humanUser)
  const intent = p.feed(session, turnEnd)
  assert.equal(intent.event, 'turn/end', '人在旁边插话了，这一轮就该响')
  assert.equal(p.emitted.length, 1)
})

test('没有 goal 注入的普通轮不受抑制（无 goal 的会话零回归）', () => {
  const p = pipeline()
  p.feed(session, humanUser)
  assert.equal(p.feed(session, turnEnd).event, 'turn/end')
  assert.equal(p.emitted.length, 1)
})

test('endRound 清空本轮标记，下一轮重新判定', () => {
  const p = pipeline()
  p.feed(session, goalUser(1))
  assert.equal(p.feed(session, turnEnd), null)
  assert.equal(p.feed(session, turnEnd).event, 'turn/end', '本轮标记已清空 → 不再被当成自动轮')
})

test('自动轮里的授权/提问事件不被 goal 抑制（只有完成类需要静默）', () => {
  const p = pipeline()
  p.feed(session, goalUser(1))
  const approval = p.feed(session, { type: 'approval/asked', data: { toolName: 'Bash' } })
  assert.equal(approval.event, 'approval/asked', '目标跑飞时卡在授权，正是最该叫人的时刻')
  const question = p.feed(session, { type: 'user-questions/request', data: { questions: [{ id: 'q1', header: '选择方案', question: '要 A 还是 B？' }] } })
  assert.equal(question.event, 'ask_user_question')
  assert.equal(p.emitted.length, 2)
})

// ── REQ-261002150038-344a：注入轮静默（TC-6…TC-12）────────────────────────────
// 口径从「只认 goal」改为「非 direct human 即注入」：Dive 自动续跑（dive）与插件通知（plugin）
// 以前被当成人工轮、每轮推一条「对话完成」（用户截图反馈的噪音），现在整轮静默。

/** Dive 回合消息（pmboard 的 createRoundMessage 形状）。 */
const diveUser = round => ({ type: 'user/message', data: { source: { kind: 'dive', requirementId: 'REQ-261002150038-344a', revision: 11, round } } })
/** 插件注入的通知消息（pmboard 的 surface replace 形状）。 */
const pluginUser = { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-pmboard', form: 'notice' } } }
const turnError = { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'tool input is invalid JSON' } } } }
const turnInterrupted = { type: 'turn/end', data: { reason: { kind: 'interrupted' } } }

test('TC-6 三条 Dive 注入轮（每轮接一个 turn/end）→ 产生 0 条意图', () => {
  const p = pipeline()
  for (let round = 33; round <= 35; round += 1) {
    p.feed(session, diveUser(round))
    assert.equal(p.feed(session, turnEnd), null, `第 ${round} 回合是 Dive 自动续跑，不该推「对话完成」`)
  }
  assert.deepEqual(p.emitted, [])
})

test('TC-7 插件注入的通知轮 → 产生 0 条意图', () => {
  const p = pipeline()
  p.feed(session, pluginUser)
  assert.equal(p.feed(session, turnEnd), null)
  assert.deepEqual(p.emitted, [])
})

test('TC-8 goal 注入轮仍然静默（既有行为不变）', () => {
  const p = pipeline()
  p.feed(session, goalUser(1))
  assert.equal(p.feed(session, turnEnd), null)
  assert.deepEqual(p.emitted, [])
})

test('TC-9 Dive 轮里人插话 → 照常推送，且该轮不再算自动轮', () => {
  const p = pipeline()
  p.feed(session, diveUser(35))
  p.feed(session, humanUser)
  assert.equal(p.tracker.isAutoRound(session), false, '人插话了，这一轮就该响')
  const intent = p.feed(session, turnEnd)
  assert.equal(intent.event, 'turn/end')
  assert.equal(p.emitted.length, 1)
})

test('TC-10 整轮没有任何 user/message → 不静默（维持现状，不把未知当自动）', () => {
  const p = pipeline()
  const intent = p.feed(session, turnEnd)
  assert.equal(intent.event, 'turn/end')
  assert.equal(p.emitted.length, 1)
})

test('TC-11 Dive 注入轮里报错中断 → 照常推中断（静默只挡完成）', () => {
  const p = pipeline()
  p.feed(session, diveUser(35))
  const intent = p.feed(session, turnError)
  assert.equal(intent.event, 'turn/error', '自动跑挂了更要叫人')
  assert.equal(intent.reason, 'error')
  assert.equal(intent.error.code, 'MALFORMED_RESPONSE')
  assert.equal(p.emitted.length, 1)
})

test('TC-12 Dive 注入轮崩溃中断（interrupted）→ 照常推中断', () => {
  const p = pipeline()
  p.feed(session, diveUser(35))
  const intent = p.feed(session, turnInterrupted)
  assert.equal(intent.event, 'turn/error')
  assert.equal(intent.reason, 'interrupted')
  assert.equal(p.emitted.length, 1)
})
