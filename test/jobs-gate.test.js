/**
 * 后台 job 闸门单测（REQ-261001202058-0fbe）。
 *
 * 分四段，逐卡追加：
 * - 配置契约（t1 / TC-15、TC-17）
 * - 判定层 `createJobGate`（t2 / TC-2、3、6、7、8、9、13、14）
 * - 接线层 `createNotifier` + `handle`（t3）
 * - 端到端真 HTTP 接收端（t6）
 *
 * 跑法：node --test test/jobs-gate.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, DEFAULTS, VOLATILE_KEYS, normalizeConfig } from '../src/config.js'
import { createJobGate, isJobRegistryLike, isAgentRegistryLike, liveSubagentIds, DEFAULT_JOB_GRACE_MS } from '../src/jobs.js'
import { createNotifier, apply } from '../index.js'
import { BindingStore } from '../src/bindings.js'
import { TargetStore } from '../src/targets.js'

const silent = { warn() {}, info() {}, debug() {} }

/* ───────────────────────── 配置契约（t1） ───────────────────────── */

test('TC-17 新增开关 jobAwareComplete：默认 true 且属于可热改字段', () => {
  const parsed = Config({})
  assert.equal(parsed.jobAwareComplete.get(), true, 'schema 默认值应为 true')
  assert.equal(DEFAULTS.jobAwareComplete, true, 'DEFAULTS 与 schema 不许漂移')
  assert.ok(VOLATILE_KEYS.includes('jobAwareComplete'), '必须标 volatile（热改即生效，排障要靠它一键回旧行为）')
})

test('TC-17 非法值回落默认 true 并告警（配置写歪插件照样起）', () => {
  const warnings = []
  const out = normalizeConfig({ jobAwareComplete: 'yes' }, { warn: m => warnings.push(String(m)) })
  assert.equal(out.jobAwareComplete, true)
  assert.equal(warnings.length, 1, '恰好一条 warn，不刷屏')
  assert.match(warnings[0], /jobAwareComplete/)
})

test('TC-15 关掉开关读得回来（回滚路径：改配置不用重启）', () => {
  assert.equal(normalizeConfig({ jobAwareComplete: false }, silent).jobAwareComplete, false)
  assert.equal(normalizeConfig({}, silent).jobAwareComplete, true, '不写该键 = 启用新行为')
})

/* ─────────────────── 判定层：createJobGate（t2） ─────────────────── */

/** 假时钟：判定里所有「现在」都从它取，单测可瞬时推进。 */
function makeClock(start = 1000) {
  let now = start
  return {
    now: () => now,
    advance(ms) { now += ms; return now },
  }
}

/** 假计时器：宽限窗口不真等，`flush()` 等价于「到点了」。 */
function makeTimers() {
  let seq = 0
  const timers = []
  return {
    setTimer(fn, ms) {
      const handle = { id: ++seq, fn, ms, cancelled: false }
      timers.push(handle)
      return handle
    },
    clearTimer(handle) {
      if (handle !== undefined && handle !== null) handle.cancelled = true
    },
    /** 执行所有未取消的计时器（= 宽限窗口到点）。 */
    flush() {
      for (const handle of [...timers]) {
        if (handle.cancelled) continue
        handle.cancelled = true
        handle.fn()
      }
    },
    pendingCount() {
      return timers.filter(handle => !handle.cancelled).length
    },
  }
}

/**
 * 假 job 服务：与 DSH 契约同形——`list(caller)` 只给「自己的 + 无主的」且返回副本；
 * `events.subscribe` 注册监听；另有 settle / remove 两个测试助手推事件。
 */
function makeRegistry(initial = []) {
  const map = new Map(initial.map(job => [job.id, { ...job }]))
  const listeners = new Set()
  const emit = event => { for (const listener of [...listeners]) listener(event) }
  return {
    list(caller) {
      return [...map.values()]
        .filter(job => job.owner === caller || job.owner === undefined)
        .map(job => ({ ...job }))
    },
    events: {
      subscribe(_filter, listener) { listeners.add(listener); return () => listeners.delete(listener) },
    },
    /** 测试助手：当前订阅者数量（验证接线与回收用）。 */
    listenerCount() { return listeners.size },
    register(job) { map.set(job.id, { ...job }) },
    settle(id, status = 'completed') {
      const job = { ...map.get(id), status, finishedAt: 1 }
      map.set(id, job)
      emit({ type: 'settled', job: { ...job }, cause: 'completed', awaited: false })
    },
    remove(id) {
      const job = { ...map.get(id) }
      map.delete(id)
      emit({ type: 'removed', job })
    },
    emit,
  }
}

