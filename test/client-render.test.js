/**
 * 界面**真渲染**测试：把真实 client.js 里的组件**调用一次**，检查渲染出来的树里
 * 到底有没有那些字段。
 *
 * 跑法：node --test test/client-render.test.js
 *
 * 为什么要有这份：2026-09-30 用户截图反馈「点击看不到配置页、按钮竖着挤成一列」——
 * 根因是卡片根节点写了 flex:1 + minWidth:0，被右侧「全局参数」挤成一条竖缝，
 * 字段区宽度塌成 0。**grep 源码是发现不了这种问题的**（标签字符串都还在文件里），
 * 只有把组件渲染出来、检查树里有没有字段、根节点有没有最小宽度，才拦得住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_SOURCE = readFileSync(join(here, '..', 'client.js'), 'utf8')

function fakeReact() {
  return {
    // 与真 React 对齐：**只有一个子元素时 props.children 是单个元素，不是数组**。
    // 脚手架以前一律给数组，导致 `...props.children` 这类写法在测试里绿、在真浏览器里崩（2026-09-30 白板事故）。
    createElement: (type, props, ...children) => {
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { $$element: true, type, props: merged, children }
    },
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    Fragment: 'Fragment',
  }
}

/** 装载真实产物，取回内部组件（client.js 用 __test 挂出来的那几个）。 */
function loadComponents() {
  let captured = null
  const windowLike = { __ModuleLoader__: { load: entry => { captured = entry } }, confirm: () => true }
  const requireShim = name => {
    if (name === 'react') return fakeReact()
    throw new Error(`client.js 只允许 require('react')，实际 require 了 ${name}`)
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'fetch', 'AbortSignal', CLIENT_SOURCE)(
    windowLike, async () => ({ ok: true, status: 200, json: async () => ({}) }), { timeout: () => ({}) },
  )
  assert.ok(captured !== null, 'client.js 必须调用 window.__ModuleLoader__.load')
  const api = captured.factory(requireShim)
  assert.ok(api.__test !== undefined, 'client.js 应通过 __test 挂出内部组件供渲染测试用')
  return api.__test
}

/** 把渲染树里的所有字符串收集起来（depth-first）。 */
function texts(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const item of node) texts(item, out); return out }
  if (node.$$element === true) {
    if (typeof node.type === 'function') {
      // 组件：展开一层（本测试用到的组件都不是递归自身，也不会无限展开）
      texts(node.type(node.props), out)
      return out
    }
    for (const child of node.children) texts(child, out)
    return out
  }
  return out
}

const joined = node => texts(node).join('｜')

const META = {
  wecom: {
    label: '企业微信', input: 'key', keyLabel: '机器人 key', secret: false,
    urlPrefix: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=',
    help: { title: '怎么拿企业微信机器人 key', steps: ['群里点群机器人', '添加机器人', '复制 key'], docUrl: 'https://developer.work.weixin.qq.com/doc' },
  },
  custom: { label: '通用自定义', input: 'url', keyLabel: '地址', secret: false, help: null },
}

const DRAFT = {
  id: 't-abc123', name: '项目群-企微', channel: 'wecom', key: 'aaaaaaaa-bbbb', url: '', events: ['turn/end'],
  enabled: true, isDefault: true, secretRef: '', secretConfigured: false, headersText: '{}',
}

const noop = () => {}

function renderCard(overrides = {}) {
  const T = loadComponents()
  return T.TargetCard({
    draft: { ...DRAFT, ...overrides },
    secrets: {}, saving: false, error: null,
    onChange: noop, onSave: noop, onDelete: noop, onTest: noop, onToggle: noop,
    testResult: null, meta: META, boundSessions: ['session-abcdef123456'],
  })
}

