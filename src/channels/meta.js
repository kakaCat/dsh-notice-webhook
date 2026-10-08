/**
 * 渠道元数据：**每个渠道要用户填什么、填完拼成什么、去哪拿**——单点真相。
 *
 * 为什么要有这张表：本轮把 URL 组装从界面挪到 Host（用户只填 key），
 * 若界面与 Host 各写一份前缀与校验规则，早晚分叉。这里一处定义，两边都读：
 * - Host 侧：`composeUrl` / `validateKey` / 错误文案；
 * - 界面侧：经 RPC 的 `channelMeta` 投影拿 label / keyLabel / input / help，**前端不硬编码文案**。
 *
 * 契约见 docs/requirements/REQ-260930215459-d718/design/interfaces.md。
 */

/**
 * 六个渠道的元数据。
 *
 * - `input: 'key'` → 用户只填 key，URL 由 `urlPrefix + key` 拼出；
 * - `input: 'url'` → 用户填完整地址（Slack / Discord / 通用自定义）；
 * - `help.docUrl` → 官方文档地址；**通用自定义没有官方文档**，故为 `null`（步骤里讲我们自己的 v1 契约）。
 */
export const CHANNEL_META = {
  wecom: {
    label: '企业微信',
    input: 'key',
    keyLabel: '机器人 key',
    urlPrefix: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=',
    keyPattern: /^[A-Za-z0-9-]{8,64}$/,
    secret: false,
    help: {
      title: '怎么拿企微机器人 key',
      steps: [
        '在企业微信群里点右上角「…」→ 群机器人 → 添加机器人',
        '复制 Webhook 地址里 key= 之后的那串字符',
        '粘贴到「机器人 key」输入框并保存即可',
      ],
      docUrl: 'https://developer.work.weixin.qq.com/document/path/91770',
    },
  },

  dingtalk: {
    label: '钉钉',
    input: 'key',
    keyLabel: 'access_token',
    urlPrefix: 'https://oapi.dingtalk.com/robot/send?access_token=',
    keyPattern: /^[A-Za-z0-9]{16,80}$/,
    secret: true,
    help: {
      title: '怎么拿钉钉机器人 access_token',
      steps: [
        '在钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义',
        '安全设置勾「加签」，复制 Webhook 地址里 access_token= 之后的值',
        '把加签密钥（SEC 开头）配成一个环境变量，在本目标里填**环境变量名**（界面不回显密钥值）',
      ],
      docUrl: 'https://open.dingtalk.com/document/orgapp/custom-robot-access',
    },
  },

  feishu: {
    label: '飞书',
    input: 'key',
    keyLabel: 'hook token',
    urlPrefix: 'https://open.feishu.cn/open-apis/bot/v2/hook/',
    keyPattern: /^[A-Za-z0-9-]{8,80}$/,
    secret: true,
    help: {
      title: '怎么拿飞书机器人 token',
      steps: [
        '在飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人',
        '复制 Webhook 地址里 /hook/ 之后的那串 token',
        '若开了签名校验，把密钥配成环境变量，在本目标里填环境变量名',
      ],
      docUrl: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot',
    },
  },

  slack: {
    label: 'Slack',
    input: 'url',
    secret: false,
    help: {
      title: '怎么拿 Slack Incoming Webhook 地址',
      steps: [
        '在 Slack 应用目录里创建一个 Incoming Webhook',
        '选择要接收通知的频道',
        '复制整条 Webhook URL，粘贴到「地址」输入框',
      ],
      docUrl: 'https://api.slack.com/messaging/webhooks',
    },
  },

  discord: {
    label: 'Discord',
    input: 'url',
    secret: false,
    help: {
      title: '怎么拿 Discord Webhook 地址',
      steps: [
        '在目标频道的 频道设置 → 整合 → Webhook → 新建 Webhook',
        '给机器人起个名字（可选，仅影响显示）',
        '复制 Webhook URL，粘贴到「地址」输入框',
      ],
      docUrl: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
    },
  },

  custom: {
    label: '通用自定义',
    input: 'url',
    secret: false,
    help: {
      title: '通用自定义怎么用',
      steps: [
        '填入你自己的 http/https 接收地址',
        '服务端会收到 v1 契约 JSON：version / event / message / title / toolName / goal / sessionId / workspace / at / source',
        '需要鉴权时用「自定义请求头」（例如 Authorization）',
      ],
      // 通用渠道没有官方文档可指——步骤里已讲清我们的契约，故这里如实留空（界面会隐藏外链）
      docUrl: null,
    },
  },
}

/** 渠道 id 列表（顺序即界面展示顺序）。 */
export const META_CHANNELS = Object.keys(CHANNEL_META)