const sessionOf = id => ({ header: { id } })
const completeIntent = { kind: 'complete', event: 'turn/end', message: '会话已完成', toolName: null }
const jobOf = (over = {}) => ({
  id: 'bash-1', kind: 'bash', label: '跑全量测试', owner: 's1', status: 'running',
  startedAt: 1100, output: { total: 0, earliest: 0 }, ...over,
})

function makeGate({ registry, agents, timers = makeTimers(), clock = makeClock(), graceMs = 10 } = {}) {
  const delivered = []
  const warnings = []
  const gate = createJobGate({
    logger: { warn: m => warnings.push(String(m)), debug() {}, info() {} },
    graceMs,
    clock: clock.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    deliver: (session, intent, meta) => delivered.push({ session, intent, meta }),
    ...agents === undefined ? {} : { subagents: agents },
  })
  if (registry !== undefined) gate.attach(registry)
  return { gate, delivered, warnings, timers, clock }
}

/** 假 agent 注册表：`{ list() }` 形状；条目 = 一个 agent（只读 session.header 与 status）。 */
function makeAgents(initial = []) {
  let entries = initial.map(entry => ({ ...entry }))
  return {
    list: () => entries.map(entry => ({ ...entry })),
    set(next) { entries = next.map(entry => ({ ...entry })) },
  }
}

/** 一个 agent 条目：默认是「本会话派出的、正在跑的 subagent 后代」。 */
const agentOf = (id, parentSession, status = 'running', origin = 'subagent') => ({
  id,
  status,
  session: { header: { id, parentSession, origin } },
})

test('TC-2 job 服务形状不符：降级为「不抑制」，且只告警一次', () => {
  assert.equal(isJobRegistryLike({}), false)
  assert.equal(isJobRegistryLike({ list() {} }), false)
  assert.equal(isJobRegistryLike({ events: { subscribe() {} } }), false)
  assert.equal(isJobRegistryLike({ list() {}, events: { subscribe() {} } }), true)

  const { gate, warnings } = makeGate({ registry: { list() {} } })
  assert.equal(gate.available, false)
  assert.deepEqual(gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'unavailable' })
  gate.attach({ list() {} })
  gate.attach({ list() {} })
  assert.equal(warnings.filter(w => w.includes('job 服务不可用')).length, 1, '降级告警只报一次，不刷屏')
})

test('TC-3 本轮拉起且仍在 running 的 job → 抑制，并留下 pending 与捕获的 prompt', () => {
  const registry = makeRegistry([jobOf()])
  const { gate } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  const verdict = gate.gate(sessionOf('s1'), completeIntent, '跑一遍全量测试')
  assert.equal(verdict.suppressed, true)
  assert.deepEqual(verdict.jobIds, ['bash-1'])
  const pending = gate.pendingOf('s1')
  assert.deepEqual([...pending.watched], ['bash-1'])
  assert.equal(pending.prompt, '跑一遍全量测试', '补发时要用被抑制那一轮的话')
})

test('TC-4 别的会话的 job 与无主 job 都不算 → 照常发', () => {
  const registry = makeRegistry([
    jobOf({ id: 'bash-9', owner: 's2' }),
    jobOf({ id: 'bash-8', owner: undefined }),
  ])
  const { gate } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  assert.deepEqual(gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'no-work' })
})

test('TC-5 已结算（completed）的 job 不占着「活还没完」→ 照常发', () => {
  const registry = makeRegistry([jobOf({ status: 'completed', finishedAt: 1200 })])
  const { gate } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  assert.equal(gate.gate(sessionOf('s1'), completeIntent, null).suppressed, false)
})

test('TC-6 stopping（正在杀）同样参与抑制', () => {
  const registry = makeRegistry([jobOf({ status: 'stopping' })])
  const { gate } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  assert.equal(gate.gate(sessionOf('s1'), completeIntent, null).suppressed, true)
})

test('TC-7 常驻 job（早于本轮起点拉起）不参与抑制：不会把该会话永久静音', () => {
  const registry = makeRegistry([jobOf({ id: 'bash-dev-server', startedAt: 900 })])
  const { gate } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  assert.deepEqual(gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'no-work' })
})

test('TC-8 没有轮次起点（插件晚加载）→ 保守不抑制', () => {
  const registry = makeRegistry([jobOf()])
  const { gate } = makeGate({ registry })
  assert.deepEqual(gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'no-turn-start' })
})

test('TC-9 同毫秒边界（startedAt === 本轮起点）算本轮拉起', () => {
  const registry = makeRegistry([jobOf({ startedAt: 1000 })])
  const { gate } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  assert.equal(gate.gate(sessionOf('s1'), completeIntent, null).suppressed, true)
})