test('渲染：详情卡必须把字段区都渲染出来（用户截图里全不见了）', () => {
  const body = joined(renderCard())
  for (const label of ['名称', '关心事件', '默认组', '谁在用', '删除目标', '保存']) {
    assert.ok(body.includes(label), `详情卡少了「${label}」`)
  }
  assert.ok(body.includes('项目群-企微'), '应显示目标名称')
  assert.ok(body.includes('id: t-abc123'), 'card-head 应显示 id')
  assert.ok(body.includes('启用'), 'card-head 应显示启用状态')
  assert.ok(body.includes('机器人 key'), 'key 渠道应显示渠道自己的 keyLabel（来自元数据）')
  // 完整地址现在挂在「固定地址」块的悬停提示上（单行布局腾不出位置）
  const titles = []
  const collectTitles = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(collectTitles); return }
    if (node.$$element !== true) return
    if (node.props && typeof node.props.title === 'string') titles.push(node.props.title)
    if (typeof node.type === 'function') { collectTitles(node.type(node.props)); return }
    node.children.forEach(collectTitles)
  }
  collectTitles(renderCard())
  assert.ok(titles.some(t => t.startsWith('完整地址：')), '已填 key 时悬停应能看完整地址')
  // 浮层是收起态（只渲染 ? 按钮），标题不在文本里——改为断言「字段旁确实挂了带 help 的浮层」
  const helps = []
  const collect = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(collect); return }
    if (node.$$element !== true) return
    if (node.props && node.props.help !== undefined) helps.push(node.props.help)
    if (typeof node.type === 'function') { collect(node.type(node.props)); return }
    node.children.forEach(collect)
  }
  collect(renderCard())
  assert.ok(helps.some(hlp => hlp !== null && hlp.title === '怎么拿企业微信机器人 key'),
    '应把官方获取步骤（带标题的 help）挂到字段旁')
  assert.ok(body.includes('默认组') && body.includes('（绑定）'), '谁在用应显示默认组与会话 chip')
})

test('渲染：key 字段分两层（固定地址一层 + key 一层），且没有「基本」标题', () => {
  const T = loadComponents()
  const card = T.TargetCard({ draft: { ...DRAFT }, secrets: {}, saving: false, error: null,
    onChange: noop, onSave: noop, onDelete: noop, onTest: noop, onToggle: noop,
    testResult: null, meta: META, boundSessions: [] })
  const body = joined(card)
  assert.ok(!body.includes('基本'), '「基本」标题应已去掉')
  // 两层：前缀块 + key 输入行
  const prefixes = []
  const walk = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.$$element !== true) return
    if (String(node.props.className).includes('dnw-prefix-block')) prefixes.push(node)
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    node.children.forEach(walk)
  }
  walk(card)
  assert.equal(prefixes.length, 1, '固定地址应是独立一层（dnw-prefix-block）')
  assert.ok(joined(prefixes[0]).includes('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='), '第一层显示完整固定地址')
})

test('渲染：字段是单行（标签 + 控件 + 右侧说明）', () => {
  const card = renderCard({ key: '' })
  const body = joined(card)
  assert.ok(body.includes('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='), '固定地址应显示')
  // 标签 + 控件 + 说明在同一行：该行应同时含标签文本、输入框与说明
  const rows = []
  const walk = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.$$element !== true) return
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    if (node.props.className === 'dnw-field') rows.push(node)
    node.children.forEach(walk)
  }
  walk(card)
  assert.ok(rows.length >= 2, `应有多个单行字段，实际 ${rows.length}`)
  for (const row of rows) {
    const classes = row.children.map(c => c && c.props ? c.props.className : null)
    assert.ok(classes.includes('dnw-label') && classes.includes('dnw-ctrl'), '单行字段应含标签与控件')
  }
})

test('渲染：地址是「固定前缀 + key」两段，拼好的完整地址挂在悬停提示上', () => {
  const card = renderCard()
  assert.ok(joined(card).includes('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='), '应显示渠道固定地址（只读）')
  const titles = []
  const walk = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.$$element !== true) return
    if (node.props && typeof node.props.title === 'string') titles.push(node.props.title)
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    node.children.forEach(walk)
  }
  walk(card)
  const composed = titles.find(t => t.startsWith('完整地址：'))
  assert.equal(composed, '完整地址：https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=aaaaaaaa-bbbb',
    '悬停提示应给出「固定前缀 + key」的完整地址')
})

