/**
 * 客户端半（真实产物）的验收测试（t10 / t14）。
 *
 * 跑法：node --test test/client-service.test.js
 *
 * 做法：用假的 window.__ModuleLoader__ / require('react') / ctx 把**真实的 client.js**
 * 求值一遍，然后断言插槽注册、客户端服务契约与选择器的返回值。
 * 不测副本——产物改了测试就会跟着挂，这是刻意的。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_SOURCE = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 极简 React 假件：只够跑 createElement 与几个钩子。 */
function fakeReact() {
  // 与真 React 对齐：只有一个子元素时 props.children 是**单个元素**（不是数组）
  const createElement = (type, props, ...children) => {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { $$element: true, type, props: merged, children }
  }
  return {
    createElement,
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    Fragment: 'Fragment',
  }
}

/** 装载真实产物：返回 { id, api }。 */
function loadClient(options = {}) {
  let captured = null
  const windowLike = {
    __ModuleLoader__: { load: entry => { captured = entry } },
    confirm: options.confirm ?? (() => true),
  }
  const React = options.react ?? fakeReact()
  const requireShim = name => {
    if (name === 'react') return React
    throw new Error(`client.js 只允许 require('react')，实际 require 了 ${name}`)
  }

  // eslint-disable-next-line no-new-func
  new Function('window', 'fetch', 'AbortSignal', CLIENT_SOURCE)(windowLike, options.fetch ?? (async () => ({ ok: true, status: 200, json: async () => ({}) })), { timeout: () => ({}) })

  assert.ok(captured !== null, 'client.js 必须调用 window.__ModuleLoader__.load')
  return { id: captured.id, api: captured.factory(requireShim) }
}

/** 假 ctx：记录插槽注册、provided 服务与 effect 清理。 */
function fakeCtx() {
  const registrations = []
  const provided = new Map()
  const cleanups = []
  return {
    registrations,
    provided,
    cleanups,
    ctx: {
      slots: {
        inject(slot, callback) { registrations.push({ slot, entry: callback() }) },
        register(options, component) { return { options, component } },
      },
      provide(key, value) {
        provided.set(key, value)
        return () => provided.delete(key)
      },
      effect(callback) {
        const dispose = callback()
        if (typeof dispose === 'function') cleanups.push(dispose)
        return dispose
      },
    },
  }
}

test('client.js 用包名装载，工厂返回 { inject, apply }', () => {
  const { id, api } = loadClient()
  assert.equal(id, 'dsh-notice-webhook')
  assert.deepEqual(api.inject, ['slots'])
  assert.equal(typeof api.apply, 'function')
})

test('apply 注册 settings.section：id 固定、order 21（排在 agent-presets 20 之后）', () => {
  const { api } = loadClient()
  const fake = fakeCtx()
  api.apply(fake.ctx)

  assert.equal(fake.registrations.length, 1)
  const { slot, entry } = fake.registrations[0]
  assert.equal(slot, 'settings.section')
  assert.equal(entry.options.name, 'settings.section')
  assert.equal(entry.options.id, 'dsh-notice-webhook')
  assert.equal(entry.options.order, 21)
  assert.equal(typeof entry.options.label, 'function', 'label 必须是 thunk（槽位契约）')
  assert.equal(entry.options.label(), '通知推送')
  assert.equal(typeof entry.component, 'function', '必须是函数组件，不能直接是元素')
})

test('apply 提供客户端服务 dshNoticeWebhookClient v1', () => {
  const { api } = loadClient()
  const fake = fakeCtx()
  api.apply(fake.ctx)

  const service = fake.provided.get('dshNoticeWebhookClient')
  assert.ok(service !== undefined, '必须 provide 客户端服务')
  assert.equal(service.version, 1)
  assert.equal(typeof service.renderTargetPicker, 'function')
})

test('renderTargetPicker 返回非空 React 元素（宿主拿来就能渲染）', () => {
  const { api } = loadClient()
  const fake = fakeCtx()
  api.apply(fake.ctx)
  const service = fake.provided.get('dshNoticeWebhookClient')

  const element = service.renderTargetPicker({
    sessionId: 'session-x',
    selected: ['t-1'],
    onConfirm: () => {},
  })
  assert.notEqual(element, null)
  assert.equal(element.$$element, true, '必须是 React 元素')
  assert.equal(typeof element.type, 'function', '元素类型是组件')
  // 宿主传的选项被原样透传给组件
  assert.equal(element.props.sessionId, 'session-x')
  assert.deepEqual(element.props.selected, ['t-1'])
  assert.equal(typeof element.props.onConfirm, 'function')
})

