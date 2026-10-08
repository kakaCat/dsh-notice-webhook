/**
 * 迁移与兼容单测（t10 验收）：旧数据降级、共存边界、回滚残留。
 *
 * 跑法：node --test test/compat.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BindingStore, FILE_VERSION } from '../src/bindings.js'
import { TargetStore } from '../src/targets.js'
import { createNotifier } from '../index.js'

const silent = { warn() {}, info() {}, debug() {} }

function tempHome() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-compat-'))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const statePath = root => join(root, 'state', 'dsh-notice-webhook', 'bindings.json')
/** 目标清单的临时路径：测试绝不能落到真实 $DSH_HOME（tempHome 不改进程环境变量）。 */
const targetsPath = root => join(root, 'state', 'dsh-notice-webhook', 'targets.json')

test('旧数据：绑定文件不存在时按空表启动，且不创建文件（零迁移）', () => {
  const home = tempHome()
  try {
    const store = new BindingStore({ path: statePath(home.root), logger: silent }).load()
    assert.deepEqual(store.list(), [])
    assert.equal(existsSync(statePath(home.root)), false, '只读启动不得创建文件')
  } finally {
    home.cleanup()
  }
})

test('旧数据：未知 version 按空表处理且不覆盖原文件', () => {
  const home = tempHome()
  try {
    const path = statePath(home.root)
    mkdirSync(join(home.root, 'state', 'dsh-notice-webhook'), { recursive: true })
    const future = JSON.stringify({ version: 99, bindings: { s1: { url: 'https://example.com/old', updatedAt: '2026-01-01T00:00:00.000Z' } } })
    writeFileSync(path, future, 'utf8')

    const store = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(store.list(), [])
    assert.equal(readFileSync(path, 'utf8'), future, '不认识的文件必须原样保留，便于人工抢救')
  } finally {
    home.cleanup()
  }
})

test('版本兼容：读取当前 version 的文件正常工作', () => {
  const home = tempHome()
  try {
    const path = statePath(home.root)
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-a', 'https://example.com/hook')

    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.version, FILE_VERSION)
    const reloaded = new BindingStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.resolve('session-a'), { url: 'https://example.com/hook', source: 'binding' })
  } finally {
    home.cleanup()
  }
})

test('写入失败时绑定仍在内存生效，且留下告警（不静默失败）', () => {
  const home = tempHome()
  try {
    const dir = join(home.root, 'readonly')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'bindings.json')
    const warnings = []
    const store = new BindingStore({ path, logger: { warn: m => warnings.push(String(m)) } })
    chmodSync(dir, 0o500) // 目录不可写
    try {
      assert.equal(store.bind('session-a', 'https://example.com/hook'), true, '内存层仍应生效')
      assert.deepEqual(store.list().map(e => e.sessionId), ['session-a'])
      if (process.getuid?.() !== 0 && warnings.length === 0) {
        // root 会绕过权限限制；非 root 环境下必须留下告警
        assert.fail('写入失败必须留下告警，不得静默')
      }
    } finally {
      chmodSync(dir, 0o700)
    }
  } finally {
    home.cleanup()
  }
})

test('回滚：插件只在自己的目录下写一个 bindings.json，无其他残留', () => {
  const home = tempHome()
  try {
    const path = statePath(home.root)
    const store = new BindingStore({ path, logger: silent })
    store.bind('session-a', 'https://example.com/hook')

    const stateDir = join(home.root, 'state', 'dsh-notice-webhook')
    assert.deepEqual(readdirSync(stateDir), ['bindings.json'], '临时 .tmp 必须已被 rename 掉')

    // 卸载 = 删掉这个文件即完全回滚（不碰任何会话数据）
    rmSync(stateDir, { recursive: true, force: true })
    assert.equal(existsSync(stateDir), false)
    assert.deepEqual(new BindingStore({ path, logger: silent }).load().list(), [])
  } finally {
    home.cleanup()
  }
})

test('共存：不读也不写 dsh-notice 的触发目录', () => {
  const home = tempHome()
  try {
    // 伪造一个 dsh-notice 的触发目录与已有触发文件
    const noticeTriggerDir = join(home.root, 'AppData', 'dsh-notice', 'triggers')
    mkdirSync(noticeTriggerDir, { recursive: true })
    writeFileSync(join(noticeTriggerDir, 'notify-existing.json'), '{"title":"x","message":"y"}', 'utf8')

    const notifier = createNotifier(
      { webhookUrl: '', bindings: { s1: 'https://example.com/hook' } },
      {
        logger: silent,
        store: new BindingStore({ path: statePath(home.root), logger: silent }),
        targets: new TargetStore({ path: targetsPath(home.root), logger: silent }),
      },
    )
    notifier.handle({ header: { id: 's1' } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })

    assert.deepEqual(readdirSync(noticeTriggerDir), ['notify-existing.json'], '不得动对方的触发目录')
  } finally {
    home.cleanup()
  }
})

test('配置期初始绑定：启动时灌入，且不覆盖运行时已有的同 key 绑定', () => {
  const home = tempHome()
  try {
    const path = statePath(home.root)
    const seeded = new BindingStore({ path, logger: silent })
    seeded.bind('session-keep', 'https://example.com/runtime')
    seeded.bind('session-gone', 'https://example.com/old')
    seeded.unbind('session-gone')

    const notifier = createNotifier(
      { webhookUrl: '', bindings: { 'session-keep': 'https://example.com/from-config', 'session-new': 'https://example.com/new' } },
      { logger: silent, store: new BindingStore({ path, logger: silent }).load(), targets: new TargetStore({ path: targetsPath(home.root), logger: silent }) },
    )
    assert.deepEqual(notifier.service.resolve('session-keep'), { url: 'https://example.com/runtime', source: 'binding' })
    assert.deepEqual(notifier.service.resolve('session-new'), { url: 'https://example.com/new', source: 'binding' })
  } finally {
    home.cleanup()
  }
})