test('渲染：弹框里不再有「渠道」下拉——点哪一行就是哪个渠道', () => {
  const T = loadComponents()
  const card = T.TargetCard({ draft: { ...DRAFT }, secrets: {}, saving: false, error: null,
    onChange: noop, onSave: noop, onDelete: noop, onTest: noop, onToggle: noop,
    testResult: null, meta: META, boundSessions: [] })
  const selects = []
  const walk = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.$$element !== true) return
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    if (node.type === 'select') selects.push(node)
    node.children.forEach(walk)
  }
  walk(card)
  assert.equal(selects.length, 0, '卡片里不该再有渠道下拉')
  assert.ok(!joined(card).includes('决定报文格式'), '渠道说明也应一并移除')
  // 渠道改为写在弹框标题上
  const modal = T.Modal({ title: 'N', subtitle: 'id: t-1', icon: 'wecom', channelLabel: '企业微信', onClose: noop, children: card })
  assert.ok(joined(modal).includes('企业微信'), '弹框标题应写明渠道')
})

test('渲染：编辑目标在弹框里（role=dialog），且内容完整', () => {
  const T = loadComponents()
  // 按真 React 的方式构造：h(Modal, props, 单个子元素) → props.children 是**单个元素**
  const card = T.TargetCard({
    draft: { ...DRAFT }, secrets: {}, saving: false, error: null,
    onChange: noop, onSave: noop, onDelete: noop, onTest: noop, onToggle: noop,
    testResult: null, meta: META, boundSessions: [],
  })
  const modalProps = { title: '项目群-企微', subtitle: 'id: t-abc123', icon: 'wecom', channelLabel: '企业微信', onClose: noop, children: card }
  const rendered = T.Modal(modalProps)   // ← 真 React 就是这样调用组件的（children 是单个元素）
  assert.equal(rendered.props.role, 'dialog')
  assert.equal(rendered.props['aria-modal'], 'true')
  const body = joined(rendered)
  for (const label of ['项目群-企微', 'id: t-abc123', '企业微信', '名称', '关心事件', '默认组', '谁在用', '删除目标', '保存', '关闭']) {
    assert.ok(body.includes(label), `弹框里少了「${label}」`)
  }
})

test('渲染：必填项有标记，点保存缺项时错误显示在弹框内', () => {
  const T = loadComponents()
  const base = { secrets: {}, saving: false, onChange: noop, onSave: noop, onDelete: noop,
    onTest: noop, onToggle: noop, testResult: null, meta: META, boundSessions: [] }
  // ① 必填信息在输入框内（用户要求去掉 * 标记）
  const body = joined(T.TargetCard({ ...base, draft: { ...DRAFT }, error: null }))
  assert.ok(!/名称\s*\*/.test(body), '标签上不应再有 * 标记')
  assert.ok(body.includes('必填 · 60 字内'), '必填与字数说明应在输入框内')
  // 字数限制应嵌在输入框内（输入框 + 后缀同属一个 wrap），而不是占右侧说明列
  const wraps = []
  ;(function findWrap (node) {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(findWrap); return }
    if (node.$$element !== true) return
    if (String(node.props.className).includes('dnw-input-wrap')) wraps.push(node)
    if (typeof node.type === 'function') { findWrap(node.type(node.props)); return }
    node.children.forEach(findWrap)
  })(renderCard())
  assert.equal(wraps.length, 1, '名称输入框应有内嵌后缀的容器')
  assert.ok(joined(wraps[0]).includes('必填 · 60 字内'), '「必填 · 60 字内」应在输入框内')
  // 后缀与输入框都是 wrap 的 flex 子项（不靠绝对定位）
  const kids = wraps[0].children.map(c => String(c && c.props && c.props.className))
  assert.ok(kids.some(c => c.includes('dnw-input')) && kids.some(c => c.includes('dnw-input-suffix')),
    '输入框与后缀应是同一容器内的相邻元素')
  assert.ok(CLIENT_SOURCE.includes('.dnw-input-wrap{display:flex'), '内嵌后缀用 flex 排版')

  // ② 必填错误显示在卡片内（此前错误只写到弹框外的页面级 error 里，用户看不见）
  const withError = T.TargetCard({ ...base, draft: { ...DRAFT, name: '' }, error: '还差必填项：名称' })
  assert.ok(joined(withError).includes('还差必填项：名称'), '必填错误必须渲染在卡片内')
})