test('TC-14 两个 job 必须全部结算才补发；dispose 后推进计时器不再补发', () => {
  const registry = makeRegistry([jobOf({ id: 'bash-1' }), jobOf({ id: 'bash-2' })])
  const { gate, delivered, timers } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  assert.equal(gate.gate(sessionOf('s1'), completeIntent, 'x').suppressed, true)

  registry.settle('bash-1')
  assert.equal(delivered.length, 0, '还有一个没结算 → 不补发')
  assert.equal(timers.pendingCount(), 0, '没到齐就不该起计时器')

  registry.settle('bash-2')
  assert.equal(timers.pendingCount(), 1, '全部结算才起宽限计时器')
  assert.equal(delivered.length, 0, '宽限窗口未到 → 还不补发')

  const fresh = makeGate({ registry: makeRegistry([jobOf()]) })
  fresh.gate.noteTurnStart('s1', 1000)
  fresh.gate.gate(sessionOf('s1'), completeIntent, 'x')
  fresh.gate.dispose()
  fresh.timers.flush()
  assert.equal(fresh.delivered.length, 0, 'dispose 后不留悬挂计时器')

  timers.flush()
  assert.equal(delivered.length, 1, '宽限到点且期间没有新轮次 → 恰好补发一次')
  assert.equal(delivered[0].meta.prompt, 'x')
})

test('TC-13 killed / 记录被移除 与正常结算等价（都是「这活不再占着」）', () => {
  const registry = makeRegistry([jobOf()])
  const a = makeGate({ registry })
  a.gate.noteTurnStart('s1', 1000)
  a.gate.gate(sessionOf('s1'), completeIntent, null)
  registry.settle('bash-1', 'killed')
  a.timers.flush()
  assert.equal(a.delivered.length, 1, 'killed 也是终态')

  const registry2 = makeRegistry([jobOf()])
  const b = makeGate({ registry: registry2 })
  b.gate.noteTurnStart('s1', 1000)
  b.gate.gate(sessionOf('s1'), completeIntent, null)
  registry2.remove('bash-1')
  b.timers.flush()
  assert.equal(b.delivered.length, 1, '记录被移除同样是终态')
})

test('TC-2b 畸形事件（output 没有 job 字段 / 无 owner）不得抛异常', () => {
  const registry = makeRegistry([jobOf()])
  const { gate, delivered } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  gate.gate(sessionOf('s1'), completeIntent, null)
  assert.doesNotThrow(() => {
    gate.observe({ type: 'output', id: 'bash-1', owner: 's1', total: 3 })
    gate.observe({ type: 'progress' })
    gate.observe(undefined)
    gate.observe({ type: 'settled' })
    gate.observe({ type: 'settled', job: { id: 'bash-1' } })
  })
  assert.equal(delivered.length, 0, '畸形事件既不补发也不影响后续判定')
})

test('TC-2c 默认宽限窗口与「判定抛错也不抑制」', () => {
  assert.equal(DEFAULT_JOB_GRACE_MS, 1500)
  const boom = { list() { throw new Error('registry down') }, events: { subscribe() { return () => {} } } }
  const { gate, warnings } = makeGate({ registry: boom })
  gate.noteTurnStart('s1', 1000)
  assert.deepEqual(gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'error' })
  assert.ok(warnings.some(w => w.includes('判定异常')), '判定异常要留痕，但按「照旧发」处理')
})

test('TC-8b 新轮次作废上一条 pending：上一个结论不再补发', () => {
  const registry = makeRegistry([jobOf()])
  const { gate, delivered, timers } = makeGate({ registry })
  gate.noteTurnStart('s1', 1000)
  gate.gate(sessionOf('s1'), completeIntent, null)
  registry.settle('bash-1')
  gate.noteTurnStart('s1', 2000) // 新轮次开始（对应 DSH 的结算唤醒）
  timers.flush()
  assert.equal(delivered.length, 0, '新轮次会自己发完成通知，这里不再补发')
  assert.equal(gate.pendingOf('s1'), undefined)
})

/* ─────── 判定层：两路事实源 · subagent 后代（REQ-261005120639-f801 · t1） ─────── */

