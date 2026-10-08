/**
 * Rules of Hooks 的静态守卫。
 *
 * 跑法：node --test test/client-hooks.test.js
 *
 * 为什么需要它：2026-09-30 我把 `const toggleEnabled = useCallback(...)` 写在
 * `if (loading) return ...` **之后**，于是首次渲染（loading=true）少调用一个 hook、
 * 数据到位后多调用一个 → 真 React 抛 "Rendered more hooks than during the previous render"
 * → 整个设置面板白板。
 *
 * 单测抓不到它：假 React 不做 hook 顺序校验，而 Section 在 loading 时提前返回、
 * 根本走不到卡片。所以这里做一次**静态**检查：
 * **同一个组件函数体内，顶层提前 return 之后不允许再出现 hook 调用**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_SOURCE = readFileSync(join(here, '..', 'client.js'), 'utf8')

const HOOK_RE = /\buse(State|Effect|Callback|Memo|Ref|Reducer|Context|LayoutEffect)\s*\(/

/** 找出「组件函数体内、顶层提前 return 之后仍调用 hook」的位置。 */
function findHookAfterEarlyReturn(source) {
  const lines = source.split('\n')
  const violations = []
  let component = null
  let depth = 0
  let sawEarlyReturn = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    // 组件声明：4 空格缩进的 function Xxx( （大写开头视为组件）
    const declares = /^    function ([A-Z]\w*)\s*\(/.exec(line)
    if (declares !== null && depth === 0) {
      component = declares[1]
      depth = 1
      sawEarlyReturn = false
      continue
    }
    if (component === null) continue
    // 组件体结束：4 空格缩进的右花括号
    if (/^    \}/.test(line)) { component = null; depth = 0; continue }

    const topLevel = /^      /.test(line) && !/^       /.test(line)
    if (!topLevel) continue

    if (/^      return\b/.test(line) || /^      if\s*\(.*\)\s*return\b/.test(line)) {
      sawEarlyReturn = true
      continue
    }
    if (sawEarlyReturn && HOOK_RE.test(line)) {
      violations.push({ component, line: i + 1, code: line.trim().slice(0, 80) })
    }
  }
  return violations
}

test('client.js：组件里不允许「提前 return 之后才调用 hook」', () => {
  const violations = findHookAfterEarlyReturn(CLIENT_SOURCE)
  assert.deepEqual(
    violations, [],
    violations.map(v => `${v.component} 第 ${v.line} 行在提前 return 之后调用 hook：${v.code}`).join('\n'),
  )
})

test('守卫本身有效：合成样例必须被抓出来（防止守卫空转）', () => {
  const sample = [
    '    function Demo() {',
    '      const [a] = useState(1)',
    '      if (a) return null',
    '      const cb = useCallback(() => 1, [a])',
    '      return null',
    '    }',
  ].join('\n')
  const found = findHookAfterEarlyReturn(sample)
  assert.equal(found.length, 1, '合成样例应被抓出 1 处违规')
  assert.equal(found[0].component, 'Demo')
  assert.equal(found[0].line, 4)
})