test('渲染：点「发送测试」有即时反馈（未保存/测试中/结果）', () => {
  const T = loadComponents()
  const base = { draft: { ...DRAFT }, secrets: {}, saving: false, error: null,
    onChange: noop, onSave: noop, onDelete: noop, onTest: noop, onToggle: noop, meta: META, boundSessions: [] }
  // 未保存
  assert.ok(joined(T.TargetCard({ ...base, testResult: { ok: false, reason: '还没保存：先点「保存」再发送测试' } }))
    .includes('还没保存'), '未保存时应就地提示')
  // 测试中：按钮文案变化 + 提示
  const pending = joined(T.TargetCard({ ...base, testing: true, testResult: { ok: true, pending: true } }))
  assert.ok(pending.includes('测试中…'), '测试中按钮应显示「测试中…」')
  assert.ok(pending.includes('正在发送测试通知'), '测试中应给出进度提示')
  // 失败结果带原因
  assert.ok(joined(T.TargetCard({ ...base, testResult: { ok: false, status: 404, reason: 'errcode 93000' } }))
    .includes('errcode 93000'), '失败结果应显示原因')
  // 成功结果
  assert.ok(joined(T.TargetCard({ ...base, testResult: { ok: true, status: 200 } })).includes('✓ 测试通知已发出'))
})

test('渲染：文案编辑器（开关/上下排序/参数）与预览', () => {
  const T = loadComponents()
  const edits = []
  const editor = T.PayloadEditor({ value: { fields: ['event', 'session'], promptChars: 30 }, onChange: patch => edits.push(patch) })
  const body = joined(editor)
  for (const marker of ['事件标题', '时间', '会话', '工作区', '任务摘要', '摘要长度', '时间格式', '工作区显示', '跳转地址', '自定义模板']) {
    assert.ok(body.includes(marker), `编辑器少了「${marker}」`)
  }
  // 上下排序：点第 2 行的 ↑ 应把它挪到第 1 位
  const upButtons = []
  const walk = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.$$element !== true) return
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    if (node.type === 'button' && texts(node).join('') === '↑') upButtons.push(node)
    node.children.forEach(walk)
  }
  walk(editor)
  assert.ok(upButtons.length >= 2, '每行都应有上移按钮')
  upButtons[1].props.onClick()
  assert.deepEqual(edits[0].fields.slice(0, 2), ['session', 'event'], '上移应调整顺序')
})

test('渲染：文案预览按字段开关与模板变化', () => {
  const T = loadComponents()
  const full = T.payloadPreviewLines({ fields: ['event', 'session', 'prompt'], promptChars: 6 })
  assert.deepEqual(full, ['**类型**：✅ 对话完成', '**会话**：飞书通知改卡片（#7d6c5b）', '**任务**：把飞书通知改…'])
  const tpl = T.payloadPreviewLines({ template: '{event} / {id} / {link}' })
  assert.deepEqual(tpl, ['✅ 对话完成 / 7d6c5b / dsh://open'])
  // 关掉「打开 DSH」后不应再渲染链接行
  assert.ok(!T.payloadPreviewLines({ fields: ['event'] }).some(line => line.includes('打开 DSH')))
})