/** 取元数据；未注册返回 undefined（调用方自行降级）。 */
export function metaOf(channel) {
  return CHANNEL_META[channel]
}

/** 渠道显示名；未注册时回落渠道 id 本身（宁可显示得难看，也不要显示 undefined）。 */
export function labelOf(channel) {
  return CHANNEL_META[channel]?.label ?? String(channel ?? '')
}

/** 该渠道是否「只填 key」。 */
export function isKeyInput(channel) {
  return CHANNEL_META[channel]?.input === 'key'
}

/** 该渠道是否需要加签密钥。 */
export function needsSecret(channel) {
  return CHANNEL_META[channel]?.secret === true
}

/**
 * 校验用户的 key（Host 侧权威校验）。
 *
 * @returns `{ ok: true }` 或 `{ ok: false, error: string }`（错误文案按渠道定制，直接可显示）
 */
export function validateKey(channel, key) {
  const meta = CHANNEL_META[channel]
  if (meta === undefined) return { ok: false, error: `未注册的渠道：${String(channel)}` }
  if (meta.input !== 'key') return { ok: true } // 填整条 URL 的渠道不看 key

  if (typeof key !== 'string' || key.length === 0) return { ok: false, error: `${meta.keyLabel}不能为空` }
  if (/\s/.test(key)) return { ok: false, error: `${meta.keyLabel}不能包含空格或换行` }
  if (key.length > 200) return { ok: false, error: `${meta.keyLabel}过长（超过 200 字符）` }
  if (!meta.keyPattern.test(key)) return { ok: false, error: `${meta.keyLabel}格式不对，请检查是否整段复制（或误把 http:// 前缀也粘进来）` }
  return { ok: true }
}

/** 供界面渲染的元数据投影（不含 keyPattern 这种正则——它能被序列化但没有意义）。 */
export function channelMetaProjection() {
  const out = {}
  for (const [channel, meta] of Object.entries(CHANNEL_META)) {
    out[channel] = {
      label: meta.label,
      input: meta.input,
      ...(meta.keyLabel === undefined ? {} : { keyLabel: meta.keyLabel }),
      // 固定前缀要下发给界面：用户填 key，界面得把「插件会拼在 key 前面的那段」显示出来
      ...(meta.urlPrefix === undefined ? {} : { urlPrefix: meta.urlPrefix }),
      secret: meta.secret === true,
      help: meta.help,
    }
  }
  return out
}

/* ───────────────────────── URL 组装与反解（纯函数） ───────────────────────── */

/** key 在地址里的位置：query 参数名，或路径末段。 */
const KEY_SOURCE = {
  wecom: { kind: 'query', name: 'key' },
  dingtalk: { kind: 'query', name: 'access_token' },
  feishu: { kind: 'path' },
}

/**
 * 由目标记录拼出完整地址。
 *
 * - `input:'url'` 的渠道（Slack/Discord/通用）直接返回 `target.url`；
 * - `input:'key'` 的渠道返回 `urlPrefix + key`；
 * - **遗留记录**（老数据反解不出 key、只有整条 url）→ 原样返回 `target.url` 直投，
 *   否则会拼出只有前缀的坏地址（这是"反解不出也不能丢投递"那条规则的落点）。
 *
 * 纯函数：不读环境、不发网络、不抛异常。
 */
export function composeUrlFor(target) {
  const meta = CHANNEL_META[target?.channel]
  if (meta === undefined) return target?.url ?? ''
  if (meta.input !== 'key') return typeof target?.url === 'string' ? target.url : ''
  const key = typeof target?.key === 'string' ? target.key : ''
  if (key.length === 0) return typeof target?.url === 'string' ? target.url : ''
  return `${meta.urlPrefix}${key}`
}

/**
 * 从完整地址反解 key（迁移旧数据用）。
 *
 * 反解不出**返回 undefined**（不抛异常）——由调用方决定"保留原地址直投"，绝不猜。
 */
export function parseKeyFrom(channel, url) {
  if (typeof url !== 'string' || url.length === 0) return undefined
  const source = KEY_SOURCE[channel]
  if (source === undefined) return undefined

  try {
    if (source.kind === 'query') {
      const value = new URL(url).searchParams.get(source.name)
      return typeof value === 'string' && value.length > 0 ? value : undefined
    }
    // path 形式：飞书 /hook/<token>
    const match = /\/hook\/([^/?#]+)\/?$/.exec(url)
    if (match === null) return undefined
    const token = decodeURIComponent(match[1])
    return token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}

/** 该渠道的 key 能否从地址反解（决定迁移时是否尝试）。 */
export function canParseKey(channel) {
  return KEY_SOURCE[channel] !== undefined
}