test('TC-S1 本会话 running 子代理 → 抑制，reason = subagent-running', () => {
  const agents = makeAgents([agentOf('s-child', 's1')])
  const { gate } = makeGate({ registry: makeRegistry([]), agents })
  gate.noteTurnStart('s1', 1000)
  const verdict = gate.gate(sessionOf('s1'), completeIntent, '写设计文档')
  assert.equal(verdict.suppressed, true)
  assert.equal(verdict.reason, 'subagent-running')
  assert.deepEqual(verdict.jobIds, [])
  assert.deepEqual(verdict.subagentIds, ['s-child'])
  const pending = gate.pendingOf('s1')
  assert.deepEqual(pending.subagentIds, ['s-child'], 'pending 要留痕，供补发日志与排障')
  assert.equal(pending.prompt, '写设计文档', '补发时要用被抑制那一轮的话')
})

test('TC-S2 空闲 / 异血统 / 非 subagent origin / 脏条目都不算「活」→ no-work', () => {
  const cases = [
    ['idle 子代理（跑完常驻，等着被继续用）', [agentOf('c1', 's1', 'idle')]],
    ['别的会话的子代理', [agentOf('c1', 's2')]],
    ['有 parentSession 但没有 origin（普通 fork / 派生窗口）',
      [{ id: 'c1', status: 'running', session: { header: { id: 'c1', parentSession: 's1' } } }]],
    ['origin 是别的值', [agentOf('c1', 's1', 'running', 'webhook')]],
    ['脏条目：缺 session.header', [{ id: 'c1', status: 'running' }]],
    ['脏条目：null / 字符串', [null, 'nope']],
  ]
  for (const [label, entries] of cases) {
    const { gate } = makeGate({ registry: makeRegistry([]), agents: makeAgents(entries) })
    gate.noteTurnStart('s1', 1000)
    assert.deepEqual(gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'no-work' }, label)
  }
})

test('TC-S3 血统任意深度计入；自指环不死循环', () => {
  const agents = makeAgents([
    agentOf('c1', 's1', 'idle'),
    agentOf('g1', 'c1', 'running'),
    agentOf('g2', 'g1', 'running'),
  ])
  const { gate } = makeGate({ registry: makeRegistry([]), agents })
  gate.noteTurnStart('s1', 1000)
  assert.deepEqual(gate.gate(sessionOf('s1'), completeIntent, null).subagentIds, ['g1', 'g2'])

  const ring = makeGate({ registry: makeRegistry([]), agents: makeAgents([agentOf('r1', 'r1', 'running')]) })
  ring.gate.noteTurnStart('r1', 1000)
  assert.deepEqual(ring.gate.gate(sessionOf('r1'), completeIntent, null), { suppressed: false, reason: 'no-work' })
})

test('TC-S4 三种抑制原因码：job-running / subagent-running / work-running', () => {
  const jobOnly = makeGate({ registry: makeRegistry([jobOf()]), agents: makeAgents([]) })
  jobOnly.gate.noteTurnStart('s1', 1000)
  const a = jobOnly.gate.gate(sessionOf('s1'), completeIntent, null)
  assert.equal(a.reason, 'job-running', '只有 job 时逐字保留既有原因码')
  assert.deepEqual(a.jobIds, ['bash-1'])
  assert.deepEqual(a.subagentIds, [])

  const both = makeGate({ registry: makeRegistry([jobOf()]), agents: makeAgents([agentOf('c1', 's1')]) })
  both.gate.noteTurnStart('s1', 1000)
  const b = both.gate.gate(sessionOf('s1'), completeIntent, null)
  assert.equal(b.reason, 'work-running')
  assert.deepEqual(b.jobIds, ['bash-1'])
  assert.deepEqual(b.subagentIds, ['c1'])
})

test('TC-S5 只有一路可用时，另一路照常工作', () => {
  // 没有 job 服务（老组合）但 agents 在：子代理判定仍然生效
  const onlyAgents = makeGate({ agents: makeAgents([agentOf('c1', 's1')]) })
  onlyAgents.gate.noteTurnStart('s1', 1000)
  assert.equal(onlyAgents.gate.gate(sessionOf('s1'), completeIntent, null).reason, 'subagent-running')
  // 没有 agents 但 job 在：既有判定不受影响
  const onlyJobs = makeGate({ registry: makeRegistry([jobOf()]) })
  onlyJobs.gate.noteTurnStart('s1', 1000)
  assert.equal(onlyJobs.gate.gate(sessionOf('s1'), completeIntent, null).reason, 'job-running')
  // 两路都没有：与改动前逐字一致
  const none = makeGate({})
  none.gate.noteTurnStart('s1', 1000)
  assert.deepEqual(none.gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'unavailable' })
})