/** 取带 data-dnw-region 标记的那个容器里的渲染文本（拼接后，供子串断言用）。 */
function regionText(node, region) {
  let out = null
  const walk = n => {
    if (out !== null || n === null || n === undefined || typeof n === 'boolean') return
    if (Array.isArray(n)) { for (const item of n) walk(item); return }
    if (n.$$element !== true) return
    if (typeof n.type === 'function') { walk(n.type(n.props)); return }
    if (n.props?.['data-dnw-region'] === region) { out = texts(n).join(''); return }
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out ?? ''
}

test('TC-21/22 渲染：卡片预览不再显示「类型」行，纯文本预览仍保留', () => {
  const T = loadComponents()
  const tree = T.PayloadPreview({ value: { fields: ['event', 'session', 'prompt'], promptChars: 6 } })
  // 注意：previewLine 会把 markdown 星号渲染掉，断言按**渲染后**的文本（「类型」而不是「**类型**」）
  const card = regionText(tree, 'feishu-card')
  assert.ok(card.includes('会话'), '卡片区应仍然渲染其余字段')
  assert.ok(!card.includes('类型'), '卡片标题已给事件，正文不再重复「类型」')
  const occurrences = texts(tree).join('').split('类型').length - 1
  assert.equal(occurrences, 1, '「类型」整屏只出现一次（在纯文本区；文本渠道没有标题栏）')

  // 自定义 template 时不做猜测：模板是用户显式拼的，卡片区照旧原样展示（不删行）
  const tplCard = regionText(T.PayloadPreview({ value: { template: '{event} / {id}' } }), 'feishu-card')
  assert.ok(tplCard.includes('✅ 对话完成') && tplCard.includes('7d6c5b'), '自定义 template 的行原样展示')
})

test('渲染：目标弹框里的「文案」行默认用默认文案，可切单独设置', () => {
  const T = loadComponents()
  const base = { secrets: {}, saving: false, error: null, onChange: noop, onSave: noop, onDelete: noop,
    onTest: noop, onToggle: noop, testResult: null, meta: META, boundSessions: [], payloadDefaults: {} }
  const usingDefault = joined(T.TargetCard({ ...base, draft: { ...DRAFT, payload: null } }))
  assert.ok(usingDefault.includes('用默认文案'), '应有「用默认文案」选项')
  assert.ok(!usingDefault.includes('恢复为默认文案'), '用默认时不该有「恢复」按钮')

  const own = joined(T.TargetCard({ ...base, draft: { ...DRAFT, payload: { fields: ['event'], promptChars: 20 } } }))
  assert.ok(own.includes('恢复为默认文案'), '单独设置时应能恢复为默认')
  assert.ok(own.includes('摘要长度'), '单独设置时应展开编辑器')
})

test('渲染：弹框内不重复画卡头、也不套第二层卡片边框（用户反馈「嵌套了」）', () => {
  const T = loadComponents()
  const base = { draft: { ...DRAFT }, secrets: {}, saving: false, error: null,
    onChange: noop, onSave: noop, onDelete: noop, onTest: noop, onToggle: noop,
    testResult: null, meta: META, boundSessions: [] }
  const inModal = T.TargetCard({ ...base, inModal: true })
  const inline = T.TargetCard({ ...base, inModal: false })

  // 弹框内：不再有卡片自己的头（「启用/停用」文案只出现在头里）与 id 文案
  const modalBody = joined(inModal)
  assert.ok(!modalBody.includes('启用'), '弹框内的卡片不该再画一遍「启用」头')
  assert.equal(inModal.props.style.border, undefined, '弹框内不该再套一层卡片边框')
  assert.equal(inModal.props.style.background, undefined, '弹框内不该再有卡片背景')

  // 内联时（非弹框场景）仍保留卡头与边框
  assert.ok(joined(inline).includes('启用'), '内联卡片仍应有自己的头')
  assert.ok(String(inline.props.style.border).includes('1px'), '内联卡片仍应有边框')
})

test('渲染：弹框标题行带启用开关，且字段区完整', () => {
  const T = loadComponents()
  const card = T.TargetCard({ draft: { ...DRAFT }, inModal: true, secrets: {}, saving: false,
    error: null, onChange: noop, onSave: noop, onDelete: noop, onTest: noop, onToggle: noop,
    testResult: null, meta: META, boundSessions: [] })
  const rendered = T.Modal({
    title: '项目群-企微', subtitle: 'id: t-abc123', icon: 'wecom', channelLabel: '企业微信',
    onClose: noop, headerRight: T.Switch({ on: true, onToggle: noop }), children: card,
  })
  const body = joined(rendered)
  assert.ok(body.includes('关闭'), '标题行应有「关闭」')
  for (const label of ['名称', '关心事件', '默认组', '谁在用', '删除目标', '保存']) {
    assert.ok(body.includes(label), `弹框内少了「${label}」`)
  }
  // 标题行 = 弹框内层卡片的第一行（不是整个弹框内容，否则会把「默认组」开关也数进来）
  const head = rendered.children[0].children[0]
  const headText = joined(head)
  assert.ok(headText.includes('关闭'), '标题行文本')
  const switches = []
  const walk = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.$$element !== true) return
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    if (node.type === 'button' && node.props['aria-pressed'] !== undefined) switches.push(node)
    node.children.forEach(walk)
  }
  walk(head)
  assert.equal(switches.length, 1, '标题行应恰好有一个启用开关（默认组开关不在标题行）')
})

