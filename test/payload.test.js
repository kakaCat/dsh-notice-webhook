/**
 * 报文上下文用例（AC-18）。
 *
 * 跑法：node --test test/payload.test.js
 *
 * 盯的是「通知里到底带了什么」：字段开关与顺序、摘要截断、goal 自动轮不计入摘要、
 * 工作区显示形态、时间格式、模板占位符、以及缺字段时的降级（少一行而不是报错）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildContext, createPromptTracker, detailOf, eventMeta, formatTime, renderContext,
  renderWorkspace, shortId, textOf, truncate, DEFAULT_FIELDS,
} from '../src/payload.js'

const SESSION = { id: 'sess-9f8e7d6c5b', workspace: '/Users/mac/Documents/ai/dsh/dsh-notice-webhook' }
const TURN_END = { kind: 'complete', event: 'turn/end', message: '会话已完成', toolName: null }

function ctxOf(overrides = {}) {
  return buildContext({
    intent: TURN_END, session: SESSION, title: '通知设置页按原型重做',
    prompt: '把弹框的字段都改成一行，60 字内放到输入框里，另外不要那个渠道下拉，还有请把说明收进标签，必填的星号也去掉吧',
    now: new Date('2026-09-30T14:32:07').getTime(),
    payload: {},
    ...overrides,
  })
}

test('AC-18 上下文取值：会话/工作区/摘要/时间/链接', () => {
  const ctx = ctxOf()
  assert.equal(ctx.session, '通知设置页按原型重做')
  assert.equal(ctx.id, 'd6c5b0'.slice(0, 0) + '7d6c5b'.slice(-6))   // 短 id = 后 6 位
  assert.equal(ctx.id, SESSION.id.slice(-6))
  assert.equal(ctx.workspace, 'dsh-notice-webhook')                // 默认只显示目录名
  assert.equal(ctx.time, '2026-09-30 14:32')                       // 默认带年月日
  assert.equal(ctx.link, 'dsh://open')
  // 阈值内不截断；阈值外截断并加省略号（这里显式给 20 字阈值来验）
  assert.ok(!ctx.prompt.endsWith('…'), '60 字阈值内不该截断')
  const short = buildContext({
    intent: TURN_END, session: SESSION, title: 'x', prompt: ctx.prompt, now: Date.now(), payload: { promptChars: 20 },
  })
  assert.ok(short.prompt.endsWith('…'), '超过阈值应截断')
  assert.equal(short.prompt.length, 21)
})

test('AC-18 工作区两种形态 + 缺字段降级', () => {
  assert.equal(renderWorkspace('/a/b/c', 'full'), '/a/b/c')
  assert.equal(renderWorkspace('/a/b/c', 'basename'), 'c')
  assert.equal(renderWorkspace(null, 'basename'), null)
  assert.equal(renderWorkspace('', 'basename'), null)
  const ctx = buildContext({ intent: TURN_END, session: {}, title: null, prompt: null, now: Date.now(), payload: {} })
  assert.equal(ctx.session, null)
  assert.equal(ctx.workspace, null)
  assert.equal(ctx.prompt, null)
  assert.equal(ctx.detail, null)
})

test('AC-18 字段开关与顺序：要哪几行就是哪几行', () => {
  const ctx = ctxOf()
  const onlyEvent = renderContext(ctx, { fields: ['event'] })
  assert.equal(onlyEvent, '**类型**：✅ 对话完成')

  const ordered = renderContext(ctx, { fields: ['session', 'prompt', 'event'] })
  const lines = ordered.split('\n')
  assert.ok(lines[0].startsWith('**会话**'), '顺序应遵循 fields')
  assert.ok(lines[1].startsWith('**任务**'))
  assert.ok(lines[2].startsWith('**类型**：'))

  // 缺字段的渲染项被跳过（不留空行）
  const noLink = renderContext({ ...ctx, link: null, workspace: null }, { fields: DEFAULT_FIELDS })
  assert.ok(!noLink.includes('打开 DSH'))
  assert.ok(!noLink.includes('\n\n'), '不应出现空行')
})

test('AC-18 摘要：promptChars=0 不带；模板可整段覆盖', () => {
  const ctx = ctxOf()
  // promptChars=0 在**取值**阶段就决定不带摘要（渲染层不再回头截断）
  const noPrompt = buildContext({
    intent: TURN_END, session: SESSION, title: 'x', prompt: '不该出现', now: Date.now(), payload: { promptChars: 0 },
  })
  assert.equal(noPrompt.prompt, null)
  assert.ok(!renderContext(noPrompt, { fields: DEFAULT_FIELDS, promptChars: 0 }).includes('你说'))
  const tpl = renderContext(ctx, { template: '[{event}] {id} · {prompt} · {link}' })
  assert.ok(tpl.startsWith('[✅ 对话完成] '))
  assert.ok(tpl.includes(SESSION.id.slice(-6)))
  assert.ok(tpl.endsWith('dsh://open'))
  // 未知占位符原样保留（不静默清空，便于发现写错）
  assert.ok(renderContext(ctx, { template: '{nope}' }).includes('{nope}'))
})

test('AC-18 事件详情：等待回答 / 等待授权 / 目标终态', () => {
  assert.deepEqual(detailOf({ event: 'ask_user_question' }, { question: '要不要加「复制为新渠道」？' }),
    { label: '问的是', value: '要不要加「复制为新渠道」？' })
  assert.deepEqual(detailOf({ event: 'approval/asked', toolName: 'bash' }, {}), { label: '工具', value: 'bash' })
  assert.deepEqual(detailOf({ event: 'goal/blocked' }, { goal: { objective: '做到可交付', round: 3, maxRounds: 20 } }),
    { label: '目标', value: '做到可交付 · blocked（轮次 3/20）' })
  assert.equal(detailOf({ event: 'turn/end' }, {}), null)
  assert.equal(eventMeta('goal/rounds-exhausted').color, 'red')
  assert.equal(eventMeta('approval/asked').color, 'orange')
})

test('AC-18 摘要只取人工输入：goal 自动轮注入不计入，一轮结束后清空', () => {
  const tracker = createPromptTracker()
  const session = { header: { id: 's1' } }
  tracker.observe(session, { type: 'user/message', data: { source: { kind: 'goal' }, message: { content: '自动轮推进' } } })
  assert.equal(tracker.take(session), null, 'goal 注入不该进摘要')
  tracker.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '帮我把卡片改成飞书富卡片' }] } } })
  assert.equal(tracker.take(session), '帮我把卡片改成飞书富卡片')
  // DSH 真实形状：data 就是消息本身（没有 message 包一层）——这是线上没显示「任务」的根因
  const real = { header: { id: 's2' } }
  tracker.observe(real, { type: 'user/message', data: { content: [{ type: 'text', text: '真实载荷形状也要能取到' }] } })
  assert.equal(tracker.take(real), '真实载荷形状也要能取到')
  tracker.clear(session)
  assert.equal(tracker.take(session), null)
})

// ── REQ-261002150038-344a：注入正文不再冒充「任务」（TC-13…TC-16）──────────────

/** pmboard Dive 回合消息形状（source.kind === 'dive'）。 */
const diveMessage = (text, round = 35) => ({
  type: 'user/message',
  data: {
    source: { kind: 'dive', requirementId: 'REQ-261002150038-344a', revision: 11, round },
    content: [{ type: 'text', text }],
  },
})