test('TC-S6 agent 注册表形状不符 / list() 抛错 / 非数组：不抛、降级、告警一次', () => {
  assert.equal(isAgentRegistryLike({}), false)
  assert.equal(isAgentRegistryLike({ list() {} }), true)
  assert.equal(isAgentRegistryLike(null), false)

  const shaped = makeGate({ registry: makeRegistry([]), agents: {} })
  assert.equal(shaped.gate.subagentsAvailable, false)
  shaped.gate.noteTurnStart('s1', 1000)
  assert.deepEqual(shaped.gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'no-work' })
  shaped.gate.attachSubagents({})
  assert.equal(shaped.warnings.filter(w => w.includes('agent 注册表不可用')).length, 1, '降级告警只报一次')

  const boom = makeGate({ registry: makeRegistry([]), agents: { list() { throw new Error('down') } } })
  boom.gate.noteTurnStart('s1', 1000)
  assert.doesNotThrow(() => boom.gate.gate(sessionOf('s1'), completeIntent, null))
  assert.deepEqual(boom.gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'no-work' })
  assert.ok(boom.warnings.some(w => w.includes('list() 不可用')), '运行时不可用要留痕')

  const nope = makeGate({ registry: makeRegistry([]), agents: { list: () => 'nope' } })
  nope.gate.noteTurnStart('s1', 1000)
  assert.deepEqual(nope.gate.gate(sessionOf('s1'), completeIntent, null), { suppressed: false, reason: 'no-work' })
})

test('TC-S7 子代理结算后复检：全部结束才补发，且不重置宽限窗口', () => {
  const agents = makeAgents([agentOf('c1', 's1'), agentOf('c2', 's1')])
  const { gate, delivered, timers } = makeGate({ registry: makeRegistry([]), agents })
  gate.noteTurnStart('s1', 1000)
  assert.equal(gate.gate(sessionOf('s1'), completeIntent, 'x').suppressed, true)

  agents.set([agentOf('c1', 's1'), agentOf('c2', 's1', 'idle')])
  assert.equal(gate.observeSubagentEnd(), 1, '复检了 1 条 pending')
  assert.equal(timers.pendingCount(), 0, 'c1 还在跑 → 不起宽限')
  assert.equal(delivered.length, 0)

  agents.set([])
  gate.observeSubagentEnd()
  assert.equal(timers.pendingCount(), 1, '两路都空 → 起宽限')
  gate.observeSubagentEnd()
  assert.equal(timers.pendingCount(), 1, '已在等宽限 → 不重置、不叠加计时器')
  timers.flush()
  assert.equal(delivered.length, 1, '恰好补发一次')
  assert.equal(delivered[0].meta.prompt, 'x')
  assert.deepEqual(delivered[0].meta.subagentIds, ['c1', 'c2'], '补发携带被压住的 id 列表')

  const agents2 = makeAgents([agentOf('c1', 's1')])
  const b = makeGate({ registry: makeRegistry([]), agents: agents2 })
  b.gate.noteTurnStart('s1', 1000)
  b.gate.gate(sessionOf('s1'), completeIntent, null)
  agents2.set([])
  b.gate.observeSubagentEnd()
  b.gate.noteTurnStart('s1', 2000)
  b.timers.flush()
  assert.equal(b.delivered.length, 0, '新轮次自己会发完成通知，这里不再补发')
  assert.equal(b.gate.pendingOf('s1'), undefined)
})

test('TC-S8 job 与子代理混合：两路都清空才补发', () => {
  const registry = makeRegistry([jobOf()])
  const agents = makeAgents([agentOf('c1', 's1')])
  const { gate, delivered, timers } = makeGate({ registry, agents })
  gate.noteTurnStart('s1', 1000)
  assert.equal(gate.gate(sessionOf('s1'), completeIntent, null).reason, 'work-running')

  registry.settle('bash-1')
  assert.equal(timers.pendingCount(), 0, '子代理还在跑 → 仍不起宽限')
  agents.set([])
  gate.observeSubagentEnd()
  assert.equal(timers.pendingCount(), 1)
  timers.flush()
  assert.equal(delivered.length, 1)
})

test('TC-S9 宽限到点时子代理又忙起来：不补发、不丢 pending，下次复检仍能补发', () => {
  const agents = makeAgents([agentOf('c1', 's1')])
  const { gate, delivered, timers } = makeGate({ registry: makeRegistry([]), agents })
  gate.noteTurnStart('s1', 1000)
  gate.gate(sessionOf('s1'), completeIntent, 'x')
  agents.set([])
  gate.observeSubagentEnd()
  assert.equal(timers.pendingCount(), 1)

  agents.set([agentOf('c1', 's1')]) // 宽限窗口内又被唤醒进新 epoch
  timers.flush()
  assert.equal(delivered.length, 0, '还有活 → 不许补发')
  assert.ok(gate.pendingOf('s1') !== undefined, 'pending 必须留着：删了就等于把这条完成通知静默丢掉')

  agents.set([])
  gate.observeSubagentEnd()
  assert.equal(timers.pendingCount(), 1, '再次结算 → 重新起宽限')
  timers.flush()
  assert.equal(delivered.length, 1, '最终仍补发一条')
})

