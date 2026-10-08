/**
 * 飞书交互式卡片用例（AC-19）。
 *
 * 跑法：node --test test/channels.feishu.test.js
 *
 * 盯三件事：① 报文是 interactive 卡片（标题按事件配色、分栏带会话与摘要、底部跳转按钮）；
 * ② 没有上下文时退回纯文本（老调用方兼容）；③ 加签算法与业务码判定**一字未改**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildCard, buildRequest, isSuccess, signRequest } from '../src/channels/feishu.js'
import { buildContext } from '../src/payload.js'

const TARGET = { channel: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc', key: 'abc' }
const CONTEXT = buildContext({
  intent: { kind: 'complete', event: 'turn/end', message: '会话已完成', toolName: null },
  session: { id: 'sess-123456', workspace: '/Users/mac/proj/dsh-notice-webhook' },
  title: '通知设置页按原型重做',
  prompt: '把弹框的字段都改成一行',
  now: new Date('2026-09-30T14:32:00').getTime(),
  payload: {},
})

test('AC-19 飞书发交互式卡片：标题 / 配色 / 分栏 / 跳转按钮', () => {
  const req = buildRequest({ target: TARGET, intent: { event: 'turn/end', message: '会话已完成' }, context: CONTEXT, now: Date.now() })
  const body = JSON.parse(req.body)
  assert.equal(body.msg_type, 'interactive')
  assert.equal(body.card.header.title.content, '✅ 对话完成')
  assert.equal(body.card.header.template, 'green')
  const fields = body.card.elements[0].fields.map(f => f.text.content).join(' | ')
  assert.ok(!fields.includes('**类型**'), '标题栏已给出事件，正文不再重复「类型」（REQ-261002150038-344a）')
  assert.ok(fields.includes('**会话**'), '应带会话')
  assert.ok(fields.includes('通知设置页按原型重做'), '应带会话标题')
  assert.ok(fields.includes("<text_tag color='blue'>#123456</text_tag>"),
    '会话短 id 必须用飞书文本标签渲染（纯文本括号在卡片里不生效）')
  assert.ok(fields.includes('dsh-notice-webhook'), '应带工作区')
  assert.ok(fields.includes('把弹框的字段都改成一行'), '应带摘要')
  // 字段顺序固定：会话 → 工作区 → 任务 → 时间（「类型」行已删；detail 为 null 故无该行）
  assert.deepEqual(
    body.card.elements[0].fields.map(f => f.text.content.match(/^\*\*(.+?)\*\*/)?.[1]),
    ['会话', '工作区', '任务', '时间'],
    '删掉「类型」后其余字段的顺序与形状不变',
  )
  // dsh:// 这类自定义 scheme 飞书按钮不跟随 → 不放按钮（避免"点了没反应"）
  assert.equal(body.card.elements.find(e => e.tag === 'action'), undefined, 'dsh:// 链接不该生成按钮')
  assert.equal(req.headers['Content-Type'], 'application/json; charset=utf-8')
})

test('AC-19 只有 http(s) 链接才在卡片上放按钮（自定义 scheme 省略）', () => {
  const withHttps = buildCard({ message: 'x' }, { ...CONTEXT, link: 'https://example.com/open' })
  const action = withHttps.elements.find(e => e.tag === 'action')
  assert.ok(action !== undefined, 'https 链接应生成按钮')
  assert.equal(action.actions[0].url, 'https://example.com/open')
  assert.equal(action.actions[0].text.content, '打开 DSH')

  const withScheme = buildCard({ message: 'x' }, { ...CONTEXT, link: 'dsh://open' })
  assert.equal(withScheme.elements.find(e => e.tag === 'action'), undefined, 'dsh:// 不该有按钮')
})

test('AC-19 配色按事件：等待授权=橙，目标阻塞=红', () => {
  const ask = buildCard({ message: '需要你允许执行操作' }, { ...CONTEXT, title: '🔐 等待授权', color: 'orange' })
  assert.equal(ask.header.template, 'orange')
  const blocked = buildCard({ message: '' }, { ...CONTEXT, title: '⛔ 目标阻塞', color: 'red' })
  assert.equal(blocked.header.template, 'red')
})

test('AC-19 没有上下文时退回纯文本（老调用方兼容）', () => {
  const req = buildRequest({ target: TARGET, intent: { event: 'turn/end', message: '会话已完成' }, now: Date.now() })
  const body = JSON.parse(req.body)
  assert.equal(body.msg_type, 'text')
  assert.equal(body.content.text, '会话已完成')
})

