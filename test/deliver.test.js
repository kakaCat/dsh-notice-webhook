/**
 * 投递层单测（覆盖 TC-12 与 t4 验收）。
 *
 * 跑法：node --test test/deliver.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { deliver, endpointHost } from '../src/deliver.js'

/** 起一个可控接收端：handler(req, res, state) 决定响应；返回 { url, state, close } */
async function withReceiver(handler) {
  const state = { hits: [], redirectHits: 0 }
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    state.hits.push({ url: req.url, body: raw, headers: req.headers })
    await handler(req, res, raw, state)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('接收端返回 200 判定成功，且请求体含 version/event/message', async () => {
  const receiver = await withReceiver((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
  try {
    const result = await deliver(
      `${receiver.url}/hook`,
      { version: 1, event: 'turn/end', message: '会话已完成' },
      { logger: { warn() {} } },
    )
    assert.equal(result.ok, true)
    assert.equal(result.status, 200)
    assert.equal(result.attempts, 1)
    const sent = JSON.parse(receiver.state.hits[0].body)
    assert.equal(sent.version, 1)
    assert.equal(sent.event, 'turn/end')
    assert.equal(sent.message, '会话已完成')
    assert.equal(receiver.state.hits[0].headers['content-type'], 'application/json; charset=utf-8')
  } finally {
    await receiver.close()
  }
})

test('地址不可达时判定失败、不抛异常，且日志不含 URL 的 query', async () => {
  const logs = []
  const result = await deliver('http://127.0.0.1:1/hook?token=super-secret', { version: 1 }, {
    timeoutMs: 1000,
    logger: { warn: message => logs.push(String(message)) },
  })
  assert.equal(result.ok, false)
  assert.ok(logs.length >= 1, '失败时至少要留一条 warn')
  for (const line of logs) {
    assert.equal(line.includes('super-secret'), false, '日志不得出现 query 里的凭据')
    assert.equal(line.includes('?token='), false, '日志不得出现 query')
  }
  assert.ok(logs.some(line => line.includes('127.0.0.1:1')), '日志应留下 host 便于排查')
})

test('接收端返回 302 判定失败，且不跟随重定向', async () => {
  const receiver = await withReceiver((req, res, raw, state) => {
    if (req.url === '/elsewhere') {
      state.redirectHits += 1
      res.writeHead(200)
      res.end('followed')
      return
    }
    res.writeHead(302, { Location: '/elsewhere' })
    res.end()
  })
  try {
    const result = await deliver(`${receiver.url}/hook`, { version: 1 }, { logger: { warn() {} } })
    assert.equal(result.ok, false)
    assert.equal(result.status, 302)
    assert.equal(receiver.state.redirectHits, 0, '不得跟随重定向')
  } finally {
    await receiver.close()
  }
})

test('5xx 按 retry 重试；4xx 不重试', async () => {
  let serverErrors = 0
  const receiver = await withReceiver((req, res, raw, state) => {
    if (req.url === '/flaky') {
      serverErrors += 1
      if (serverErrors < 3) {
        res.writeHead(500)
        res.end('boom')
        return
      }
      res.writeHead(200)
      res.end('ok')
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  try {
    const retried = await deliver(`${receiver.url}/flaky`, { version: 1 }, { retry: 2, logger: { warn() {} } })
    assert.equal(retried.ok, true)
    assert.equal(retried.attempts, 3)

    const before = receiver.state.hits.length
    const notRetried = await deliver(`${receiver.url}/missing`, { version: 1 }, { retry: 3, logger: { warn() {} } })
    assert.equal(notRetried.ok, false)
    assert.equal(notRetried.status, 404)
    assert.equal(notRetried.attempts, 1)
    assert.equal(receiver.state.hits.length, before + 1, '4xx 只允许发一次')
  } finally {
    await receiver.close()
  }
})

test('自定义 headers 原样带上（鉴权用）', async () => {
  const receiver = await withReceiver((req, res) => {
    res.writeHead(204)
    res.end()
  })
  try {
    const result = await deliver(`${receiver.url}/hook`, { version: 1 }, {
      headers: { Authorization: 'Bearer abc' },
      logger: { warn() {} },
    })
    assert.equal(result.ok, true)
    assert.equal(receiver.state.hits[0].headers.authorization, 'Bearer abc')
  } finally {
    await receiver.close()
  }
})

test('endpointHost 只保留 host', () => {
  assert.equal(endpointHost('https://example.com/hook?token=x'), 'example.com')
  assert.equal(endpointHost('http://127.0.0.1:8899/a/b'), '127.0.0.1:8899')
  assert.equal(endpointHost('not a url'), '(无效地址)')
})