/* ─────────────── 接线层：createNotifier + handle（t3） ─────────────── */

/** 真 HTTP 接收端（口径照 test/e2e.local.test.js：起真服务、收真报文）。 */
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

/** 等接收端至少收到 count 条；超时抛带条数的错误（照 e2e.local.test.js 的口径）。 */
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

/** 临时目标/绑定文件：测试绝不写用户真实状态目录。 */
function tempStores() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-jobs-'))
  return {
    targets: new TargetStore({ path: join(dir, 'targets.json'), logger: silent }),
    bindings: new BindingStore({ path: join(dir, 'bindings.json'), logger: silent }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * 建一个指向本地接收端的通知运行时；`registry` 缺省 = 不注入 job 服务（降级路径）。
 * 报文字段裁到 session/prompt，去掉时间行，好让两次运行的报文可以逐字段比对。
 */
function makeRuntime({ url, registry, agents, timers = makeTimers(), clock = makeClock(), config = {} }) {
  const stores = tempStores()
  const saved = stores.targets.save({ name: '本地接收端', channel: 'custom', url, headers: {}, enabled: true, events: [], isDefault: true })
  assert.equal(saved.ok, true, '目标应保存成功')
  const notifier = createNotifier(
    { includeTitle: true, payload: { fields: ['session', 'prompt'], promptChars: 60 }, ...config },
    {
      logger: silent,
      targets: stores.targets,
      bindings: stores.bindings,
      jobs: registry,
      jobGraceMs: 10,
      clock: clock.now,
      timers,
      ...agents === undefined ? {} : { subagents: agents },
    },
  )
  return { notifier, stores }
}

const withoutAt = payload => {
  const copy = { ...payload }
  delete copy.at
  return copy
}

test('TC-3 接线：本轮 running job → turn/end 被压住（drop job-running，接收端 0 条）', async () => {
  const receiver = await withReceiver()
  const { notifier, stores } = makeRuntime({ url: receiver.url, registry: makeRegistry([jobOf()]) })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    const result = notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    assert.equal(result.action, 'dropped')
    assert.equal(result.reason, 'job-running')
    assert.deepEqual(result.jobIds, ['bash-1'])
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(receiver.received.length, 0, '被压住时不该有报文')
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-10/18/19 接线：job 结算 + 宽限到点 → 恰好补发 1 条，且与基线报文逐字段相等', async () => {
  const receiver = await withReceiver()
  const timers = makeTimers()
  const clock = makeClock()
  const shared = {
    url: receiver.url,
    timers,
    clock,
    config: {},
  }
  // 基线：同一会话、同一句话，但**没有**后台 job（不会被压住，正常投递）
  const baseline = makeRuntime(shared)
  const live = makeRuntime({ ...shared, registry: makeRegistry([jobOf()]) })
  try {
    const session = sessionOf('s1')
    const utterance = { type: 'user/message', data: { content: [{ type: 'text', text: '跑一遍全量测试' }] } }

    baseline.notifier.handle(session, utterance)
    baseline.notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await waitFor(receiver.received, 1)

    live.notifier.handle(session, utterance)
    live.notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(live.notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'dropped')

    const registryJobId = 'bash-1'
    live.notifier.gate.observe({ type: 'settled', job: { ...jobOf({ id: registryJobId, status: 'completed' }) } })
    timers.flush()
    await waitFor(receiver.received, 2)

    assert.equal(receiver.received.length, 2, '补发恰好一条，不重不漏')
    assert.deepEqual(
      withoutAt(receiver.received[1]),
      withoutAt(receiver.received[0]),
      '补发的报文必须与正常投递逐字段一致（含被抑制那一轮的「你说了什么」）',
    )
  } finally {
    baseline.stores.cleanup()
    live.stores.cleanup()
    await receiver.close()
  }
})

test('TC-11 接线：结算后宽限内开新轮次 → 不补发；新轮次自己的 turn/end 正常投递 1 条', async () => {
  const receiver = await withReceiver()
  const registry = makeRegistry([jobOf()])
  const timers = makeTimers()
  const { notifier, stores } = makeRuntime({ url: receiver.url, registry, timers })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'dropped')

    registry.settle('bash-1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 2 } }) // 对应 DSH 的结算唤醒
    timers.flush()
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(receiver.received.length, 0, '已开新轮次 → 不再补发，避免两条重复')

    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)
    assert.equal(receiver.received.length, 1)
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-12 接线：一轮两个 job，先结算一个不补发，第二个结算后才补发一条', async () => {
  const receiver = await withReceiver()
  const registry = makeRegistry([jobOf({ id: 'bash-1' }), jobOf({ id: 'bash-2' })])
  const timers = makeTimers()
  const { notifier, stores } = makeRuntime({ url: receiver.url, registry, timers })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'dropped')

    registry.settle('bash-1')
    timers.flush()
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(receiver.received.length, 0, '还有一个在跑 → 不补发')

    registry.settle('bash-2')
    timers.flush()
    await waitFor(receiver.received, 1)
    assert.equal(receiver.received.length, 1)
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-15 接线：jobAwareComplete=false → 逐字回到旧行为（照常发）', async () => {
  const receiver = await withReceiver()
  const { notifier, stores } = makeRuntime({
    url: receiver.url,
    registry: makeRegistry([jobOf()]),
    config: { jobAwareComplete: false },
  })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-16 接线：没注入 job 服务（降级）→ 照常发，且只留一条降级 warn', async () => {
  const receiver = await withReceiver()
  const warnings = []
  const stores = tempStores()
  stores.targets.save({ name: '本地接收端', channel: 'custom', url: receiver.url, headers: {}, enabled: true, events: [], isDefault: true })
  const notifier = createNotifier({ jobAwareComplete: true }, {
    logger: { warn: m => warnings.push(String(m)), debug() {}, info() {} },
    targets: stores.targets,
    bindings: stores.bindings,
  })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)
    assert.equal(warnings.filter(w => w.includes('job 服务不可用')).length, 0, '生产路径不主动 attach，不该无端告警')
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-16b 接线：attach 形状不符的 job 服务 → 降级 + 一条 warn，且照常发', async () => {
  const receiver = await withReceiver()
  const warnings = []
  const stores = tempStores()
  stores.targets.save({ name: '本地接收端', channel: 'custom', url: receiver.url, headers: {}, enabled: true, events: [], isDefault: true })
  const notifier = createNotifier({ jobAwareComplete: true }, {
    logger: { warn: m => warnings.push(String(m)), debug() {}, info() {} },
    targets: stores.targets,
    bindings: stores.bindings,
    jobs: { list() {} }, // 缺 events.subscribe → 形状不符
  })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)
    assert.equal(warnings.filter(w => w.includes('job 服务不可用')).length, 1)
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-14b 接线：dispose 后推进宽限计时器不再补发（无悬挂计时器）', async () => {
  const receiver = await withReceiver()
  const registry = makeRegistry([jobOf()])
  const timers = makeTimers()
  const { notifier, stores } = makeRuntime({ url: receiver.url, registry, timers })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'dropped')
    registry.settle('bash-1')
    notifier.dispose()
    timers.flush()
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(receiver.received.length, 0)
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-S10 接线：running 子代理 → 压住（drop subagent-running）；结束后 + 宽限到点 → 恰好补发 1 条', async () => {
  const receiver = await withReceiver()
  const timers = makeTimers()
  const clock = makeClock()
  const shared = { url: receiver.url, timers, clock }
  // 基线：同一会话、同一句话，但没有子代理在跑（正常投递）
  const baseline = makeRuntime(shared)
  const agents = makeAgents([agentOf('s-child', 's1')])
  const live = makeRuntime({ ...shared, registry: makeRegistry([]), agents })
  try {
    const session = sessionOf('s1')
    const utterance = { type: 'user/message', data: { content: [{ type: 'text', text: '写设计文档' }] } }

    baseline.notifier.handle(session, utterance)
    baseline.notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await waitFor(receiver.received, 1)

    live.notifier.handle(session, utterance)
    live.notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    const verdict = live.notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    assert.equal(verdict.action, 'dropped')
    assert.equal(verdict.reason, 'subagent-running')
    assert.deepEqual(verdict.subagentIds, ['s-child'])
    assert.deepEqual(verdict.jobIds, [])
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(receiver.received.length, 1, '被压住时不该有新报文')

    agents.set([]) // 子代理结算（生产里由 ctx.on('subagent/end') 触发）
    assert.equal(live.notifier.gate.observeSubagentEnd(), 1)
    timers.flush()
    await waitFor(receiver.received, 2)
    assert.equal(receiver.received.length, 2, '补发恰好一条')
    assert.deepEqual(
      withoutAt(receiver.received[1]),
      withoutAt(receiver.received[0]),
      '补发报文必须与正常投递逐字段一致（含被压住那一轮的「你说了什么」）',
    )
  } finally {
    baseline.stores.cleanup()
    live.stores.cleanup()
    await receiver.close()
  }
})

