/**
 * 目标清单存储的验收测试（t3）。
 *
 * 跑法：node --test test/targets.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TARGET_FILE_VERSION, TargetStore, validateTarget } from '../src/targets.js'

const silent = { warn() {} }

function withTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-targets-'))
  try {
    return run(join(dir, 'targets.json'), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const wecom = name => ({ name, channel: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***' })

test('新增目标：落盘为 {version:1, targets:[…]}，可读回', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const saved = store.save(wecom('项目群-企微'))
    assert.equal(saved.ok, true)
    assert.match(saved.target.id, /^[a-z0-9-]+$/)
    assert.equal(saved.target.enabled, true)
    assert.deepEqual(saved.target.events, [])

    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.version, TARGET_FILE_VERSION)
    assert.equal(onDisk.targets.length, 1)
    assert.equal(onDisk.targets[0].name, '项目群-企微')

    const reloaded = new TargetStore({ path, logger: silent }).load()
    assert.equal(reloaded.list().length, 1)
    assert.equal(reloaded.get(saved.target.id).channel, 'wecom')
  })
})

test('id 由名称生成且唯一（同名两条不冲突）', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const a = store.save(wecom('项目群'))
    const b = store.save(wecom('项目群'))
    assert.equal(a.ok && b.ok, true)
    assert.notEqual(a.target.id, b.target.id)
    assert.equal(store.list().length, 2)
  })
})

test('修改：带 id 覆盖同一条，不新增', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const created = store.save(wecom('项目群-企微'))
    const updated = store.save({ ...created.target, name: '项目群-企微（改名）', isDefault: true })
    assert.equal(updated.ok, true)
    assert.equal(store.list().length, 1)
    assert.equal(store.get(created.target.id).name, '项目群-企微（改名）')
    assert.equal(store.get(created.target.id).isDefault, true)
  })
})

test('非法目标被拒且不落盘（文件保持原样）', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    store.save(wecom('合法目标'))
    const before = readFileSync(path)

    const cases = [
      [{ name: '', channel: 'wecom', url: 'https://example.com/hook' }, '名称为空'],
      [{ name: 'x', channel: 'wecom', url: 'ftp://example.com/hook' }, '地址非 http(s)'],
      [{ name: 'x', channel: 'nope', url: 'https://example.com/hook' }, '渠道不认识'],
      [{ name: 'x', channel: 'slack', url: 'https://example.com/hook', secretRef: 'S' }, '非加签渠道带密钥'],
      [{ name: 'x', channel: 'wecom', url: 'https://example.com/hook', headers: { a: 'b' } }, '非自定义渠道带头'],
      [{ name: 'x', channel: 'custom', url: 'https://example.com/hook', events: ['nope'] }, '事件取值不认识'],
    ]
    for (const [input, why] of cases) {
      const verdict = store.save(input)
      assert.equal(verdict.ok, false, `${why} 应被拒`)
      assert.ok(verdict.errors.length > 0)
    }
    assert.deepEqual(readFileSync(path), before, '被拒的保存不得改动文件')
    assert.equal(store.list().length, 1)
  })
})

test('渠道×字段交叉约束：钉钉可带密钥，自定义可带头', () => {
  const dingtalk = validateTarget({ name: 'x', channel: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send?access_token=***', secretRef: 'DINGTALK_SECRET' })
  assert.equal(dingtalk.ok, true)
  assert.equal(dingtalk.target.secretRef, 'DINGTALK_SECRET')

  const custom = validateTarget({ name: 'x', channel: 'custom', url: 'https://example.com/hook', headers: { Authorization: 'Bearer x' } })
  assert.equal(custom.ok, true)
  assert.deepEqual(custom.target.headers, { Authorization: 'Bearer x' })
})

test('删除目标：内存与文件同步', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const created = store.save(wecom('待删'))
    assert.equal(store.remove(created.target.id), true)
    assert.equal(store.list().length, 0)
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).targets.length, 0)
    assert.equal(store.remove('不存在'), false)
  })
})

test('启停：setEnabled 落盘且不影响其他字段', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const created = store.save({ ...wecom('开关'), events: ['turn/end'] })
    assert.equal(store.setEnabled(created.target.id, false).ok, true)
    const reloaded = new TargetStore({ path, logger: silent }).load().get(created.target.id)
    assert.equal(reloaded.enabled, false)
    assert.deepEqual(reloaded.events, ['turn/end'])
  })
})

test('文件缺失：空清单且不创建文件', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent }).load()
    assert.deepEqual(store.list(), [])
    assert.equal(existsSync(path), false)
  })
})

test('非法 JSON / 未知 version：空清单且不覆盖原文件', () => {
  withTemp((path, dir) => {
    mkdirSync(dir, { recursive: true })
    for (const bad of ['{broken\n', JSON.stringify({ version: 99, targets: [] })]) {
      writeFileSync(path, bad, 'utf8')
      const store = new TargetStore({ path, logger: silent }).load()
      assert.deepEqual(store.list(), [])
      assert.equal(readFileSync(path, 'utf8'), bad, '原文件必须保持不变')
    }
  })
})

test('单条非法只跳过该条，其余照常加载', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    store.save(wecom('好的'))
    const file = JSON.parse(readFileSync(path, 'utf8'))
    file.targets.push({ id: 'bad-one', name: '坏记录', channel: 'nope', url: 'ftp://x' })
    writeFileSync(path, JSON.stringify(file), 'utf8')

    const reloaded = new TargetStore({ path, logger: silent }).load()
    assert.deepEqual(reloaded.list().map(t => t.name), ['好的'])
  })
})

test('落盘失败：保存被拒且内存回滚（不谎报成功）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notice-webhook-targets-ro-'))
  try {
    const path = join(dir, 'targets.json')
    const store = new TargetStore({ path, logger: silent })
    store.save(wecom('先成功一条'))
    const before = readFileSync(path)

    chmodSync(dir, 0o500) // 目录不可写 → rename 失败
    try {
      const verdict = store.save(wecom('写不进去'))
      if (process.getuid?.() !== 0) {
        assert.equal(verdict.ok, false)
        assert.ok(verdict.errors[0].includes('未写入'))
        assert.equal(store.list().length, 1, '内存必须回滚到落盘前')
        assert.deepEqual(readFileSync(path), before)
      }
    } finally {
      chmodSync(dir, 0o700)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ───────────────────── t3a / t3b：key 与 v2 ───────────────────── */

