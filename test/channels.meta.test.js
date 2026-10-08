/**
 * 渠道元数据表的验收测试（t1）。
 *
 * 跑法：node --test test/channels.meta.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHANNEL_META, META_CHANNELS, channelMetaProjection, isKeyInput, labelOf, needsSecret, validateKey,
} from '../src/channels/meta.js'

const KEY_CHANNELS = ['wecom', 'dingtalk', 'feishu']
const URL_CHANNELS = ['slack', 'discord', 'custom']

test('六个渠道齐全且顺序即界面展示顺序', () => {
  // 顺序对齐原型 rail：企业微信 → 钉钉 → 飞书 → Slack → Discord → 通用自定义
  assert.deepEqual(META_CHANNELS, ['wecom', 'dingtalk', 'feishu', 'slack', 'discord', 'custom'])
  for (const c of META_CHANNELS) assert.equal(typeof CHANNEL_META[c].label, 'string')
})

test('input 分类正确：三个 app 渠道只填 key，三个填完整地址', () => {
  for (const c of KEY_CHANNELS) assert.equal(isKeyInput(c), true, `${c} 应只填 key`)
  for (const c of URL_CHANNELS) assert.equal(isKeyInput(c), false, `${c} 应填完整地址`)
  assert.equal(isKeyInput('nope'), false, '未知渠道不得被当成 key 渠道')
})

test('只填 key 的渠道必须三要素齐全（urlPrefix / keyLabel / keyPattern）', () => {
  for (const c of KEY_CHANNELS) {
    const m = CHANNEL_META[c]
    assert.equal(typeof m.urlPrefix, 'string')
    assert.match(m.urlPrefix, /^https:\/\//, `${c} 前缀必须是 https 绝对地址前缀`)
    assert.equal(typeof m.keyLabel, 'string')
    assert.ok(m.keyLabel.length > 0)
    assert.ok(m.keyPattern instanceof RegExp, `${c} 必须有 keyPattern`)
  }
})

test('填完整地址的渠道不得带 urlPrefix（免得两处来源打架）', () => {
  for (const c of URL_CHANNELS) assert.equal(CHANNEL_META[c].urlPrefix, undefined, `${c} 不该有前缀`)
})

test('加签需求：只有钉钉与飞书为 true', () => {
  assert.deepEqual(META_CHANNELS.filter(needsSecret), ['dingtalk', 'feishu'])
})

test('每个渠道都有可读的 help：标题非空、步骤 ≥2 条且每条非空', () => {
  for (const c of META_CHANNELS) {
    const help = CHANNEL_META[c].help
    assert.ok(help !== undefined, `${c} 缺 help`)
    assert.ok(help.title.trim().length > 0, `${c} help.title 为空`)
    assert.ok(Array.isArray(help.steps) && help.steps.length >= 2, `${c} 步骤至少两条`)
    for (const s of help.steps) assert.ok(s.trim().length > 0, `${c} 有空步骤`)
  }
})

test('官方说明链接：五个平台渠道必须是 http(s)；通用自定义如实为 null', () => {
  for (const c of [...KEY_CHANNELS, 'slack', 'discord']) {
    assert.match(CHANNEL_META[c].help.docUrl, /^https:\/\/\S+$/, `${c} 缺官方文档地址`)
  }
  // 通用自定义没有官方文档可指——步骤里讲的是我们自己的 v1 契约，故留空（界面隐藏外链）
  assert.equal(CHANNEL_META.custom.help.docUrl, null)
})

test('labelOf：已注册给显示名，未注册回落渠道 id（不出现 undefined）', () => {
  assert.equal(labelOf('wecom'), '企业微信')
  assert.equal(labelOf('nope'), 'nope')
  assert.equal(labelOf(undefined), '')
})

test('validateKey：合法 key 通过；空 / 含空格 / 误带前缀 / 过长 一律拒绝并给可读文案', () => {
  assert.equal(validateKey('wecom', '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa').ok, true)
  assert.equal(validateKey('dingtalk', 'a'.repeat(32)).ok, true)
  assert.equal(validateKey('feishu', 'e1f2a3b4-c5d6-7890-abcd-ef1234567890').ok, true)

  const bad = [
    ['wecom', ''],
    ['wecom', '   '],
    ['wecom', 'has space'],
    ['wecom', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7c1e-4b1a-9f2d'],
    ['dingtalk', 'short'],
    ['feishu', 'x'.repeat(120)],
  ]
  for (const [channel, key] of bad) {
    const verdict = validateKey(channel, key)
    assert.equal(verdict.ok, false, `${channel}/${key.slice(0, 12)} 应被拒`)
    assert.ok(verdict.error.length > 0, '必须给可读错误文案')
  }
})

test('validateKey：未知渠道被拒；填 URL 的渠道不看 key', () => {
  assert.equal(validateKey('nope', 'x').ok, false)
  for (const c of URL_CHANNELS) assert.equal(validateKey(c, '').ok, true, `${c} 不该因 key 为空被拒`)
})

test('channelMetaProjection：六项齐全、含 help、不含 keyPattern', () => {
  const proj = channelMetaProjection()
  assert.deepEqual(Object.keys(proj), META_CHANNELS)
  for (const c of META_CHANNELS) {
    assert.equal('keyPattern' in proj[c], false, '正则不该进投影')
    assert.equal(typeof proj[c].help.title, 'string')
    assert.equal(typeof proj[c].secret, 'boolean')
  }
  assert.equal(proj.wecom.keyLabel, '机器人 key')
  assert.equal(proj.custom.keyLabel, undefined)
})

/* ───────────────────── t2：URL 组装与反解 ───────────────────── */