test('TC-S11 接线：子代理结束后宽限内开新轮次 → 不补发；新轮次自己的 turn/end 正常投递 1 条', async () => {
  const receiver = await withReceiver()
  const timers = makeTimers()
  const agents = makeAgents([agentOf('s-child', 's1')])
  const { notifier, stores } = makeRuntime({ url: receiver.url, registry: makeRegistry([]), agents, timers })
  try {
    const session = sessionOf('s1')
    notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'dropped')

    agents.set([])
    notifier.gate.observeSubagentEnd()
    notifier.handle(session, { type: 'turn/start', data: { turn: 2 } }) // 对应 DSH 的结果唤醒
    timers.flush()
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(receiver.received.length, 0, '已开新轮次 → 不再补发，避免两条重复')

    assert.equal(notifier.handle(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)
    assert.equal(receiver.received.length, 1)
  } finally {
    await receiver.close()
    stores.cleanup()
  }
})

test('TC-S12 接线：开关关闭 / 没注入 agents → 逐字回到旧行为（照常发）', async () => {
  const receiver = await withReceiver()
  const offAgents = makeAgents([agentOf('s-child', 's1')])
  const off = makeRuntime({
    url: receiver.url,
    registry: makeRegistry([]),
    agents: offAgents,
    config: { jobAwareComplete: false },
  })
  const noAgents = makeRuntime({ url: receiver.url, registry: makeRegistry([]) })
  try {
    const session = sessionOf('s1')
    off.notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(off.notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 1)

    noAgents.notifier.handle(session, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(noAgents.notifier.handle(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }).action, 'sent')
    await waitFor(receiver.received, 2)
  } finally {
    off.stores.cleanup()
    noAgents.stores.cleanup()
    await receiver.close()
  }
})