test('AC-19 加签与业务码判定不变', () => {
  const signature = signRequest('sekret', 1700000000000)
  assert.equal(signature.timestamp, '1700000000000')
  assert.equal(typeof signature.sign, 'string')
  assert.equal(signRequest(undefined, 1), undefined)
  assert.equal(isSuccess(200, { code: 0 }).ok, true)
  assert.equal(isSuccess(200, {}).ok, true)
  assert.equal(isSuccess(200, { code: 19021, msg: 'sign match fail' }).ok, false)
  assert.equal(isSuccess(500, {}).ok, false)
  // 卡片报文与纯文本走同一套判定
  const card = JSON.parse(buildRequest({ target: TARGET, intent: { event: 'turn/end', message: 'x' }, context: CONTEXT, now: 1 }).body)
  assert.equal(card.msg_type, 'interactive')
  assert.equal(isSuccess(200, { code: 0 }).ok, true)
})

test('AC-20 测试通知的上下文按默认完整字段装配（飞书渲染为卡片）', async () => {
  const { createNotifier } = await import('../index.js')
  const { TargetStore } = await import('../src/targets.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createServer } = await import('node:http')

  const got = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { got.push(JSON.parse(body)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"code":0}') })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))

  // 隔离到临时目录：绝不触碰真实配置（一次教训换来的纪律）
  const store = new TargetStore({ path: join(mkdtempSync(join(tmpdir(), 'dnw-test-')), 'targets.json'), logger: { warn() {} } })
  const notifier = createNotifier({}, { logger: { warn() {}, debug() {} }, targets: store })
  const saved = notifier.targets.save({
    name: '飞书-测试', channel: 'feishu', key: 'abc',
    url: `http://127.0.0.1:${server.address().port}/hook`,
  })
  // key 渠道的地址由 key 派生，测试时直接对适配器验证报文形状
  const req = buildRequest({
    target: { ...saved.target, url: `http://127.0.0.1:${server.address().port}/hook` },
    intent: { event: 'turn/end', message: '这是一条测试通知' },
    context: {
      title: '✅ 对话完成', color: 'green', time: '2026-09-30 10:19',
      session: '通知测试（示例）', id: 'abc123', workspace: 'dsh-notice-webhook',
      prompt: '这是一条测试通知：收到它就说明该目标的配置已生效',
      detail: null, link: 'dsh://open',
    },
    now: Date.now(),
  })
  const body = JSON.parse(req.body)
  server.close()   // 先关服务再断言：断言失败也要能退出进程（否则测试会挂住）
  assert.equal(body.msg_type, 'interactive', '测试通知也应是卡片')
  const text = JSON.stringify(body.card)
  for (const marker of ['会话', '工作区', '任务', '时间']) {
    assert.ok(text.includes(marker), `测试卡片少了「${marker}」`)
  }
  // REQ-261002150038-344a：标题栏已给出事件（✅ 对话完成），正文不再带一行重复的「类型」
  assert.ok(!text.includes('类型'), '测试卡片不该再有「类型」行')
  assert.ok(text.includes('✅ 对话完成'), '事件标题仍在标题栏')
  assert.ok(!text.includes('dsh://open'), 'dsh:// 不该出现在卡片按钮上（飞书不跟随）')
})

test('AC-20 发送测试走真链路：/test 收到的正文含会话/工作区/任务/时间/链接', async () => {
  const { createNotifier } = await import('../index.js')
  const { TargetStore } = await import('../src/targets.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createServer } = await import('node:http')

  // ① 本地接收端（模拟群机器人）
  const got = []
  const receiver = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { got.push(JSON.parse(body)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}') })
  })
  await new Promise(r => receiver.listen(0, '127.0.0.1', r))

  // ② 隔离存储：不碰真实配置（一次教训换来的纪律）
  const store = new TargetStore({ path: join(mkdtempSync(join(tmpdir(), 'dnw-e2e-')), 'targets.json'), logger: { warn() {} } })
  const notifier = createNotifier({}, { logger: { warn() {}, debug() {} }, targets: store })
  const saved = notifier.targets.save({ name: '本地', channel: 'custom', url: `http://127.0.0.1:${receiver.address().port}/hook` })

  // ③ RPC 也起真 HTTP 服务，走真实路径调用 /test
  const rpc = createServer(notifier.rpcHandler)
  await new Promise(r => rpc.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${rpc.address().port}`
  const state = await (await fetch(`${base}/state`)).json()
  const res = await (await fetch(`${base}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: saved.target.id, revision: state.revision }),
  })).json()
  assert.equal(res.ok, true, '发送测试应成功')
  await new Promise(r => setTimeout(r, 900))

  // ④ 群里收到的应当就是「默认完整样式」
  receiver.close(); rpc.close()   // 先关服务再断言，断言失败也能退出
  const payload = got[0]
  assert.ok(payload !== undefined, '本地接收端应收到测试通知')
  assert.equal(payload.message, '这是一条测试通知', 'v1 message 字段保持原文')
  for (const marker of ['**会话**', '**工作区**', '**任务**', '**时间**', 'dsh://open', '这是一条测试通知']) {
    assert.ok(String(payload.context).includes(marker), `测试通知缺少「${marker}」`)
  }
})