import { composeUrl, parseKey } from '../src/channels/index.js'
import * as wecomAdapter from '../src/channels/wecom.js'
import * as dingtalkAdapter from '../src/channels/dingtalk.js'
import * as feishuAdapter from '../src/channels/feishu.js'
import * as slackAdapter from '../src/channels/slack.js'

const SAMPLES = {
  wecom: '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa',
  dingtalk: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  feishu: 'e1f2a3b4-c5d6-7890-abcd-ef1234567890',
}

test('composeUrl：只填 key 的渠道拼出完整地址（前缀与元数据一致）', () => {
  for (const [channel, key] of Object.entries(SAMPLES)) {
    const url = composeUrl({ channel, key })
    assert.equal(url, CHANNEL_META[channel].urlPrefix + key)
    assert.match(url, /^https:\/\//)
  }
})

test('composeUrl / parseKey 互逆：三渠道 key 原样往返', () => {
  for (const [channel, key] of Object.entries(SAMPLES)) {
    assert.equal(parseKey(channel, composeUrl({ channel, key })), key, `${channel} 应互逆`)
  }
})

test('composeUrl：填完整地址的渠道原样返回（不拼接）', () => {
  for (const c of URL_CHANNELS) {
    const url = 'https://example.com/hook/abc'
    assert.equal(composeUrl({ channel: c, url }), url)
  }
})

test('parseKey：填完整地址的渠道无反解概念 → undefined', () => {
  for (const c of URL_CHANNELS) assert.equal(parseKey(c, 'https://example.com/hook'), undefined)
})

test('parseKey：畸形/不匹配地址一律返回 undefined，绝不抛异常', () => {
  const cases = [
    ['wecom', 'not-a-url'],
    ['wecom', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send'],
    ['dingtalk', 'https://oapi.dingtalk.com/robot/send?foo=bar'],
    ['feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/'],
    ['feishu', ''],
    ['nope', 'https://example.com/hook'],
    ['wecom', undefined],
  ]
  for (const [channel, url] of cases) {
    assert.equal(parseKey(channel, url), undefined, `${channel}/${String(url).slice(0, 30)} 应反解失败`)
  }
})

test('composeUrl：未注册渠道回落 target.url（不抛）', () => {
  assert.equal(composeUrl({ channel: 'nope', url: 'https://example.com/x' }), 'https://example.com/x')
  assert.equal(composeUrl({}), '')
})

test('适配器薄封装与统一入口结果一致（免得两处实现分叉）', () => {
  const target = { channel: 'wecom', key: SAMPLES.wecom }
  assert.equal(wecomAdapter.composeUrl(target), composeUrl(target))
  assert.equal(dingtalkAdapter.parseKey(composeUrl({ channel: 'dingtalk', key: SAMPLES.dingtalk })), SAMPLES.dingtalk)
  assert.equal(feishuAdapter.parseKey(composeUrl({ channel: 'feishu', key: SAMPLES.feishu })), SAMPLES.feishu)
  assert.equal(slackAdapter.composeUrl({ channel: 'slack', url: 'https://hooks.slack.com/x' }), 'https://hooks.slack.com/x')
})