test('TC-17b 接线（生产路径）：ctx.inject([jobs]) 就绪后自动接上闸门，回收时摘掉订阅', () => {
  const registry = makeRegistry([])
  /** 假 Cordis ctx：inject 立刻以「服务已就绪」回调，并把它返回的清理函数交回给调用方。 */
  const ctx = {
    logger: silent,
    on() { return () => {} },
    provide() { return () => {} },
    effect(fn) {
      const teardown = fn()
      return () => { if (typeof teardown === 'function') teardown() }
    },
    inject(_deps, cb) {
      return cb({ jobs: registry, effect(fn) { return fn() } })
    },
  }

  const dispose = apply(ctx, {})
  assert.equal(registry.listenerCount(), 1, 'job 服务一就绪，闸门就该订阅上（旧行为下这里恒为 0）')

  if (typeof dispose === 'function') dispose()
  assert.equal(registry.listenerCount(), 0, '插件卸载时必须摘掉订阅，不留悬挂监听')
})

test('TC-S13 接线（生产路径）：ctx.inject([agents]) 与 subagent/end 都接上，回收时摘掉', () => {
  const agents = makeAgents([agentOf('s-child', 's1')])
  const handlers = new Map()
  const injected = []
  const ctx = {
    logger: silent,
    on(name, cb) { handlers.set(name, cb); return () => handlers.delete(name) },
    provide() { return () => {} },
    effect(fn) {
      const teardown = fn()
      return () => { if (typeof teardown === 'function') teardown() }
    },
    inject(deps, cb) {
      injected.push(deps[0])
      return cb({
        // 生产里这三个属性来自各自的 Host 服务；这里只要形状对得上
        agents,
        jobs: undefined,
        webServer: undefined,
        effect(fn) { const teardown = fn(); return () => { if (typeof teardown === 'function') teardown() } },
      })
    },
  }

  const dispose = apply(ctx, {})
  assert.ok(injected.includes('agents'), '生产路径必须去要 agents 服务（子代理事实源）')
  assert.ok(injected.includes('jobs'), '既有 job 接线不能被挤掉')
  assert.ok(handlers.has('subagent/end'), '必须订阅子代理结算事件（复检时机）')
  assert.doesNotThrow(() => handlers.get('subagent/end')({ runId: 'run-1', id: 's-child', stopReason: 'completed' }))

  if (typeof dispose === 'function') dispose()
  assert.equal(handlers.has('subagent/end'), false, '卸载时必须摘掉 subagent/end 订阅，不留悬挂监听')
})