test('renderTargetPicker 无参调用不抛异常；readOnly 也能渲染', () => {
  const { api } = loadClient()
  const fake = fakeCtx()
  api.apply(fake.ctx)
  const service = fake.provided.get('dshNoticeWebhookClient')

  assert.notEqual(service.renderTargetPicker(), null)
  const readOnly = service.renderTargetPicker({ readOnly: true })
  assert.equal(readOnly.props.readOnly, true)
})

test('插件被卸载后服务失效：renderTargetPicker 返回 null（宿主回落自己的界面）', () => {
  const { api } = loadClient()
  const fake = fakeCtx()
  api.apply(fake.ctx)
  const service = fake.provided.get('dshNoticeWebhookClient')
  assert.notEqual(service.renderTargetPicker({}), null)

  for (const cleanup of fake.cleanups) cleanup()
  assert.equal(fake.provided.has('dshNoticeWebhookClient'), false, '卸载后服务应被回收')
  assert.equal(service.renderTargetPicker({}), null, '失效的服务必须返回 null 而不是抛异常')
})

test('client.js 只依赖 react，且是自包含的自执行装载（无 import/export）', () => {
  assert.equal(/^\s*(import|export)\s/m.test(CLIENT_SOURCE), false, 'loader 只加载单文件，不能有 ESM 语句')
  assert.match(CLIENT_SOURCE, /window\.__ModuleLoader__\.load\(/)
  const requires = [...CLIENT_SOURCE.matchAll(/require\((['"])([^'"]+)\1\)/g)].map(m => m[2])
  assert.deepEqual([...new Set(requires)], ['react'], '除 react 外不得 require 别的模块')
})

test('fetch 失败时选择器组件内部有兜底（不把异常抛给宿主）', () => {
  // 组件内部用 useEffect + catch 落到 error 文案；这里验证工厂在 fetch 会 reject 的情况下仍能返回元素
  const { api } = loadClient({ fetch: async () => { throw new Error('network down') } })
  const fake = fakeCtx()
  api.apply(fake.ctx)
  const service = fake.provided.get('dshNoticeWebhookClient')
  const element = service.renderTargetPicker({ sessionId: 's' })
  assert.notEqual(element, null)
})

/* ── t7：品牌图标（取自 dsh-im） ── */

test('t7：五个渠道的品牌 glyph 逐字取自 dsh-im，通用渠道用自有中性图标', () => {
  for (const glyph of ['WecomLogoGlyph', 'FeishuLogoGlyph', 'DingtalkLogoGlyph', 'SlackLogoGlyph', 'DiscordLogoGlyph']) {
    assert.ok(CLIENT_SOURCE.includes(`function ${glyph}(`), `缺 ${glyph}`)
  }
  assert.ok(CLIENT_SOURCE.includes('const BRAND_GLYPH'), '缺品牌路由表')
  assert.ok(CLIENT_SOURCE.includes('CUSTOM_GLYPH_PATH'), '通用渠道应有自有图标')
  // 署名：每个 glyph 的注释要能追到来源
  assert.ok((CLIENT_SOURCE.match(/取自 dsh-im/g) ?? []).length >= 5, '每个品牌图标都要标来源')
})

test('t7：图标不依赖远程资源（无 img / 无远程 svg 地址）', () => {
  assert.equal(/<img|https?:\/\/\S+\.svg/.test(CLIENT_SOURCE), false)
})

/* ── t8 / t9a / t9b / t10 / t11：原型对齐的结构断言 ── */

test('t8：rail 是三段结构（全部目标 / 按渠道 / 默认组 + 不在默认组）', () => {
  for (const marker of ['全部目标', '按渠道', '+ 新增目标', '默认组 · 未绑定目标的会话发这里', '不在默认组']) {
    assert.ok(CLIENT_SOURCE.includes(marker), `rail 缺「${marker}」`)
  }
  // 徽标：默认 / 绑定 / 停
  for (const badge of ["badge('默认'", "badge('绑定'", "badge('停'"]) {
    assert.ok(CLIENT_SOURCE.includes(badge), `缺徽标 ${badge}`)
  }
})

test('t9a：content-head 与 card-head 齐备（面包屑 / id / 启用）', () => {
  for (const marker of ['设置 › 通知推送', 'id: ', "'启用'", "'删除目标'"]) {
    assert.ok(CLIENT_SOURCE.includes(marker), `缺 ${marker}`)
  }
  // 用户 2026-09-30 要求删除这两个按钮（连带只读的「全局参数」面板）
  for (const gone of ['全局设置', '打开配置文件', '全局参数']) {
    assert.ok(!CLIENT_SOURCE.includes(gone), `「${gone}」应已删除`)
  }
})

test('t9b：只填 key 的字段区 + 加签 chip + 谁在用', () => {
  assert.ok(CLIENT_SOURCE.includes("channelMeta?.input === 'key'"), '表单应按渠道元数据切换 key/url')
  assert.ok(CLIENT_SOURCE.includes("'已配置'"), '加签应显示「已配置」chip')
  assert.ok(CLIENT_SOURCE.includes('urlPrefix'), '应显示渠道固定地址前缀（由 Host 下发）')
  assert.ok(CLIENT_SOURCE.includes('谁在用'), '缺「谁在用」')
  assert.ok(CLIENT_SOURCE.includes('（绑定）'), '谁在用的会话 chip 文案')
})

test('t9b：新建目标事件默认全选，且地址是「固定前缀 + key」两段', () => {
  assert.ok(CLIENT_SOURCE.includes('events: EVENT_IDS.slice()'), '新建目标应默认全选事件')
  assert.ok(CLIENT_SOURCE.includes('const EVENT_IDS = EVENTS.map'), '缺事件 id 清单')
  assert.ok(CLIENT_SOURCE.includes('完整地址：'), '应把拼好的完整地址挂到悬停提示上')
  assert.ok(CLIENT_SOURCE.includes('默认全选；取消勾选'), '事件区提示应说明默认全选')
})

test('t9b：保存前做必填校验，错误进弹框；测试有即时反馈', () => {
  assert.ok(CLIENT_SOURCE.includes('还差必填项：'), '缺必填校验提示')
  assert.ok(CLIENT_SOURCE.includes('const [testing, setTesting]'), '缺测试中的状态')
  assert.ok(CLIENT_SOURCE.includes("testing === true ? '测试中…' : '发送测试'"), '测试按钮应有测试中态')
  assert.ok(CLIENT_SOURCE.includes('正在发送测试通知'), '测试中应有进度提示')
  assert.ok(CLIENT_SOURCE.includes('还没保存：先点「保存」再发送测试'), '未保存就该地提示')
  assert.ok(CLIENT_SOURCE.includes('saved.target'), '保存后应落回真实 id（否则测试按钮像没反应）')
})

test('t9b：中间栏不再重复一张目标清单（左栏 rail 已列全）', () => {
  assert.ok(!CLIENT_SOURCE.includes('function TargetList('), '目标清单组件应已删除')
  assert.ok(!CLIENT_SOURCE.includes('从左侧选一个目标查看详情'), '旧空占位文案也不应回来')
})

test('t9b：编辑目标是弹框（Esc/点遮罩可关）', () => {
  assert.ok(CLIENT_SOURCE.includes('function Modal('), '缺弹框组件')
  assert.ok(CLIENT_SOURCE.includes("'aria-modal': 'true'"), '弹框应可访问')
  assert.ok(CLIENT_SOURCE.includes("event.key === 'Escape'"), 'Esc 应能关弹框')
  assert.ok(CLIENT_SOURCE.includes('h(Modal, {'), '编辑目标应在弹框里')
})

test('t9b：Host 未加载新版时明确提示（不让人猜为什么没有固定地址）', () => {
  assert.ok(CLIENT_SOURCE.includes('当前 Host 未加载新版插件'), '缺降级提示')
  assert.ok(CLIENT_SOURCE.includes('请重启 Host 后刷新本页'), '提示应给可执行动作')
})

test('t9b：事件网格顺序对齐原型（完成 → 提问 → 授权 → 目标终态）', () => {
  const order = ["{ id: 'turn/end'", "{ id: 'ask_user_question'", "{ id: 'approval/asked'", "{ id: 'goal/*'"]
  const positions = order.map(m => CLIENT_SOURCE.indexOf(m))
  for (const pos of positions) assert.ok(pos > 0, '事件项缺失')
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i - 1] < positions[i], `事件顺序不对：${order[i - 1]} 应在 ${order[i]} 之前`)
  }
})

test('t10：说明浮层就地展开、可关、带官方链接、help 缺失不渲染', () => {
  assert.ok(CLIENT_SOURCE.includes('function HelpPopover'), '缺 HelpPopover')
  assert.ok(CLIENT_SOURCE.includes("'aria-expanded'"), '应可访问（aria-expanded）')
  assert.ok(CLIENT_SOURCE.includes("e.key === 'Escape'"), 'Esc 应能关')
  assert.ok(CLIENT_SOURCE.includes('去官网配置页拿 key ↗'), '应给官网配置页链接')
  assert.ok(CLIENT_SOURCE.includes('if (help === undefined || help === null) return null'), 'help 缺失应不渲染入口')
  assert.ok(!/window\.open\s*\(/.test(CLIENT_SOURCE), '不得自己开新窗口')
})

test('t11：绑定页 chips 用同一套品牌图标', () => {
  const binding = CLIENT_SOURCE.slice(CLIENT_SOURCE.indexOf('function BindingTable'))
  assert.ok(binding.includes('h(ChannelIcon'), '绑定页目标 chip 应带渠道图标')
})
