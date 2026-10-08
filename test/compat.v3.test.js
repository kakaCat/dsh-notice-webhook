/**
 * v1→v2 迁移与回滚的验收测试（t4，对应 TC-12 / TC-13 / TC-14 / TC-15）。
 *
 * 跑法：node --test test/compat.v3.test.js
 *
 * 为什么单独一份：本轮把「URL 由用户填」改成「URL 由 Host 按 key 组装」，
 * 老用户的 targets.json 里**只有整条 url**——升级要能反解，反解不了要照样能投，
 * 回滚到旧版本也不能丢投递能力。这三件事各有一条用例守着。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { composeUrl } from '../src/channels/index.js'
import { TargetStore } from '../src/targets.js'

const silent = { warn() {} }

const WECOM_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa'
const DINGTALK_URL = 'https://oapi.dingtalk.com/robot/send?access_token=a1b2c3d4e5f60718293a4b5c6d7e8f90'
const FEISHU_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/e1f2a3b4-c5d6-7890-abcd-ef1234567890'

function withTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-compat-v3-'))
  try {
    return run(join(dir, 'targets.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const v1File = targets => JSON.stringify({ version: 1, targets }, null, 2)

test('TC-12 命中前缀：反解出 key 并把文件升为 v3', () => {
  withTemp(path => {
    writeFileSync(path, v1File([
      { id: 'a', name: '企微群', channel: 'wecom', url: WECOM_URL, enabled: true, events: [], isDefault: true },
      { id: 'b', name: '钉钉群', channel: 'dingtalk', url: DINGTALK_URL, enabled: true, events: [], isDefault: false },
      { id: 'c', name: '飞书群', channel: 'feishu', url: FEISHU_URL, enabled: true, events: [], isDefault: false },
    ]), 'utf8')

    const store = new TargetStore({ path, logger: silent }).load()
    assert.equal(store.get('a').key, '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa')
    assert.equal(store.get('b').key, 'a1b2c3d4e5f60718293a4b5c6d7e8f90')
    assert.equal(store.get('c').key, 'e1f2a3b4-c5d6-7890-abcd-ef1234567890')
    // 派生地址与原文一致（拼装结果不许漂）
    assert.equal(store.get('a').url, WECOM_URL)

    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.version, 3, '读成功后应立即升到当前版本（v3）落盘')
    assert.equal(onDisk.targets.length, 3)
  })
})

test('TC-13 前缀不命中的老条目：保留原地址直投，不丢目标、不猜 key', () => {
  withTemp(path => {
    writeFileSync(path, v1File([
      { id: 'legacy', name: '手改过的', channel: 'wecom', url: 'https://example.com/my-own-hook', enabled: true, events: [], isDefault: true },
    ]), 'utf8')

    const store = new TargetStore({ path, logger: silent }).load()
    assert.equal(store.list().length, 1, '不得丢目标')
    const target = store.get('legacy')
    assert.equal(target.key, undefined, '反解不出就不塞 key')
    assert.equal(target.url, 'https://example.com/my-own-hook')
    // 投递用的组装入口必须回落到原地址（否则会拼出只有前缀的坏地址）
    assert.equal(composeUrl(target), 'https://example.com/my-own-hook')
  })
})

test('TC-13 命中与不命中混在同一个 v1 文件里：各按各的来', () => {
  withTemp(path => {
    writeFileSync(path, v1File([
      { id: 'ok', name: '正规企微', channel: 'wecom', url: WECOM_URL, enabled: true, events: [], isDefault: true },
      { id: 'odd', name: '手改过', channel: 'wecom', url: 'https://example.com/x', enabled: true, events: [], isDefault: false },
    ]), 'utf8')
    const store = new TargetStore({ path, logger: silent }).load()
    assert.equal(store.get('ok').key.length > 0, true)
    assert.equal(store.get('odd').key, undefined)
    assert.equal(composeUrl(store.get('ok')), WECOM_URL)
    assert.equal(composeUrl(store.get('odd')), 'https://example.com/x')
  })
})

test('TC-14 回滚模拟：升级后的文件里仍留着可投递的 url（旧版本只读 url 也能发）', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    store.save({ name: '企微群', channel: 'wecom', key: '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa' })

    // 模拟旧版本读取路径：它只认 url（忽略 key 这个新字段）
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.version, 3)
    const oldReaderSees = onDisk.targets.map(t => t.url)
    for (const url of oldReaderSees) {
      assert.match(url, /^https:\/\/\S+$/, '旧版本必须能拿到可投递地址')
    }
    assert.equal(oldReaderSees[0], WECOM_URL)
  })
})

test('已是当前版本的文件直接读：不重复迁移、字段保持', () => {
  withTemp(path => {
    const first = new TargetStore({ path, logger: silent })
    first.save({ name: '企微群', channel: 'wecom', key: '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa', events: ['turn/end'] })
    const before = readFileSync(path, 'utf8')

    const second = new TargetStore({ path, logger: silent }).load()
    assert.equal(second.get(second.list()[0].id).key, '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa')
    assert.deepEqual(second.list()[0].events, ['turn/end'])
    assert.equal(readFileSync(path, 'utf8'), before, '已是当前版本就不该再写盘')
  })
})

test('TC-15 坏文件 / 未知版本：空清单且原文件字节不变', () => {
  withTemp(path => {
    for (const bad of ['{broken', JSON.stringify({ version: 99, targets: [{}] })]) {
      writeFileSync(path, bad, 'utf8')
      const store = new TargetStore({ path, logger: silent }).load()
      assert.deepEqual(store.list(), [])
      assert.equal(readFileSync(path, 'utf8'), bad, '不得覆盖')
    }
  })
})