test('TC-13 Dive 注入的正文不进「任务」字段', () => {
  const tracker = createPromptTracker()
  const s = { header: { id: 'tc13' } }
  tracker.observe(s, diveMessage('继续执行需求 REQ-261002150038-344a（Dive 模式自动续跑，第 35 回合）'))
  assert.equal(tracker.take(s), null, '注入正文以前会被当成「用户要求」，现在必须为空')
})

test('TC-14 Dive 注入之后人插话 → 「任务」显示的是人那句话', () => {
  const tracker = createPromptTracker()
  const s = { header: { id: 'tc14' } }
  tracker.observe(s, diveMessage('继续执行需求 REQ-261002150038-344a（Dive 模式自动续跑，第 35 回合）'))
  tracker.observe(s, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '这张卡先停一下' }] } })
  assert.equal(tracker.take(s), '这张卡先停一下')
})

test('TC-15 无 source 的消息仍然算人（真人直发不带 source）', () => {
  const tracker = createPromptTracker()
  const s = { header: { id: 'tc15' } }
  tracker.observe(s, { type: 'user/message', data: { content: [{ type: 'text', text: '不带 source 也是我说的话' }] } })
  assert.equal(tracker.take(s), '不带 source 也是我说的话')
})

test('TC-16 渲染口径：有人的话才有「任务」行，只有注入时整行消失', () => {
  const withHuman = createPromptTracker()
  const s1 = { header: { id: 'tc16a' } }
  withHuman.observe(s1, { type: 'user/message', data: { content: [{ type: 'text', text: '把卡片改成飞书富卡片' }] } })
  const text1 = renderContext(buildContext({ intent: TURN_END, session: SESSION, title: 't', prompt: withHuman.take(s1), now: Date.now(), payload: {} }), {})
  assert.ok(text1.includes('**任务**：把卡片改成飞书富卡片'))

  const onlyDive = createPromptTracker()
  const s2 = { header: { id: 'tc16b' } }
  onlyDive.observe(s2, diveMessage('继续执行需求 REQ-261002150038-344a（Dive 模式自动续跑，第 35 回合）'))
  const text2 = renderContext(buildContext({ intent: TURN_END, session: SESSION, title: 't', prompt: onlyDive.take(s2), now: Date.now(), payload: {} }), {})
  assert.ok(!text2.includes('**任务**'), '只有注入消息时「任务」行必须整行消失')
})

test('AC-18 工具函数：textOf / truncate / formatTime / shortId', () => {
  assert.equal(textOf('abc'), 'abc')
  assert.equal(textOf([{ type: 'text', text: 'a' }, { type: 'image' }, 'b']), 'a\nb')
  assert.equal(textOf(undefined), '')
  assert.equal(truncate('abcdef', 3), 'abc…')
  assert.equal(truncate('abc', 3), 'abc')
  assert.equal(truncate('abc', 0), null)
  assert.equal(formatTime(new Date('2026-01-02T03:04:05').getTime(), 'YYYY-MM-DD HH:mm:ss'), '2026-01-02 03:04:05')
  assert.equal(shortId('abc'), 'abc')
  assert.equal(shortId('0123456789'), '456789')
})