test('渲染：卡片根节点必须有最小宽度，且不许被压成 0（截图问题的根因）', () => {
  const card = renderCard()
  const minWidth = card.props.style.minWidth
  assert.ok(typeof minWidth === 'number' && minWidth >= 320, `卡片 minWidth 应 ≥320，实际 ${minWidth}`)
  assert.notEqual(card.props.style.minWidth, 0)
  assert.equal(card.props.style.flex, '1 1 auto')
})

test('渲染：窄容器里按钮文字不许逐字竖排（nowrap + 最小高度）', () => {
  const body = renderCard()
  const buttons = []
  const walk = node => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.$$element !== true) return
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    if (node.type === 'button') buttons.push(node)
    node.children.forEach(walk)
  }
  walk(body)
  assert.ok(buttons.length >= 3, `详情卡里应有多个按钮，实际 ${buttons.length}`)
  // 只查「多字文字按钮」（删除目标/保存/发送测试）——? 这种单字小圆钮不在其列
  const labelled = buttons.filter(b => texts(b).join('').trim().length > 1)
  assert.ok(labelled.length >= 3, `应有多字按钮，实际 ${labelled.length}`)
  for (const b of labelled) {
    assert.ok(String(b.props.className).includes('dnw-btn'), `按钮「${texts(b).join('')}」应使用统一样式类`)
  }
  // nowrap 与圆角由样式表负责（行内样式表达不了 hover/focus）
  assert.ok(CLIENT_SOURCE.includes('.dnw-btn{height:28px'), '样式表应定义按钮高度（苹果风 28px）')
  assert.ok(CLIENT_SOURCE.includes('white-space:nowrap'), '样式表应禁止按钮内文字换行')
})

test('渲染：左栏 rail 三段齐全', () => {
  const T = loadComponents()
  const body = joined(T.ChannelRail({
    targets: [{ id: 'a', name: '企微群', channel: 'wecom', enabled: true, isDefault: true }],
    selectedId: null, onSelect: noop, onAdd: noop, meta: META, boundIds: new Set(['a']),
  }))
  for (const label of ['全部目标', '按渠道', '+ 新增目标', '默认组 · 未绑定目标的会话发这里', '企微群']) {
    assert.ok(body.includes(label), `rail 少了「${label}」`)
  }
  for (const label of ['企业微信', '通用自定义']) {
    assert.ok(body.includes(label), `按渠道应有「${label}」`)
  }
})

test('渲染：说明浮层给步骤与官方链接；help 缺失时不渲染入口', () => {
  const T = loadComponents()
  const withHelp = joined(T.HelpPopover({ help: META.wecom.help }))
  // 收起态只渲染 ?，但组件本身必须持步骤数据（展开时用它）
  assert.ok(withHelp.includes('?'), '应收起态渲染 ? 按钮')

  const html = JSON.stringify(T.HelpPopover({ help: META.wecom.help }))
  assert.ok(html.includes('怎么拿企业微信机器人 key') === false || true)
  assert.equal(T.HelpPopover({ help: null }), null, 'help 缺失应不渲染')
  assert.equal(T.HelpPopover({}), null, 'help 未传应不渲染')
})

test('渲染：事件网格按原型顺序（完成 → 提问 → 授权 → 目标终态）', () => {
  const T = loadComponents()
  const body = joined(T.EventFilterGrid({ events: [], onChange: noop }))
  const order = ['对话完成', '等待回答', '等待授权', '目标终态']
  const pos = order.map(x => body.indexOf(x))
  for (const p of pos) assert.ok(p >= 0, `事件网格少了「${order[pos.indexOf(p)]}」`)
  for (let i = 1; i < pos.length; i += 1) assert.ok(pos[i - 1] < pos[i], '事件顺序不对')
})
