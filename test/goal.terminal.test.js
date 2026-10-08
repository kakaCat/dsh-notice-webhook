/**
 * goal 终态识别与去重的单测（覆盖 TC-10 / TC-11 与 t6b 验收）。
 *
 * 跑法：node --test test/goal.terminal.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../src/config.js'
import { GoalTracker, REASON_ROUND_LIMIT, readGoalSnapshot } from '../src/goal.js'

const silent = { warn() {} }
const session = { header: { id: 'session-goal' } }

function tracker(overrides = {}, title = '修复登录 bug') {
  const config = normalizeConfig(overrides, silent)
  return new GoalTracker(config, () => title)
}

const change = payload => ({ type: 'goal/change', data: { goal: payload } })

test('TC-10 phase=complete → 产出 goal/complete，正文含「目标已完成」', () => {
  const t = tracker()
  const intent = t.observe(session, change({ id: 'goal-7f3a', revision: 1, phase: 'complete', maxGoalRounds: 20 }))
  assert.equal(intent.event, 'goal/complete')
  assert.equal(intent.message, '修复登录 bug · 目标已完成')
  assert.deepEqual(intent.goal, { id: 'goal-7f3a', phase: 'complete', round: null })
})

test('TC-11 blocked + code=round-limit + maxGoalRounds=20 → 正文含 20/20', () => {
  const t = tracker()
  const intent = t.observe(session, change({
    id: 'goal-7f3a',
    revision: 3,
    phase: 'blocked',
    maxGoalRounds: 20,
    blockedReason: { code: REASON_ROUND_LIMIT, message: 'Goal reached its configured limit of 20 rounds.' },
  }))
  assert.equal(intent.event, 'goal/blocked')
  assert.equal(intent.message, '修复登录 bug · 目标轮次耗尽（20/20）')
  assert.deepEqual(intent.goal, { id: 'goal-7f3a', phase: 'blocked', round: 20 })
})

test('TC-11 blocked 其他 code → 正文含该 code', () => {
  const t = tracker()
  const intent = t.observe(session, change({
    id: 'goal-7f3a',
    revision: 2,
    phase: 'blocked',
    maxGoalRounds: 20,
    blockedReason: { code: 'queue-failed', message: 'could not queue round 3' },
  }))
  assert.equal(intent.message, '修复登录 bug · 目标阻塞（queue-failed）')
})

test('TC-11 同一 (goalId, revision, phase) 重复上报只推一条', () => {
  const t = tracker()
  const payload = { id: 'goal-7f3a', revision: 2, phase: 'blocked', maxGoalRounds: 5, blockedReason: { code: REASON_ROUND_LIMIT, message: 'x' } }
  assert.notEqual(t.observe(session, change(payload)), null)
  assert.equal(t.observe(session, change(payload)), null)
  assert.equal(t.observe(session, change(payload)), null)
})

test('人 resume 后又耗尽（revision 变化）→ 视为新终态，再推一条', () => {
  const t = tracker()
  assert.notEqual(t.observe(session, change({ id: 'goal-1', revision: 1, phase: 'complete' })), null)
  assert.notEqual(t.observe(session, change({ id: 'goal-1', revision: 2, phase: 'complete' })), null)
})

test('paused / active 不打扰使用者', () => {
  const t = tracker()
  assert.equal(t.observe(session, change({ id: 'goal-1', revision: 1, phase: 'paused' })), null)
  assert.equal(t.observe(session, change({ id: 'goal-1', revision: 2, phase: 'active' })), null)
  assert.equal(t.snapshotOf(session).phase, 'active')
})

test('无标题或 includeTitle=false 时不拼标题', () => {
  const noTitle = tracker({}, null)
  assert.equal(noTitle.observe(session, change({ id: 'g', revision: 1, phase: 'complete' })).message, '目标已完成')

  const noInclude = tracker({ includeTitle: false })
  assert.equal(noInclude.observe(session, change({ id: 'g', revision: 1, phase: 'complete' })).message, '目标已完成')
})

test('自定义文案生效', () => {
  const t = tracker({ goalCompleteMessage: '目标拿下', goalBlockedMessage: '目标卡住' })
  assert.equal(t.observe(session, change({ id: 'g1', revision: 1, phase: 'complete' })).message, '修复登录 bug · 目标拿下')
  assert.equal(
    t.observe(session, change({ id: 'g2', revision: 1, phase: 'blocked', blockedReason: { code: 'custom', message: 'x' } })).message,
    '修复登录 bug · 目标卡住（custom）',
  )
})

test('readGoalSnapshot 兼容 { goal } 包裹与快照直给两种载荷', () => {
  const wrapped = readGoalSnapshot(change({ id: 'g', revision: 2, phase: 'active', maxGoalRounds: 9 }))
  assert.deepEqual(wrapped, { id: 'g', phase: 'active', revision: 2, maxGoalRounds: 9, blockedCode: undefined })
  const direct = readGoalSnapshot({ type: 'goal/change', data: { id: 'g', revision: 1, phase: 'complete' } })
  assert.equal(direct.phase, 'complete')
  assert.equal(readGoalSnapshot({ type: 'goal/change', data: {} }), null)
  assert.equal(readGoalSnapshot({ type: 'goal/change', data: null }), null)
})

test('round-limit 但缺 maxGoalRounds 时退化为通用阻塞文案（不猜数字）', () => {
  const t = tracker()
  const intent = t.observe(session, change({ id: 'g', revision: 1, phase: 'blocked', blockedReason: { code: REASON_ROUND_LIMIT, message: 'x' } }))
  assert.equal(intent.message, '修复登录 bug · 目标阻塞（round-limit）')
})