import { TARGET_FILE_VERSION as V2 } from '../src/targets.js'

const WECOM_KEY = '693a91f6-7c1e-4b1a-9f2d-0ec2sifa5aaa'

test('t3a：只填 key 的渠道，落盘同时带 key 与派生 url', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const saved = store.save({ name: '项目群-企微', channel: 'wecom', key: WECOM_KEY })
    assert.equal(saved.ok, true, JSON.stringify(saved.errors ?? ''))
    assert.equal(saved.target.key, WECOM_KEY)
    assert.equal(saved.target.url, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + WECOM_KEY)

    const onDisk = JSON.parse(readFileSync(path, 'utf8')).targets[0]
    assert.equal(onDisk.key, WECOM_KEY)
    assert.equal(onDisk.url, saved.target.url)
  })
})

test('t3b：文件版本为当前版本 v3', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    store.save({ name: '企微', channel: 'wecom', key: WECOM_KEY })
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, V2)
    assert.equal(V2, 3)
  })
})

test('t3b：key 不合法被拒且文件不变（空 / 含空格 / 误带前缀）', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    store.save({ name: '企微', channel: 'wecom', key: WECOM_KEY })
    const before = readFileSync(path)
    for (const badKey of ['', 'has space', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + WECOM_KEY]) {
      const verdict = store.save({ name: '坏的', channel: 'wecom', key: badKey })
      assert.equal(verdict.ok, false, `key=${JSON.stringify(badKey)} 应被拒`)
      assert.ok(verdict.errors.join('').length > 0)
    }
    assert.deepEqual(readFileSync(path), before)
    assert.equal(store.list().length, 1)
  })
})

test('t3a：填完整地址的渠道不受 key 逻辑影响（custom 仍要 url）', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const ok = store.save({ name: '自定义', channel: 'custom', url: 'https://example.com/hook' })
    assert.equal(ok.ok, true)
    assert.equal(ok.target.key, undefined)
    assert.equal(ok.target.url, 'https://example.com/hook')
  })
})

test('t3b：遗留记录（有 url 无 key）仍可保存（双读不倒退）', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const verdict = store.save({ name: '手改过的企微', channel: 'wecom', url: 'https://example.com/custom-hook' })
    assert.equal(verdict.ok, true, '反解不出 key 的地址应放行直投')
    assert.equal(verdict.target.key, undefined)
    assert.equal(verdict.target.url, 'https://example.com/custom-hook')
  })
})


/* ───────────────── 每目标文案覆盖（方案 C） ───────────────── */

test('v3：目标可带文案覆盖；缺省/ null 表示跟随全局', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    const plain = store.save({ name: '跟随全局', channel: 'wecom', key: WECOM_KEY })
    assert.equal(plain.target.payload, null, '缺省应是 null（跟随全局）')

    const own = store.save({
      name: '单独文案', channel: 'wecom', key: WECOM_KEY,
      payload: { fields: ['event', 'session'], promptChars: 30, workspaceStyle: 'full' },
    })
    assert.equal(own.ok, true, JSON.stringify(own.errors ?? ''))
    assert.deepEqual(own.target.payload.fields, ['event', 'session'])
    assert.equal(own.target.payload.promptChars, 30)
    assert.equal(own.target.payload.workspaceStyle, 'full')

    // 落盘后仍能读回
    const reloaded = new TargetStore({ path, logger: silent }).load()
    assert.equal(reloaded.get(own.target.id).payload.promptChars, 30)
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, V2)
  })
})

test('v3：非法文案覆盖被拒（不是对象 / 字段不是数组 / 长度非数字）', () => {
  withTemp(path => {
    const store = new TargetStore({ path, logger: silent })
    for (const bad of ['text', 42, { fields: 'event' }, { promptChars: -1 }, { timeFormat: 7 }]) {
      const verdict = store.save({ name: 'x', channel: 'wecom', key: WECOM_KEY, payload: bad })
      assert.equal(verdict.ok, false, `payload=${JSON.stringify(bad)} 应被拒`)
    }
    assert.equal(store.list().length, 0)
  })
})
