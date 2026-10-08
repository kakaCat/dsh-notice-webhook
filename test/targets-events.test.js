/**
 * 目标「关心事件」语义的验收测试 —— REQ-261001203114-19b6（t2 / t6，覆盖设计 TC-6 的 T6-1…T6-12）。
 *
 * 为什么要这一份：改动前 UI 把「全选」写成**显式四项**，而逐目标过滤是白名单——
 * 新增 `turn/error` 后，所有既有目标都会把中断通知静默过滤掉。这里把「老记录开箱即收」
 * 与「用户主动取消勾选后关得掉」两条相反的要求同时钉死。
 *
 * 跑法：node --test test/targets-events.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EVENT_TYPES,
  LEGACY_ALL_EVENTS,
  TARGET_FILE_VERSION,
  TargetStore,
  normalizeEvents,
} from '../src/targets.js'
import { targetAccepts } from '../src/router.js'

const silent = { warn() {} }

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-events-'))
  const path = join(dir, 'targets.json')
  return {
    dir,
    path,
    store: new TargetStore({ path, logger: silent }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function readFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('T6-10：事件清单含 turn/error，且既有四项一个不少', () => {
  assert.equal(EVENT_TYPES.includes('turn/error'), true)
  for (const event of LEGACY_ALL_EVENTS) assert.equal(EVENT_TYPES.includes(event), true, `${event} 不能被挤掉`)
  assert.equal(EVENT_TYPES.length, LEGACY_ALL_EVENTS.length + 1)
})

test('T6-1…T6-3：归一化判定式（缺省推断 / 显式保持 / 空列表两种含义）', () => {
  // 空列表且无 mode：老语义「全收」
  assert.deepEqual(normalizeEvents([], undefined), { events: [], eventsMode: 'all' })
  // 恰等于旧版全集且无 mode：一次性兼容为全收
  assert.deepEqual(normalizeEvents([...LEGACY_ALL_EVENTS], undefined), { events: [], eventsMode: 'all' })
  // 显式 all：全收
  assert.deepEqual(normalizeEvents(['turn/end'], 'all'), { events: [], eventsMode: 'all' })
  // 显式空列表：**什么都不收**（不是全收）——两种空语义必须分得开
  assert.deepEqual(normalizeEvents([], 'explicit'), { events: [], eventsMode: 'explicit' })
  // 显式四项（用户取消勾选「会话中断」）：原样保持，不迁移成全收
  assert.deepEqual(normalizeEvents([...LEGACY_ALL_EVENTS], 'explicit'), { events: [...LEGACY_ALL_EVENTS], eventsMode: 'explicit' })
})

test('T6-5/T6-6：子集按显式处理；顺序无关、去重、幂等', () => {
  const one = normalizeEvents(['turn/end'], undefined)
  assert.deepEqual(one, { events: ['turn/end'], eventsMode: 'explicit' })
  assert.deepEqual(normalizeEvents(one.events, one.eventsMode), one, '幂等')
  const shuffled = normalizeEvents([...LEGACY_ALL_EVENTS].reverse(), undefined)
  assert.deepEqual(shuffled, { events: [], eventsMode: 'all' }, '集合相等即算旧版全集，与顺序无关')
  assert.deepEqual(normalizeEvents(['turn/end', 'turn/end'], 'explicit').events, ['turn/end'], '去重')
  // 非法 mode 按缺省处理（不猜、不抛）
  assert.deepEqual(normalizeEvents([], 'weird'), { events: [], eventsMode: 'all' })
  assert.deepEqual(normalizeEvents(null, null), { events: [], eventsMode: 'all' })
})

test('T6-9/T6-11/T6-12：接收语义（explicit 空 = 全不收；all = 全收；缺省 = 旧口径）', () => {
  const explicitEmpty = { events: [], eventsMode: 'explicit' }
  for (const event of ['turn/error', 'turn/end', 'goal/complete', 'approval/asked']) {
    assert.equal(targetAccepts(explicitEmpty, event), false, `显式空列表不该收 ${event}`)
  }
  assert.equal(targetAccepts({ events: [], eventsMode: 'all' }, 'turn/error'), true)
  assert.equal(targetAccepts({ events: ['turn/end'], eventsMode: 'all' }, 'turn/error'), true, 'mode 说了算')
  // 缺省（未归一化的外部输入 / 直接构造的测试目标）逐字保持旧口径
  assert.equal(targetAccepts({ events: [] }, 'turn/error'), true)
  assert.equal(targetAccepts({ events: ['turn/end'] }, 'turn/error'), false)
  assert.equal(targetAccepts({ events: ['goal/*'] }, 'goal/blocked'), true, 'goal/* 通配在显式模式下同样生效')
  assert.equal(targetAccepts({ events: ['goal/*'], eventsMode: 'explicit' }, 'goal/blocked'), true)
  assert.equal(targetAccepts({ events: ['goal/*'], eventsMode: 'explicit' }, 'turn/error'), false)
})

test('T6-7：保存后落盘 —— version 仍是 3，记录带 eventsMode，既有字段一字未改', () => {
  const s = tempStore()
  try {
    const verdict = s.store.save({ name: '企微群', channel: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', enabled: true, isDefault: true, events: [] })
    assert.equal(verdict.ok, true)
    assert.equal(verdict.target.eventsMode, 'all')
    const file = readFile(s.path)
    assert.equal(file.version, TARGET_FILE_VERSION)
    assert.equal(file.version, 3, '不升版本号——回滚时旧插件必须还能读')
    assert.equal(file.targets[0].eventsMode, 'all')
    assert.deepEqual(file.targets[0].events, [])
    assert.equal(file.targets[0].url, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', '既有字段不得被改写')
  } finally {
    s.cleanup()
  }
})

test('T6-2：老记录（显式四项、无 mode）载入后开箱即收中断通知', () => {
  const s = tempStore()
  try {
    // 直接构造「改动前 UI 写下的文件」：version 3、显式四项、没有 eventsMode
    const legacy = {
      version: TARGET_FILE_VERSION,
      targets: [{
        id: 't-legacy', name: '老群', channel: 'custom', url: 'https://example.com/hook',
        enabled: true, isDefault: true, events: [...LEGACY_ALL_EVENTS], payload: null,
      }],
    }
    writeFileSync(s.path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    s.store.load()
    const target = s.store.get('t-legacy')
    assert.notEqual(target, undefined)
    assert.deepEqual(target.events, [], '「全选」的老记录归一化为全收')
    assert.equal(target.eventsMode, 'all')
    assert.equal(targetAccepts(target, 'turn/error'), true, '中断通知必须能到老目标——否则这次改动等于没做')
  } finally {
    s.cleanup()
  }
})

test('T6-4：用户主动取消勾选「会话中断」后，关得掉（显式四项不被迁移）', () => {
  const s = tempStore()
  try {
    const saved = s.store.save({
      name: '只想收旧的', channel: 'custom', url: 'https://example.com/hook',
      enabled: true, isDefault: true, events: [...LEGACY_ALL_EVENTS], eventsMode: 'explicit',
    })
    assert.equal(saved.ok, true)

    // 重新载入（新进程视角）
    const again = new TargetStore({ path: s.path, logger: silent }).load()
    const target = again.list()[0]
    assert.equal(target.eventsMode, 'explicit')
    assert.deepEqual([...target.events].sort(), [...LEGACY_ALL_EVENTS].sort())
    assert.equal(targetAccepts(target, 'turn/error'), false, '明确不要中断 → 不该被自动勾回')
    assert.equal(targetAccepts(target, 'turn/end'), true)
  } finally {
    s.cleanup()
  }
})

test('T6-8：旧版本读新文件——多余字段被忽略，events 语义不变（回滚可读）', () => {
  const s = tempStore()
  try {
    s.store.save({ name: '新写的', channel: 'custom', url: 'https://example.com/hook', enabled: true, isDefault: true, events: [] })
    const file = readFile(s.path)
    // 模拟旧版本：只按已知字段白名单取值
    const known = ['id', 'name', 'channel', 'url', 'key', 'secretRef', 'headers', 'enabled', 'events', 'isDefault', 'payload']
    const oldView = Object.fromEntries(Object.entries(file.targets[0]).filter(([key]) => known.includes(key)))
    assert.equal('eventsMode' in oldView, false, '旧版本看不到 eventsMode')
    assert.deepEqual(oldView.events, [], '空列表在旧语义里同样是全收')
    assert.equal(file.version, TARGET_FILE_VERSION, '版本没变 → 旧版本不会把文件判成「不认识」')
  } finally {
    s.cleanup()
  }
})

test('未知事件取值仍被拒绝（既有校验不放松）', () => {
  const s = tempStore()
  try {
    const verdict = s.store.save({ name: 'x', channel: 'custom', url: 'https://example.com/hook', events: ['turn/error', 'no/such-event'] })
    assert.equal(verdict.ok, false)
    assert.ok(verdict.errors.some(e => e.includes('不认识的关心事件')), JSON.stringify(verdict.errors))
  } finally {
    s.cleanup()
  }
})
