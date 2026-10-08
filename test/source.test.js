/**
 * 口径契约用例：`isHumanSource`（REQ-261002150038-344a FR-1，TC-1…TC-5）。
 *
 * 跑法：node --test test/source.test.js
 *
 * 这张表就是**唯一真相**：谁算「人」、谁算「注入」——轮次静默与「任务」字段都靠它。
 * 表里每一行都对应一个真实来源：Dive 续跑 `dive`、goal 自动轮 `goal`、pmboard 通知 `plugin`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HUMAN_SOURCE_KINDS, isHumanSource } from '../src/source.js'

test('TC-1 source 缺失（undefined / null）→ 人（真人直发可能不带 source）', () => {
  assert.equal(isHumanSource(undefined), true)
  assert.equal(isHumanSource(null), true)
})

test('TC-2 source 是对象但 kind 缺失 → 人（历史口径不变）', () => {
  assert.equal(isHumanSource({}), true)
  assert.equal(isHumanSource({ kind: undefined }), true)
  assert.equal(isHumanSource({ kind: null }), true)
})

test('TC-3 kind === user → 人', () => {
  assert.equal(isHumanSource({ kind: 'user' }), true)
  assert.deepEqual([...HUMAN_SOURCE_KINDS], ['user'], '白名单只允许 user')
})

test('TC-4 已知注入来源 goal / dive / plugin → 注入（本次修复的靶子）', () => {
  assert.equal(isHumanSource({ kind: 'goal', goalId: 'goal-1', revision: 1, round: 3 }), false)
  assert.equal(isHumanSource({ kind: 'dive', requirementId: 'REQ-261002150038-344a', round: 35 }), false)
  assert.equal(isHumanSource({ kind: 'plugin', plugin: 'dsh-pmboard', form: 'notice' }), false)
})

test('TC-5 未来新增 kind 与形状异常 → 注入（默认安静，不默认吵闹）', () => {
  assert.equal(isHumanSource({ kind: 'brand-new-kind' }), false, '未知 kind 默认安静')
  assert.equal(isHumanSource({ kind: 42 }), false, 'kind 非字符串 → 注入')
  assert.equal(isHumanSource('user'), false, 'source 非对象 → 注入')
  assert.equal(isHumanSource(['user']), false, 'source 是数组 → 注入')
})
