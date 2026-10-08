/**
 * dsh-notice-webhook —— 浏览器半（手写，无打包步骤）。
 *
 * 装载契约：window.__ModuleLoader__.load({ id, factory(require) { ... return { inject, apply } } })
 * 插槽契约：ctx.slots.register({ name:'settings.section', id, order, label, inject }, Component)
 * 数据通道：同源 fetch 到本插件在 Host 上注册的 RPC 前缀（与看板 /dashboard/api/* 同一信任域）。
 *
 * 本文件是**自包含**的：loader 只加载这一个文件，所以不能 import 别的模块，
 * 选择器与客户端服务都内联在这里（测试用 fake window/require 直接跑真实产物）。
 *
 * 设计见 docs/requirements/REQ-260930155231-0862/design/frontend.md
 */
window.__ModuleLoader__.load({
  id: 'dsh-notice-webhook',

  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const RPC = '/api/dsh-notice-webhook'

    /** 客户端服务契约（host/其他插件经 ctx.get 取用）。 */
    const CLIENT_SERVICE_KEY = 'dshNoticeWebhookClient'
    const CLIENT_SERVICE_VERSION = 1

    /** 渠道清单（顺序即左侧导航顺序）。 */
    const CHANNELS = [
      { id: 'wecom', label: '企业微信' },
      { id: 'feishu', label: '飞书' },
      { id: 'dingtalk', label: '钉钉' },
      { id: 'slack', label: 'Slack' },
      { id: 'discord', label: 'Discord' },
      { id: 'custom', label: '通用自定义' },
    ]

    /** 关心事件（`eventsMode: 'all'` = 全收，见保存逻辑）。 */
    // 顺序对齐原型帧 1：对话完成 → 会话中断 → 等待回答 → 等待授权 → 目标终态
    const EVENTS = [
      { id: 'turn/end', label: '对话完成', field: 'turn/end' },
      { id: 'turn/error', label: '会话中断', field: 'turn/error' },
      { id: 'ask_user_question', label: '等待回答', field: 'ask_user_question' },
      { id: 'approval/asked', label: '等待授权', field: 'approval/asked' },
      { id: 'goal/*', label: '目标终态', field: 'goal/*（完成/阻塞/轮次耗尽）' },
    ]

    /** 新建目标时**默认全选**（用户要求）：勾满即等价于「接收全部事件」，但显示上不再容易误解为空。 */
    const EVENT_IDS = EVENTS.map(event => event.id)

    /**
     * 品牌图标：**逐字取自 dsh-im** 的 plugin-src/client/channel-logos.js（未改形状与颜色）。
     * 为什么抄而不是引：本插件是手写单文件客户端半，只能 require('react')——
     * 引第三方包会破坏 loader 契约；引远程图片会带来离线与 CSP 问题。
     */
    /** 通用自定义的中性图标路径（自有，非 dsh-im）。 */
    const CUSTOM_GLYPH_PATH = 'M4 5h16v3H4V5Zm0 5.5h16v3H4v-3ZM4 16h10v3H4v-3Z'

    function dimensions(size) {
      return size === undefined ? {} : { width: size, height: size }
    }

function WecomLogoGlyph({ size } = {}) {
  return h('svg', {
    ...dimensions(size),
    viewBox: '0 0 24 24',
    focusable: 'false',
    'aria-hidden': 'true',
    'data-im-channel-logo': 'wecom',
  },
  h('path', {
    fill: 'none',
    stroke: '#3370FF',
    strokeWidth: '2.35',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    d: 'M17.7 14.5c1.05-1.12 1.65-2.52 1.65-4.03 0-3.82-3.58-6.92-8-6.92s-8 3.1-8 6.92 3.58 6.92 8 6.92c1.17 0 2.28-.22 3.28-.62',
  }),
  h('path', { fill: '#07C160', d: 'M16.1 15.15c.7-.7 1.83-.7 2.53 0s.7 1.83 0 2.53-1.83.7-2.53 0-.7-1.83 0-2.53Z' }),
  h('path', { fill: '#FFB800', d: 'M19.25 13.45a1.36 1.36 0 1 1 1.92 1.92 1.36 1.36 0 0 1-1.92-1.92Z' }),
  h('path', { fill: '#FF7A00', d: 'M19.55 18.05a1.16 1.16 0 1 1 1.64 1.64 1.16 1.16 0 0 1-1.64-1.64Z' }),
  h('path', { fill: '#3370FF', d: 'M15.25 18.75a.92.92 0 1 1 1.3 1.3.92.92 0 0 1-1.3-1.3Z' }));
}

function FeishuLogoGlyph({ size } = {}) {
  return h('svg', {
    ...dimensions(size),
    viewBox: '0 0 24 24',
    focusable: 'false',
    'aria-hidden': 'true',
    'data-im-channel-logo': 'feishu',
  },
  h('path', { fill: '#00D6B9', d: 'M7.2 4.5h7.6c1.2 0 2.1.55 2.7 1.58 1.05 1.8 1.55 3.45 1.58 4.95-2.04-.62-4.2-.15-6.22 1.45C11.3 9.7 9.42 7.04 7.2 4.5Z' }),
  h('path', { fill: '#1456B8', d: 'M10.8 13.55c3.3-2.93 5.72-4.24 9.47-2.52-1.2 1.45-2.27 4.18-3.86 5.43-1.67 1.31-3.9.5-5.61-.64v-2.27Z' }),
  h('path', { fill: '#3370FF', d: 'M4.4 8.35c3.47 3.61 7.25 6.1 10.33 5.7 1.06-.14 2.2-.72 3.4-1.72-1.04 2.65-2.6 4.8-5.06 6-2.46 1.2-5.56.52-7.42-.72A2.76 2.76 0 0 1 4.4 15.3V8.35Z' }));
}

function DingtalkLogoGlyph({ size } = {}) {
  return h('svg', {
    ...dimensions(size),
    viewBox: '0 0 48 48',
    focusable: 'false',
    'aria-hidden': 'true',
    'data-im-channel-logo': 'dingtalk',
  }, h('path', {
    fill: 'currentColor',
    d: 'M37.05 22.783c-6.758-5.216-14.378-12.128-22.73-19.538-.655-.585-1.242-.354-1.536.42-1.88 4.973-.058 9.386 2.889 11.932s7.368 4.912 10.058 6.155c.105.049.013.203-.093.163-4.953-2.182-8.397-3.765-13.07-7.368-.497-.388-1.01-.242-1.07.521-.384 4.748 2.657 8.483 6.058 9.745 2.1.781 4.398 1.212 6.53 1.474.109.015.084.178-.027.178-2.747.01-6.058-.654-8.935-1.751-.606-.233-.818.25-.722.633.491 2.008 2.974 5.076 6.926 5.73a12 12 0 0 0 2.228.115c.164 0 .208.089.154.217q-2.685 4.6-2.803 4.797c-.091.152-.036.275.156.275h3.543c.164 0 .264.106.18.246l-4.958 8.196c-.191.328.035.565.395.301s15.212-11.133 15.636-11.448c.195-.142.148-.327-.124-.327h-3.18c-.206 0-.252-.14-.111-.28.14-.141 3.602-3.594 4.837-4.888 1.283-1.35 1.938-3.825-.231-5.498',
  }));
}

function SlackLogoGlyph({ size } = {}) {
  return h('svg', {
    ...dimensions(size),
    viewBox: '0 0 100 100',
    focusable: 'false',
    'aria-hidden': 'true',
    'data-im-channel-logo': 'slack',
  },
  h('path', {
    fill: '#36C5F0',
    d: 'M36.5 0A10.5 10.5 0 0 0 36.5 21H47V10.5A10.5 10.5 0 0 0 36.5 0ZM10.5 26a10.5 10.5 0 0 0 0 21h26a10.5 10.5 0 0 0 0-21Z',
  }),
  h('path', {
    fill: '#2EB67D',
    d: 'M100 36.5A10.5 10.5 0 0 0 79 36.5V47h10.5A10.5 10.5 0 0 0 100 36.5ZM74 10.5a10.5 10.5 0 0 0-21 0v26a10.5 10.5 0 0 0 21 0Z',
  }),
  h('path', {
    fill: '#ECB22E',
    d: 'M63.5 100a10.5 10.5 0 0 0 0-21H53v10.5A10.5 10.5 0 0 0 63.5 100ZM89.5 74a10.5 10.5 0 0 0 0-21h-26a10.5 10.5 0 0 0 0 21Z',
  }),
  h('path', {
    fill: '#E01E5A',
    d: 'M0 63.5a10.5 10.5 0 0 0 21 0V53H10.5A10.5 10.5 0 0 0 0 63.5ZM26 89.5a10.5 10.5 0 0 0 21 0v-26a10.5 10.5 0 0 0-21 0Z',
  }));
}

function DiscordLogoGlyph({ size } = {}) {
  return h('svg', {
    ...dimensions(size),
    viewBox: '0 0 24 24',
    focusable: 'false',
    'aria-hidden': 'true',
    'data-im-channel-logo': 'discord',
  }, h('path', {
    fill: 'currentColor',
    d: 'M20.32 4.37a19.8 19.8 0 0 0-4.89-1.51c-.21.38-.46.89-.63 1.29a18.4 18.4 0 0 0-5.59 0 13 13 0 0 0-.64-1.29c-1.71.29-3.36.8-4.89 1.52C.59 9.09-.25 13.68.17 18.2a19.9 19.9 0 0 0 6 3.04c.48-.66.91-1.36 1.28-2.1-.7-.26-1.37-.58-2-.96.17-.12.33-.25.49-.38 3.86 1.79 8.04 1.79 11.86 0 .16.13.32.26.49.38-.64.38-1.31.7-2.01.97.37.73.8 1.44 1.28 2.09a19.8 19.8 0 0 0 6-3.04c.49-5.24-.84-9.79-3.24-13.83ZM8.02 15.42c-1.16 0-2.11-1.07-2.11-2.38s.93-2.38 2.11-2.38c1.18 0 2.13 1.08 2.11 2.38 0 1.31-.93 2.38-2.11 2.38Zm7.95 0c-1.16 0-2.11-1.07-2.11-2.38s.93-2.38 2.11-2.38c1.18 0 2.13 1.08 2.11 2.38 0 1.31-.93 2.38-2.11 2.38Z',
  }));
}

    /** 品牌 glyph 路由表（channel → dsh-im glyph）。 */
    const BRAND_GLYPH = {
      wecom: WecomLogoGlyph,      // 取自 dsh-im WecomLogoGlyph
      feishu: FeishuLogoGlyph,    // 取自 dsh-im FeishuLogoGlyph
      dingtalk: DingtalkLogoGlyph,// 取自 dsh-im DingtalkLogoGlyph
      slack: SlackLogoGlyph,      // 取自 dsh-im SlackLogoGlyph
      discord: DiscordLogoGlyph,  // 取自 dsh-im DiscordLogoGlyph
    }

    /**
     * 渠道图标：有品牌 glyph 用它，通用自定义用自有中性图标（dsh-im 无对应项）。
     * 来源说明见上一段注释；调用方只需给 channel 与 size。
     */
    function ChannelIcon({ channel, size = 18 }) {
      const Glyph = BRAND_GLYPH[channel]
      if (Glyph !== undefined) return h(Glyph, { size })
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        style: { display: 'block', flex: '0 0 auto' },
      }, h('path', { d: CUSTOM_GLYPH_PATH, fill: 'currentColor' }))
    }

    // ─────────────────────────── 传输 ───────────────────────────

    /** 调一次 RPC。返回 `{ status, data }`；网络层失败抛异常（调用方行内展示）。 */
    async function call(path, body) {
      const init = body === undefined
        ? {}
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      const response = await fetch(RPC + path, init)
      let data = {}
      try { data = await response.json() } catch { data = {} }
      return { status: response.status, data }
    }

    // ─────────────────────────── 小部件 ───────────────────────────

    const MUTED = { color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12 }
    /**
     * 按钮统一样式：原先直接用浏览器默认 button，观感与 DSH 其它设置页差太远，
     * 且窄容器里中文会被逐字竖排。这里按语义给三份样式，并强制 nowrap。
     */
    // 按钮外观由样式表（.dnw-btn 系列）负责：行内样式做不了 hover/active/focus/disabled
    const btnStyle = kind => ({
      padding: kind === 'primary' ? '6px 18px' : '6px 12px',
      minHeight: 30,
      borderRadius: 6,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      fontSize: 13,
      fontWeight: kind === 'primary' ? 600 : 400,
      border: '1px solid ' + (kind === 'primary'
        ? 'var(--dsh-accent, #247bbf)'
        : (kind === 'danger' ? 'var(--dsh-danger, #b91c1c)' : 'var(--dsh-border, #d1d5db)')),
      background: kind === 'primary' ? 'var(--dsh-accent, #247bbf)' : 'transparent',
      color: kind === 'primary' ? '#fff'
        : (kind === 'danger' ? 'var(--dsh-danger, #b91c1c)' : 'inherit'),
    })
    const btnClass = kind => kind === 'primary' ? 'dnw-btn dnw-btn-primary'
      : (kind === 'danger' ? 'dnw-btn dnw-btn-danger' : 'dnw-btn')


    /**
     * 样式表：行内样式表达不了 :hover/:focus/滚动条，且 DSH 的主题变量对插件不公开，
     * 所以这里用**自适应中性色**（半透明黑/白、继承 currentColor）保证在浅色与深色主题下都成立，
     * 只在与品牌有关的地方用带兜底的主题变量。
     */
    const STYLE_ID = 'dsh-notice-webhook-style'
    const STYLES = `
      /* ── 苹果风（macOS/iOS 设计语言）─────────────────────────────
         系统字体 + 半透明材质 + 背景虚化 + 大圆角 + 柔和长阴影 + 发丝描边 + iOS 开关。
         颜色**不依赖媒体查询**：中性色用 Canvas/CanvasText 按用色方案自动解析，
         强调色用 light-dark()，因此无论浅色/深色（含 App 自己的主题切换）都成立。 */
      .dnw-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:1000;display:flex;justify-content:center;
        align-items:flex-start;padding:52px 16px;overflow:auto;background:color-mix(in srgb,CanvasText 32%,transparent);
        backdrop-filter:blur(3px) saturate(120%);-webkit-backdrop-filter:blur(3px) saturate(120%);
        font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","PingFang SC",sans-serif}
      .dnw-modal{width:min(720px,100%);max-height:82vh;display:flex;flex-direction:column;overflow:hidden;
        border-radius:16px;border:0.5px solid color-mix(in srgb,CanvasText 18%,transparent);
        background:color-mix(in srgb,Canvas 88%,transparent);color:inherit;
        backdrop-filter:saturate(180%) blur(24px);-webkit-backdrop-filter:saturate(180%) blur(24px);
        box-shadow:0 24px 70px color-mix(in srgb,CanvasText 30%,transparent),0 2px 10px color-mix(in srgb,CanvasText 10%,transparent)}
      .dnw-modal-head{display:flex;align-items:center;gap:10px;padding:14px 16px;flex:0 0 auto;
        border-bottom:0.5px solid color-mix(in srgb,CanvasText 14%,transparent)}
      .dnw-modal-title{font-size:15px;font-weight:600;letter-spacing:-.01em;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;max-width:320px}
      .dnw-modal-body{padding:16px 16px 6px;overflow:auto;flex:1 1 auto}
      .dnw-field{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
      .dnw-label{flex:0 0 118px;width:118px;text-align:right;font-size:13px;line-height:30px;opacity:.62;
        overflow-wrap:break-word}
      .dnw-ctrl{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px}
      .dnw-hint{flex:0 1 auto;max-width:180px;font-size:12px;line-height:30px;opacity:.45;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .dnw-input{width:100%;height:30px;padding:0 10px;font-family:inherit;font-size:13px;color:inherit;
        border-radius:6px;border:0.5px solid color-mix(in srgb,CanvasText 22%,transparent);
        background:color-mix(in srgb,Canvas 96%,CanvasText 4%);outline:none;
        transition:border-color .15s,box-shadow .15s}
      .dnw-input::placeholder{color:currentColor;opacity:.35}
      /* 输入框 + 内嵌后缀：整块用 flex 排版（不靠绝对定位，动画/变换下也不会跑位） */
      .dnw-input-wrap{display:flex;align-items:center;flex:1 1 auto;min-width:0;height:30px;border-radius:6px;
        border:0.5px solid color-mix(in srgb,CanvasText 22%,transparent);
        background:color-mix(in srgb,Canvas 96%,CanvasText 4%);transition:border-color .15s,box-shadow .15s}
      .dnw-input-wrap:hover{border-color:color-mix(in srgb,CanvasText 34%,transparent)}
      .dnw-input-wrap:focus-within{border-color:light-dark(#0071e3,#0a84ff);
        box-shadow:0 0 0 3.5px light-dark(rgba(0,113,227,.28),rgba(10,132,255,.34))}
      .dnw-input-wrap .dnw-input{height:28px;border:none;background:transparent;box-shadow:none;flex:1 1 auto}
      .dnw-input-wrap .dnw-input:focus{box-shadow:none}
      .dnw-input-suffix{padding:0 11px 0 4px;font-size:12px;opacity:.38;white-space:nowrap;pointer-events:none}
      .dnw-input:hover{border-color:color-mix(in srgb,CanvasText 34%,transparent)}
      .dnw-input:focus{border-color:light-dark(#0071e3,#0a84ff);
        box-shadow:0 0 0 3.5px light-dark(rgba(0,113,227,.28),rgba(10,132,255,.34))}
      textarea.dnw-input{height:auto;padding:8px 10px;line-height:1.5;
        font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .dnw-btn{height:28px;padding:0 13px;font-family:inherit;font-size:13px;cursor:pointer;color:inherit;
        white-space:nowrap;border-radius:6px;border:0.5px solid color-mix(in srgb,CanvasText 20%,transparent);
        background:linear-gradient(180deg,color-mix(in srgb,Canvas 100%,CanvasText 0%),
          color-mix(in srgb,Canvas 92%,CanvasText 8%));
        box-shadow:0 0.5px 1.5px color-mix(in srgb,CanvasText 12%,transparent);
        transition:filter .12s,transform .05s}
      .dnw-btn:hover{filter:brightness(.97)}
      .dnw-btn:active{transform:translateY(0.5px);filter:brightness(.93)}
      .dnw-btn:disabled{opacity:.45;cursor:default}
      .dnw-btn:focus-visible{outline:none;
        box-shadow:0 0 0 3.5px light-dark(rgba(0,113,227,.35),rgba(10,132,255,.4))}
      .dnw-btn-primary{border-color:transparent;color:#fff;font-weight:500;
        background:linear-gradient(180deg,light-dark(#0a84ff,#3d9bff),light-dark(#0071e3,#0a84ff));
        box-shadow:0 1px 2.5px color-mix(in srgb,light-dark(#0071e3,#0a84ff) 45%,transparent)}
      .dnw-btn-primary:hover{filter:brightness(1.06)}
      .dnw-btn-danger{color:light-dark(#ff3b30,#ff6b61);
        border-color:color-mix(in srgb,light-dark(#ff3b30,#ff6b61) 35%,transparent);
        background:color-mix(in srgb,light-dark(#ff3b30,#ff6b61) 6%,transparent)}
      .dnw-btn-danger:hover{background:color-mix(in srgb,light-dark(#ff3b30,#ff6b61) 12%,transparent);filter:none}
      .dnw-btn-icon{width:22px;height:22px;padding:0;border-radius:999px;font-size:12px;line-height:20px;
        font-weight:600;color:light-dark(#0071e3,#0a84ff);
        border-color:color-mix(in srgb,light-dark(#0071e3,#0a84ff) 35%,transparent);
        background:color-mix(in srgb,light-dark(#0071e3,#0a84ff) 8%,transparent)}
      .dnw-section{margin-top:16px;padding-top:14px;border-top:0.5px solid color-mix(in srgb,CanvasText 12%,transparent)}
      .dnw-section-first{margin-top:0;padding-top:0;border-top:none}
      .dnw-section-title{font-size:13px;font-weight:500;letter-spacing:-.01em;opacity:.55;margin-bottom:10px}
      .dnw-chip{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 8px;border-radius:999px;
        font-size:11px;line-height:1;font-weight:500;color:light-dark(#0071e3,#0a84ff);
        background:color-mix(in srgb,light-dark(#0071e3,#0a84ff) 10%,transparent);
        border:0.5px solid color-mix(in srgb,light-dark(#0071e3,#0a84ff) 22%,transparent)}
      .dnw-prefix-block{height:auto;min-height:30px;padding:6px 10px;white-space:normal;word-break:break-all;
        line-height:1.5;align-items:flex-start}
      .dnw-prefix{display:flex;align-items:center;height:30px;padding:0 10px;border-radius:6px;font-size:12px;
        font-family:ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.62;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;border:0.5px dashed color-mix(in srgb,CanvasText 28%,transparent);
        background:color-mix(in srgb,Canvas 92%,CanvasText 8%)}
      .dnw-switch{position:relative;flex:0 0 auto;width:42px;height:26px;padding:0;border:none;border-radius:999px;
        cursor:pointer;background:color-mix(in srgb,CanvasText 24%,transparent);transition:background .22s ease}
      .dnw-switch-on{background:#34c759}
      .dnw-switch span{position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:999px;background:#fff;
        box-shadow:0 1px 3px rgba(0,0,0,.28),0 0 1px rgba(0,0,0,.1);transition:left .22s cubic-bezier(.3,1.2,.4,1)}
      .dnw-switch-on span{left:18px}
      .dnw-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 9px;min-height:30px;
        font:inherit;font-family:inherit;font-size:13px;color:inherit;cursor:pointer;border:none;border-radius:7px;
        background:transparent;border-left:2px solid transparent;transition:background .12s}
      .dnw-row:hover{background:color-mix(in srgb,CanvasText 8%,transparent)}
      .dnw-row-on{background:color-mix(in srgb,light-dark(#0071e3,#0a84ff) 12%,transparent);
        border-left-color:light-dark(#0071e3,#0a84ff)}
      .dnw-badge{font-size:11px;opacity:.55;white-space:nowrap}
      .dnw-badge-accent{font-size:11px;font-weight:500;color:light-dark(#0071e3,#0a84ff);opacity:1;white-space:nowrap}
      .dnw-group-title{font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;opacity:.42;
        margin:14px 0 5px;padding-left:9px}
      .dnw-table-head{display:flex;gap:8px;padding:0 9px 7px;font-size:12px;opacity:.5;
        border-bottom:0.5px solid color-mix(in srgb,CanvasText 14%,transparent)}
      .dnw-table-row{display:flex;gap:8px;align-items:center;width:100%;text-align:left;padding:9px;
        font:inherit;font-family:inherit;font-size:13px;color:inherit;cursor:pointer;border:none;
        background:transparent;border-bottom:0.5px solid color-mix(in srgb,CanvasText 9%,transparent)}
      .dnw-table-row:hover{background:color-mix(in srgb,CanvasText 7%,transparent)}
      .dnw-card{flex:1 1 auto;min-width:380px;border-radius:12px;
        border:0.5px solid color-mix(in srgb,CanvasText 16%,transparent);
        background:color-mix(in srgb,Canvas 92%,transparent);padding:14px;
        box-shadow:0 1px 3px color-mix(in srgb,CanvasText 6%,transparent)}
      .dnw-scroll{scrollbar-width:thin}
      .dnw-scroll::-webkit-scrollbar{width:11px;height:11px}
      .dnw-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,CanvasText 30%,transparent);border-radius:999px;
        border:3px solid transparent;background-clip:content-box}
      .dnw-scroll::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,CanvasText 48%,transparent);
        background-clip:content-box}
    `

    /** 把样式表塞进页面（只塞一次）。没有 document 时静默跳过（测试环境）。 */
    function ensureStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = STYLES
      document.head.appendChild(el)
    }

    /* ─────────────────────────── 文案（payload） ─────────────────────────── */
    // 与 Host 的 src/payload.js 同口径；客户端这边只负责编辑与预览
    const PAYLOAD_FIELDS = [
      { id: 'event', label: '事件标题', hint: '✅ 对话完成 / ❓ 等待回答 …' },
      { id: 'time', label: '时间', hint: '按下面的格式渲染' },
      { id: 'session', label: '会话', hint: '会话标题 + 短 id' },
      { id: 'workspace', label: '工作区', hint: '目录名或全路径' },
      { id: 'prompt', label: '任务摘要', hint: '你这一轮说的话（可截断）' },
      { id: 'detail', label: '事件详情', hint: '问的是 / 工具 / 目标状态' },
      { id: 'link', label: '打开 DSH 按钮', hint: '点一下回到 DSH 窗口' },
    ]
    const PAYLOAD_DEFAULTS = {
      fields: PAYLOAD_FIELDS.map(field => field.id),
      promptChars: 60, workspaceStyle: 'basename',
      timeFormat: 'YYYY-MM-DD HH:mm', linkUrl: 'dsh://open', template: '',
    }
    /** 预览用示例数据（不读真实会话，避免泄露内容）。 */
    const PAYLOAD_SAMPLE = {
      title: '✅ 对话完成', color: 'green', time: '2026-09-30 10:19',
      session: '飞书通知改卡片', id: '7d6c5b', workspace: 'dsh-notice-webhook',
      prompt: '把飞书通知改成卡片，底部加个打开 DSH 的按钮', detail: null, link: 'dsh://open',
    }

    /** 按 fields 顺序生成预览行（与 Host 渲染口径一致，含模板覆盖）。 */
    function payloadPreviewLines(payload) {
      const config = { ...PAYLOAD_DEFAULTS, ...(payload ?? {}) }
      const sample = PAYLOAD_SAMPLE
      if (typeof config.template === 'string' && config.template.trim().length > 0) {
        const table = {
          event: sample.title, time: sample.time, session: sample.session, id: sample.id,
          workspace: sample.workspace, prompt: sample.prompt,
          detail: sample.detail === null ? '' : `${sample.detail.label}：${sample.detail.value}`,
          link: sample.link,
        }
        return config.template.replace(/\{(\w+)\}/g, (whole, key) => (key in table ? table[key] : whole)).split('\n')
      }
      const prompt = typeof config.promptChars === 'number' && config.promptChars > 0
        ? (sample.prompt.length > config.promptChars ? `${sample.prompt.slice(0, config.promptChars)}…` : sample.prompt)
        : null
      const map = {
        event: `**类型**：${sample.title}`,
        time: `**时间**：${sample.time}`,
        session: `**会话**：${sample.session}（#${sample.id}）`,
        workspace: `**工作区**：${config.workspaceStyle === 'full' ? '/Users/mac/proj/dsh-notice-webhook' : sample.workspace}`,
        prompt: prompt === null ? null : `**任务**：${prompt}`,
        detail: null,
        link: config.linkUrl ? `[打开 DSH](${config.linkUrl})` : null,
      }
      const fields = Array.isArray(config.fields) && config.fields.length > 0 ? config.fields : PAYLOAD_DEFAULTS.fields
      return fields.map(field => map[field]).filter(line => line !== null && line !== undefined && line !== '')
    }

    /** 文案编辑器：字段开关 + 上下排序 + 参数 + 模板。全局页与目标覆盖共用。 */
    function PayloadEditor({ value, onChange, onReset }) {
      const config = { ...PAYLOAD_DEFAULTS, ...(value ?? {}) }
      const fields = Array.isArray(config.fields) && config.fields.length > 0 ? config.fields : PAYLOAD_DEFAULTS.fields
      const ordered = [...fields, ...PAYLOAD_DEFAULTS.fields.filter(id => !fields.includes(id))]
      const move = (id, delta) => {
        const next = ordered.filter(x => x !== id)
        const at = ordered.indexOf(id) + delta
        next.splice(Math.max(0, Math.min(ordered.length - 1, at)), 0, id)
        onChange({ fields: next })
      }
      const toggle = id => onChange({ fields: fields.includes(id) ? fields.filter(x => x !== id) : [...fields, id] })
      const row = (id, index) => {
        const meta = PAYLOAD_FIELDS.find(field => field.id === id)
        const on = fields.includes(id)
        return h('div', { key: id, className: 'dnw-field', style: { marginBottom: 4 } },
          h('div', { className: 'dnw-label', style: { lineHeight: '26px' } }, `第 ${index + 1} 行`),
          h('div', { className: 'dnw-ctrl' },
            h('button', { type: 'button', className: 'dnw-btn', style: { width: 26, padding: 0 }, onClick: () => move(id, -1), title: '上移' }, '↑'),
            h('button', { type: 'button', className: 'dnw-btn', style: { width: 26, padding: 0 }, onClick: () => move(id, 1), title: '下移' }, '↓'),
            h('span', { style: { flex: '1 1 auto', minWidth: 0 } },
              h('span', null, meta?.label ?? id),
              meta?.hint === undefined ? null : h('span', { style: { ...MUTED, marginLeft: 8 } }, meta.hint)),
            h(Switch, { on, onToggle: () => toggle(id) })))
      }
      return h('div', null,
        h('div', { className: 'dnw-section-first' },
          ...ordered.map((id, index) => row(id, index))),
        h('div', { className: 'dnw-section' },
          h('div', { className: 'dnw-section-title' }, '参数'),
          h('div', { className: 'dnw-field' },
            h('div', { className: 'dnw-label' }, '摘要长度'),
            h('div', { className: 'dnw-ctrl' },
              h('input', {
                className: 'dnw-input', type: 'number', min: 0, value: String(config.promptChars),
                onChange: e => onChange({ promptChars: Number(e.target.value) || 0 }), style: { flex: '0 0 90px' },
              }),
              h('span', { className: 'dnw-hint', style: { maxWidth: 'none' } }, '字；0 = 不带摘要'))),
          h('div', { className: 'dnw-field' },
            h('div', { className: 'dnw-label' }, '时间格式'),
            h('div', { className: 'dnw-ctrl' },
              h('input', { className: 'dnw-input', value: config.timeFormat, onChange: e => onChange({ timeFormat: e.target.value }), style: { flex: '0 0 210px' } }),
              h('span', { className: 'dnw-hint', style: { maxWidth: 'none' } }, '支持 YYYY MM DD HH mm ss'))),
          h('div', { className: 'dnw-field' },
            h('div', { className: 'dnw-label' }, '工作区显示'),
            h('div', { className: 'dnw-ctrl' },
              h('button', {
                type: 'button', className: 'dnw-btn',
                onClick: () => onChange({ workspaceStyle: config.workspaceStyle === 'full' ? 'basename' : 'full' }),
              }, config.workspaceStyle === 'full' ? '全路径' : '目录名'),
              h('span', { className: 'dnw-hint', style: { maxWidth: 'none' } }, '全路径便于定位，可能含敏感目录'))),
          h('div', { className: 'dnw-field' },
            h('div', { className: 'dnw-label' }, '跳转地址'),
            h('div', { className: 'dnw-ctrl' },
              h('input', { className: 'dnw-input', value: config.linkUrl, onChange: e => onChange({ linkUrl: e.target.value }) }))),
          h('div', { className: 'dnw-field' },
            h('div', { className: 'dnw-label' }, '自定义模板'),
            h('div', { className: 'dnw-ctrl', style: { alignItems: 'flex-start', flexDirection: 'column' } },
              h('textarea', {
                className: 'dnw-input', rows: 3, value: config.template,
                placeholder: '留空 = 用上面的开关拼装；填了以模板为准',
                onChange: e => onChange({ template: e.target.value }), style: { width: '100%' },
              }),
              h('span', { className: 'dnw-hint', style: { maxWidth: 'none' } },
                '占位符：{event} {time} {session} {id} {workspace} {prompt} {detail} {link}')))),
        onReset === undefined ? null : h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
          h('button', { type: 'button', className: btnClass('default'), onClick: onReset }, '恢复默认')))
    }

    /**
     * 把一行 markdown 拆成展示元素：`**粗体**` → 加粗，`[文字](url)` → 链接样式。
     * 预览要"看着像收到的消息"，所以不能直接显示 markdown 原文。
     */
    function previewLine(line, key) {
      const nodes = []
      // `**粗体**` | `[文字](url)` | `（#id）`（后者渲染成飞书那种彩色小标签）
      const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)|（#([^）]+)）/g
      let last = 0
      let match
      while ((match = re.exec(line)) !== null) {
        if (match.index > last) nodes.push(line.slice(last, match.index))
        if (match[1] !== undefined) nodes.push(h('b', { key: `b${match.index}` }, match[1]))
        else if (match[2] !== undefined) nodes.push(h('span', { key: `a${match.index}`, style: { color: 'var(--dsh-accent, #0071e3)' } }, match[2]))
        else nodes.push(h('span', {
          key: `t${match.index}`, className: 'dnw-chip', style: { marginLeft: 4 },
        }, `#${match[4]}`))
        last = re.lastIndex
      }
      if (last < line.length) nodes.push(line.slice(last))
      return h('div', { key, style: { marginBottom: 6, fontSize: 12 } }, ...nodes)
    }

    /** 文案预览：飞书卡片 + 纯文本两种样子。 */
    /**
     * 卡片区要隐藏的默认渲染行：事件名（`**类型**：✅ 对话完成`）已经由卡片标题栏给出，正文不再重复
     *（REQ-261002150038-344a，与 Host 侧 `src/channels/feishu.js` 的卡片口径保持一致）。
     * 只认默认渲染出来的那一行；用户用自定义 template 时原样展示，不做猜测。
     */
    const CARD_HIDDEN_LINE = /^\*\*类型\*\*[：:]/

    function PayloadPreview({ value }) {
      const lines = payloadPreviewLines(value)
      const config = { ...PAYLOAD_DEFAULTS, ...(value ?? {}) }
      // 卡片里：事件名是标题、链接是下面的按钮、「类型」与标题重复 → 这三类行在卡片区都不再显示
      const cardLines = lines.filter(line => !line.includes('[打开 DSH]') && !CARD_HIDDEN_LINE.test(line))
      return h('div', null,
        h('div', { className: 'dnw-section-title', style: { marginBottom: 8 } }, '飞书卡片'),
        h('div', { 'data-dnw-region': 'feishu-card', style: { border: '1px solid rgba(128,128,128,.3)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 } },
          h('div', { style: { padding: '9px 12px', fontWeight: 600, background: 'rgba(52,199,89,.16)', color: '#1f9d4d' } }, PAYLOAD_SAMPLE.title),
          h('div', { style: { padding: 12 } },
            ...cardLines.map((line, i) => previewLine(line, i)),
            config.linkUrl && /^https?:\/\//i.test(config.linkUrl)
              ? h('span', { style: { display: 'inline-block', marginTop: 6, padding: '4px 12px', border: '1px solid var(--dsh-accent, #0071e3)', color: 'var(--dsh-accent, #0071e3)', borderRadius: 6, fontSize: 12 } }, '打开 DSH')
              : h('div', { style: { ...MUTED, marginTop: 6, fontSize: 11 } },
                '飞书卡片的按钮不跟随自定义协议（dsh://），已省略；文本渠道仍会带链接'))),
        h('div', { className: 'dnw-section-title', style: { marginBottom: 8 } }, '纯文本（企微 / 钉钉 / Slack / Discord）'),
        h('div', { style: { border: '1px dashed rgba(128,128,128,.4)', borderRadius: 10, padding: 12, fontSize: 12 } },
          ...lines.map((line, i) => previewLine(line, i))))
    }

    /** 手形开关（弹框标题行与卡片共用一份，避免两处各画一个）。 */
    function Switch({ on, onToggle }) {
      return h('button', {
        type: 'button', onClick: () => onToggle(!on), 'aria-pressed': on,
        'aria-label': on ? '停用' : '启用',
        className: 'dnw-switch' + (on ? ' dnw-switch-on' : ''),
      }, h('span', null))
    }

    /**
     * 弹框：编辑目标时浮在设置页之上（用户要求「改成弹框」）。
     * Esc 或点遮罩关闭；点内部不冒泡关闭；内容超高时自身滚动。
     */
    function Modal({ title, subtitle, icon, channelLabel, onClose, headerRight, children }) {
      // 真 React 中「只有一个子元素」时 children 是单个元素而不是数组——
      // 直接 `...children` 会抛 "Spread syntax requires ...iterable" 并把整个设置面板打成白板
      // （2026-09-30 实测事故）。这里一律归一化成数组再展开。
      const kids = children === undefined || children === null
        ? []
        : (Array.isArray(children) ? children : [children])
      useEffect(() => {
        const onKey = event => { if (event.key === 'Escape') onClose() }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }
        return undefined
      }, [onClose])
      return h('div', {
        role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
        onClick: onClose, className: 'dnw-backdrop',
      }, h('div', {
        onClick: event => { if (typeof event.stopPropagation === 'function') event.stopPropagation() },
        className: 'dnw-modal',
      },
      h('div', { className: 'dnw-modal-head' },
        h(ChannelIcon, { channel: icon, size: 22 }),
        h('span', { className: 'dnw-modal-title' }, title),
        h('span', { className: 'dnw-chip' }, channelLabel ?? icon),
        subtitle === null || subtitle === undefined
          ? null
          : h('span', { className: 'dnw-badge', style: { fontFamily: 'ui-monospace, monospace' } }, subtitle),
        h('span', { style: { flex: 1 } }),
        headerRight === undefined ? null : headerRight,
        h('button', { type: 'button', onClick: onClose, 'aria-label': '关闭', className: btnClass('default') }, '关闭')),
      h('div', { className: 'dnw-modal-body dnw-scroll' }, ...kids)))
    }

    const CARD = {
      border: '1px solid var(--dsh-border, #e5e7eb)', borderRadius: 8, padding: 12,
      background: 'var(--dsh-surface, transparent)',
    }

    function TabBar({ tab, onChange, bindingCount }) {
      const style = active => ({
        padding: '6px 12px', border: 'none', cursor: 'pointer', background: 'transparent',
        borderBottom: active ? '2px solid var(--dsh-accent, #247bbf)' : '2px solid transparent',
        color: active ? 'var(--dsh-text, inherit)' : 'var(--dsh-text-secondary, #6b7280)',
        fontWeight: active ? 600 : 400,
      })
      return h('div', { style: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsh-border, #e5e7eb)', marginBottom: 12 } },
        h('button', { type: 'button', style: style(tab === 'targets'), onClick: () => onChange('targets') }, '目标'),
        h('button', { type: 'button', style: style(tab === 'bindings'), onClick: () => onChange('bindings') },
          bindingCount > 0 ? `会话绑定（${bindingCount}）` : '会话绑定'))
    }

    /** 左栏：渠道 + 数量徽标。 */
    /** 左栏 rail：三段（全部目标 / 按渠道 / 默认组 + 不在默认组），对齐原型帧 1。 */
    function ChannelRail({ targets, selectedId, onSelect, onAdd, meta, boundIds }) {
      const countOf = id => targets.filter(t => t.channel === id).length
      const rowClass = selected => 'dnw-row' + (selected ? ' dnw-row-on' : '')
      const badge = (text, tone) => h('span', {
        className: tone === 'default' ? 'dnw-badge dnw-badge-accent' : 'dnw-badge',
        style: { marginLeft: 'auto' },
      }, text)
      const groupTitle = text => h('div', { className: 'dnw-group-title' }, text)
      const targetRow = target => h('button', {
        key: target.id, type: 'button', onClick: () => onSelect(target.id),
        className: rowClass(selectedId === target.id),
      },
      h(ChannelIcon, { channel: target.channel, size: 16 }),
      h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: target.enabled === false ? MUTED.color : 'inherit' } }, target.name),
      target.isDefault === true ? badge('默认', 'default') : (boundIds?.has(target.id) ? badge('绑定') : (target.enabled === false ? badge('停') : null)))

      const defaults = targets.filter(t => t.isDefault === true)
      const others = targets.filter(t => t.isDefault !== true)
      return h('div', { style: { flex: '0 0 196px', width: 196, display: 'flex', flexDirection: 'column', gap: 1 } },
        // ① 全部目标
        h('button', {
          type: 'button', onClick: () => onSelect(null), className: rowClass(selectedId === null),
        }, h('span', { style: { flex: 1 } }, '全部目标'), badge(String(targets.length))),
        // ② 按渠道（六个固定出现，0 个也在——让用户知道“这个渠道我还没配”）
        groupTitle('按渠道'),
        ...CHANNELS.map(channel => h('button', {
          key: channel.id, type: 'button', onClick: () => onAdd(channel.id), className: rowClass(false),
        }, h(ChannelIcon, { channel: channel.id, size: 16 }), h('span', { style: { flex: 1 } }, meta?.[channel.id]?.label ?? channel.label), badge(String(countOf(channel.id))))),
        h('button', { type: 'button', onClick: () => onAdd(CHANNELS[0].id), className: rowClass(false) },
          h('span', { style: { flex: 1, color: 'var(--dsh-accent, #247bbf)' } }, '+ 新增目标')),
        // ③ 默认组 / 不在默认组
        groupTitle('默认组 · 未绑定目标的会话发这里'),
        defaults.length === 0
          ? h('div', { style: { ...MUTED, paddingLeft: 8 } }, '（还没有默认目标）')
          : h('div', null, ...defaults.map(targetRow)),
        others.length === 0 ? null : groupTitle('不在默认组'),
        others.length === 0 ? null : h('div', null, ...others.map(targetRow)))
    }

    /** 关心事件网格：空 = 全收（显式提示，不留歧义）。顺序对齐原型。 */
    function EventFilterGrid({ events, onChange, disabled }) {
      return h('div', null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 } },
          ...EVENTS.map(event => h('label', {
            key: event.id,
            style: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: disabled ? 'default' : 'pointer' },
          },
          h('input', {
            type: 'checkbox', checked: events.includes(event.id), disabled,
            onChange: e => onChange(e.target.checked ? [...events, event.id] : events.filter(x => x !== event.id)),
            style: { marginTop: 2 },
          }),
          h('span', null,
            h('div', null, event.label),
            h('div', { style: MUTED }, event.field))))),
        events.length === 0
          ? h('div', { style: { ...MUTED, marginTop: 6 } }, '一个都没勾 = 接收全部事件（等价于全选）')
          : null)
    }

    /**
     * 「怎么拿 key」说明浮层：就地展开，不跳页、不开新窗。
     * 内容来自渠道元数据（经 RPC 投影），前端不硬编码步骤；help 缺失时整个入口不渲染。
     */
    function HelpPopover({ help }) {
      const [open, setOpen] = useState(false)
      if (help === undefined || help === null) return null
      return h('span', { style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button', 'aria-expanded': open, 'aria-label': '查看怎么拿 key',
          title: `${help.title}（点击展开，可在里面跳到官网配置页）`,
          onClick: () => setOpen(v => !v),
          onKeyDown: e => { if (e.key === 'Escape') setOpen(false) },
          className: 'dnw-btn dnw-btn-icon',
        }, '?'),
        open ? h('div', {
          className: 'dnw-scroll',
          style: {
            position: 'absolute', top: 26, left: 0, zIndex: 20, width: 320, padding: 12, borderRadius: 10,
            border: '1px solid rgba(128,128,128,.3)', background: 'var(--dnw-surface,Canvas)',
            boxShadow: '0 12px 32px rgba(0,0,0,.22)', textAlign: 'left', fontWeight: 400,
          },
        },
        h('div', { style: { fontSize: 13, marginBottom: 6 } }, help.title),
        h('ol', { style: { margin: '0 0 8px 18px', padding: 0, fontSize: 12, color: MUTED.color } },
          ...help.steps.map((step, i) => h('li', { key: i, style: { marginBottom: 3 } }, step))),
        help.docUrl === null || help.docUrl === undefined
          ? h('div', { style: { ...MUTED, fontSize: 12 } }, '这个渠道没有官方文档页，按上面的步骤在平台里拿 key 即可。')
          : h('a', {
            href: help.docUrl, target: '_blank', rel: 'noreferrer',
            title: help.docUrl,
            style: { fontSize: 12, fontWeight: 600 },
          }, '去官网配置页拿 key ↗')) : null)
    }

    /** 详情卡：head（图标+名称+id+启用）/ 字段 / 关心事件 / 归属 / 动作。 */
    function TargetCard({ draft, secrets, saving, error, onChange, onSave, onDelete, onTest, onToggle, testResult, testing, meta, boundSessions, inModal, payloadDefaults }) {
      // 单行字段：标签（右对齐定宽）+ 控件（自适应）+ 说明（右侧小字，超长省略、悬停看全）
      const field = (label, node, hint, hintTitle) => h('div', { className: 'dnw-field' },
      h('div', { className: 'dnw-label' }, label),
      h('div', { className: 'dnw-ctrl' }, node),
      hint === undefined || hint === null
        ? null
        : h('div', { className: 'dnw-hint', title: hintTitle ?? hint }, hint))
      // 合并 className（此前直接覆盖，导致调用方传的 dnw-input-has-suffix 被丢掉，
      // 输入框不留内边距、与内嵌后缀文字重叠）
      const input = props => {
        const { className, ...rest } = props
        return h('input', { ...rest, className: className === undefined ? 'dnw-input' : `dnw-input ${className}` })
      }
      const sec = (title, ...children) => h('div', { className: 'dnw-section' },
        title === null ? null : h('div', { className: 'dnw-section-title' }, title),
        ...children)
      // 第一个区块不画顶部横线（否则弹框头部下面会出现一条莫名的线）
      const secFirst = (title, ...children) => h('div', { className: 'dnw-section dnw-section-first' },
        title === null ? null : h('div', { className: 'dnw-section-title' }, title),
        ...children)
      const channelMeta = meta?.[draft.channel]
      const keyInput = channelMeta?.input === 'key'
      const help = channelMeta?.help ?? null

      // minWidth 是硬要求：不留最小宽度时右栏会把卡片挤成一条竖缝（字段区直接看不见）
      // 卡片内容用**显式数组**拼装再展开：之前直接往 h() 里排参数，
      // 少一个括号就退化成逗号表达式（return 卡片, 动作行）——页面会只剩两个按钮、
      // 字段区整棵被丢掉，而语法检查与 grep 都发现不了。数组写法让收尾不可能出错。
      const parts = [
        // head：图标 + 名称 + id + 启用。**弹框里不画**——弹框标题行已经有同一份信息，
        // 再画一遍就是「卡片套卡片」（用户 2026-09-30 反馈「嵌套了」）。
        inModal === true ? null : h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h(ChannelIcon, { channel: draft.channel, size: 22 }),
          h('span', { style: { fontSize: 15, fontWeight: 600 } }, draft.name || '（未命名）'),
          draft.id === null || draft.id === undefined
            ? h('span', { style: MUTED }, 'id: 保存后生成')
            : h('span', { style: { ...MUTED, fontFamily: 'ui-monospace, monospace' } }, `id: ${draft.id}`),
          h('span', { style: { flex: 1 } }),
          h('span', { style: MUTED }, draft.enabled === false ? '停用' : '启用'),
          h(Switch, { on: draft.enabled !== false, onToggle: v => onToggle(v) })),

        error === null ? null : h('div', {
          style: { marginBottom: 10, padding: '6px 8px', borderRadius: 6, background: 'rgba(185,28,28,.1)', color: 'var(--dsh-danger, #b91c1c)', fontSize: 12 },
        }, error),

        secFirst(null,
          // 必填与字数限制都放进输入框内（右侧淡字），标签只留字段名、不带 *
          field('名称',
            h('span', { className: 'dnw-input-wrap' },
              input({
                value: draft.name,
                onChange: e => onChange({ name: e.target.value }),
                placeholder: '例如：项目群-企微',
                className: 'dnw-input',
              }),
              h('span', { className: 'dnw-input-suffix' }, '必填 · 60 字内')),
            null),
          keyInput
            ? field(h('span', null, channelMeta.keyLabel ?? 'key', ' ', h(HelpPopover, { help })),
              // 分两层：① 固定地址（完整显示、可换行，不再截断）② 只填 key
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 auto', minWidth: 0 } },
                h('span', {
                  className: 'dnw-prefix dnw-prefix-block',
                  title: `完整地址：${channelMeta.urlPrefix ?? ''}${draft.key ?? ''}`,
                }, channelMeta.urlPrefix ?? '（前缀由 Host 下发）'),
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 } },
                  input({ value: draft.key ?? '', onChange: e => onChange({ key: e.target.value }), placeholder: '粘贴 key', style: { flex: '1 1 auto', width: 'auto', minWidth: 0 } }),
                  h('button', { type: 'button', onClick: onTest, disabled: testing === true, className: btnClass('default') }, testing === true ? '测试中…' : '发送测试'))))
            : field(h('span', null, '地址 ', h(HelpPopover, { help })),
              h('div', { style: { display: 'flex', gap: 8, flex: '1 1 auto', minWidth: 0 } },
                input({ value: draft.url, onChange: e => onChange({ url: e.target.value }), placeholder: 'https://…' }),
                h('button', { type: 'button', onClick: onTest, disabled: testing === true, className: btnClass('default') }, testing === true ? '测试中…' : '发送测试'))),
          channelMeta?.secret === true
            ? field('加签密钥（环境变量名）',
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                input({ value: draft.secretRef ?? '', onChange: e => onChange({ secretRef: e.target.value }), placeholder: '例如 DINGTALK_SECRET' }),
                draft.secretConfigured ? h('span', { style: { fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(21,128,61,.12)', color: 'var(--dsh-success, #15803d)' } }, '已配置') : null),
              null)
            : null,
          draft.channel === 'custom'
            ? field('请求头 JSON', h('textarea', {
              value: draft.headersText ?? '{}',
              onChange: e => onChange({ headersText: e.target.value }),
              rows: 3,
              style: { width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 6, borderRadius: 6, border: '1px solid var(--dsh-border, #d1d5db)', background: 'transparent', color: 'inherit' },
            }))
            : null),

        // 测试结果紧贴「发送测试」按钮所在的「基本」区上方，点完立刻能看见
        testResult === null || testResult === undefined ? null : h('div', {
          style: {
            marginTop: -2, marginBottom: 10, padding: '6px 8px', borderRadius: 6, fontSize: 12,
            background: testResult.pending === true ? 'rgba(127,127,127,.1)'
              : (testResult.ok ? 'rgba(21,128,61,.12)' : 'rgba(185,28,28,.1)'),
            color: testResult.pending === true ? MUTED.color
              : (testResult.ok ? 'var(--dsh-success, #15803d)' : 'var(--dsh-danger, #b91c1c)'),
          },
        }, testResult.pending === true
          ? '正在发送测试通知…'
          : (testResult.ok ? '✓ 测试通知已发出' : `✗ ${testResult.reason ?? ('HTTP ' + testResult.status)}`)),

        sec('关心事件 ℹ 默认全选；取消勾选 = 只收勾上的',
          h(EventFilterGrid, { events: draft.events ?? [], onChange: events => onChange({ events }) })),

        sec('文案',
          (() => {
            const own = draft.payload ?? null
            const following = own === null
            return h('div', null,
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                h('button', {
                  type: 'button', className: 'dnw-btn', 'aria-pressed': following,
                  onClick: () => onChange({ payload: null }),
                  style: following ? { borderColor: 'var(--dsh-accent, #0071e3)', color: 'var(--dsh-accent, #0071e3)' } : undefined,
                }, following ? '◉ 用默认文案' : '○ 用默认文案'),
                h('button', {
                  type: 'button', className: 'dnw-btn', 'aria-pressed': !following,
                  onClick: () => onChange({ payload: own ?? (payloadDefaults ?? PAYLOAD_DEFAULTS) }),
                  style: following ? undefined : { borderColor: 'var(--dsh-accent, #0071e3)', color: 'var(--dsh-accent, #0071e3)' },
                }, following ? '○ 单独设置这个目标的文案' : '◉ 单独设置这个目标的文案'),
                following ? h('span', { className: 'dnw-hint', style: { maxWidth: 'none' } }, '默认 = 事件 · 时间 · 会话 · 工作区 · 任务 · 链接（各渠道按自己的格式渲染）') : null),
              following
                ? null
                : h('div', { style: { marginTop: 8 } },
                  h(PayloadEditor, { value: own ?? {}, onChange: patch => onChange({ payload: { ...(own ?? {}), ...patch } }) }),
                  h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
                    h('button', { type: 'button', className: btnClass('default'), onClick: () => onChange({ payload: null }) }, '恢复为默认文案'))))
          })()),

        sec(null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
            h('span', { style: { fontSize: 12, width: 48 } }, '默认组'),
            h(Switch, { on: draft.isDefault === true, onToggle: v => onChange({ isDefault: v }) }),
            h('span', { style: MUTED }, '未绑定任何目标的会话会发给默认组里的目标')),
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
            h('span', { style: { fontSize: 12, width: 48, paddingTop: 2 } }, '谁在用'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 } },
              draft.isDefault === true ? h('span', { style: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsh-border, #e5e7eb)' } }, '默认组') : null,
              ...(boundSessions ?? []).map(sid => h('span', {
                key: sid, title: sid,
                style: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsh-border, #e5e7eb)' },
              }, `会话 ${String(sid).slice(-6)}（绑定）`)),
              (draft.isDefault !== true && (boundSessions ?? []).length === 0)
                ? h('span', { style: MUTED }, '没人用')
                : null))),


        h('div', { style: { display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' } },
          h('button', { type: 'button', onClick: onDelete, className: btnClass('danger') }, '删除目标'),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', onClick: onSave, disabled: saving, className: btnClass('primary') }, saving ? '保存中…' : '保存')),
      ]

      // 弹框内：不再套一层卡片（边框/内边距由弹框承担），否则就是卡片套卡片
      const rootStyle = inModal === true
        ? { display: 'block' }
        // 内联时 minWidth 是硬要求：不留最小宽度时右栏会把卡片挤成一条竖缝（字段区直接看不见）
        : { ...CARD, flex: '1 1 auto', minWidth: 380, overflow: 'hidden' }
      return h('div', { style: rootStyle }, ...parts.filter(part => part !== null))
    }

    /** 会话绑定表：这个会话绑了哪些目标 + 解绑。 */
    function BindingTable({ bindings, targets, busy, onUnbind }) {
      if (bindings.length === 0) {
        return h('div', { style: MUTED }, '还没有任何会话绑定。宿主插件（如看板）可以在自己的界面里调用 dshNoticeWebhookClient 选择器来绑定；解绑后该会话回落默认目标组。')
      }
      const nameOf = id => (targets.find(t => t.id === id) ?? { name: `⚠ 目标已删除（${id}）`, channel: 'custom' }).name
      return h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
        h('thead', null, h('tr', null,
          h('th', { style: { textAlign: 'left', padding: '6px 8px', ...MUTED } }, '会话'),
          h('th', { style: { textAlign: 'left', padding: '6px 8px', ...MUTED } }, '绑定的目标'),
          h('th', { style: { textAlign: 'right', padding: '6px 8px', ...MUTED } }, '操作'))),
        h('tbody', null, ...bindings.map(binding => h('tr', { key: binding.sessionId, style: { borderTop: '1px solid var(--dsh-border, #e5e7eb)' } },
          h('td', { style: { padding: '6px 8px', maxWidth: 220 } },
            h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, binding.sessionId),
            h('div', { style: MUTED }, `…${binding.sessionId.slice(-6)}`)),
          h('td', { style: { padding: '6px 8px' } },
            binding.targetIds.length === 0
              ? h('span', { style: MUTED }, '（空）')
              : h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                ...binding.targetIds.map(id => {
                  const exists = targets.some(t => t.id === id)
                  const ch = targets.find(t => t.id === id)?.channel
                  return h('span', {
                    key: id,
                    style: {
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '2px 8px', borderRadius: 999, fontSize: 12,
                      border: '1px solid var(--dsh-border, #e5e7eb)',
                      color: exists ? 'inherit' : 'var(--dsh-danger, #b91c1c)',
                    },
                  }, ch === undefined ? null : h(ChannelIcon, { channel: ch, size: 12 }), nameOf(id))
                }))),
          h('td', { style: { padding: '6px 8px', textAlign: 'right' } },
            h('button', {
              type: 'button', disabled: busy,
              onClick: () => {
                try {
                  if (typeof window.confirm === 'function' && !window.confirm('解绑后该会话改为发默认目标组，确认？')) return
                } catch { /* confirm 不可用就直接解绑 */ }
                onUnbind(binding.sessionId)
              },
              style: { padding: '3px 10px' },
            }, '解绑'))))),
        h('div', { style: { ...MUTED, marginTop: 8 } }, '绑定的会话只发它绑定的目标（不叠加默认组）；解绑或目标被删后自动回落默认组。'))
    }

    /**
     * 可嵌入的目标选择器（给宿主插件用）。
     * 只负责画与回传选择结果，**不自己开弹框**——弹框由宿主拥有。
     */
    function TargetPicker({ targets, selected, onConfirm, onCancel, readOnly, loading, error }) {
      const [picked, setPicked] = useState(selected ?? [])
      const toggle = id => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

      if (loading) return h('div', { style: { padding: 12, ...MUTED } }, '加载目标清单…')
      if (error !== null && error !== undefined) return h('div', { style: { padding: 12, color: 'var(--dsh-danger, #b91c1c)', fontSize: 13 } }, error)

      return h('div', { style: { minWidth: 280 } },
        targets.length === 0
          ? h('div', { style: { padding: 12, ...MUTED } }, '还没有配置任何 webhook 目标。先到「设置 → 通知推送」里加一个，再回来绑定。')
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' } },
            ...targets.map(target => h('label', {
              key: target.id,
              style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: readOnly ? 'default' : 'pointer' },
            },
            h('input', { type: 'checkbox', disabled: readOnly, checked: picked.includes(target.id), onChange: () => toggle(target.id) }),
            h(ChannelIcon, { channel: target.channel, size: 14 }),
            h('span', null, target.name),
            target.isDefault ? h('span', { style: MUTED }, '默认组') : null,
            target.enabled === false ? h('span', { style: MUTED }, '（已停用）') : null))),
        readOnly
          ? null
          : h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 } },
            h('button', { type: 'button', onClick: () => onCancel?.() }, '取消'),
            h('button', { type: 'button', onClick: () => onConfirm?.(picked) }, '确定')))
    }

    /** 选择器 + 数据加载的薄壳（宿主拿到的就是它）。 */
    function TargetPickerHost(props) {
      const [state, setState] = useState({ loading: true, targets: [], error: null })
      useEffect(() => {
        let alive = true
        call('/state')
          .then(({ data }) => { if (alive) setState({ loading: false, targets: data.targets ?? [], error: null }) })
          .catch(e => { if (alive) setState({ loading: false, targets: [], error: `读取目标清单失败：${String(e?.message ?? e)}` }) })
        return () => { alive = false }
      }, [])
      return h(TargetPicker, { ...props, targets: state.targets, loading: state.loading, error: state.error })
    }

    // ─────────────────────────── 设置页 ───────────────────────────

    function Section() {
      const [tab, setTab] = useState('targets')
      const [state, setState] = useState(null)
      const [loading, setLoading] = useState(true)
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)
      const [testResult, setTestResult] = useState(null)
      const [testing, setTesting] = useState(false)
      // 文案页的编辑草稿；null = 还没改过（显示 Host 回传的那份）
      const [payloadDraft, setPayloadDraft] = useState(null)

      const applyState = useCallback(data => {
        setState(data)
        setDraft(prev => {
          if (prev === null) return null
          const fresh = (data.targets ?? []).find(t => t.id === prev.id)
          if (fresh === undefined) return null
          return { ...fresh, headersText: JSON.stringify(fresh.headers ?? {}, null, 2) }
        })
      }, [])

      const reload = useCallback(async () => {
        try {
          const { data } = await call('/state')
          applyState(data)
          setError(null)
        } catch (e) {
          setError(`读取配置失败：${String(e?.message ?? e)}`)
        } finally {
          setLoading(false)
        }
      }, [applyState])

      useEffect(() => { reload() }, [reload])

      /** 写操作统一走这里：409 → 刷新并保留用户已填内容。 */
      const write = useCallback(async (path, body) => {
        setSaving(true)
        try {
          const { status, data } = await call(path, { ...body, revision: state?.revision })
          if (status === 409) {
            applyState(data)
            setError('配置已被其他页面修改，已刷新为最新；请确认后再保存一次')
            return false
          }
          if (data.ok === false) {
            setError((data.errors ?? [data.reason ?? '保存失败']).join('；'))
            return false
          }
          applyState(data)
          setError(null)
          return data   // 带响应体回去：保存新建目标后需要拿它的真实 id
        } catch (e) {
          setError(`保存失败：${String(e?.message ?? e)}`)
          return false
        } finally {
          setSaving(false)
        }
      }, [state, applyState])

      const targets = state?.targets ?? []
      const bindings = state?.bindings ?? []
      const channelMeta = state?.channelMeta ?? {}
      // 「谁在用」：目标 ↔ 会话的双向视图（只读展示，便于排查“某个会话为什么没收到”）
      const boundIds = new Set(bindings.flatMap(b => b.targetIds ?? []))
      const sessionsOf = id => bindings.filter(b => (b.targetIds ?? []).includes(id)).map(b => b.sessionId)

      const startAdd = useCallback(channel => {
        setTab('targets')
        setTestResult(null)
        setError(null)
        setDraft({ id: null, name: '', channel, key: '', url: '', events: EVENT_IDS.slice(), enabled: true, isDefault: false, secretRef: '', secretConfigured: false, headersText: '{}' })
      }, [])

      const selectTarget = useCallback(id => {
        if (id === null || id === undefined) { setDraft(null); setError(null); setTestResult(null); return }
        const target = targets.find(t => t.id === id)
        if (target === undefined) return
        setTestResult(null)
        setError(null)
        setDraft({
          ...target,
          // 老数据 events 为空 = 全收（后端语义不变）；界面按全选显示，避免「没勾 = 全收」的误解
          events: (target.events ?? []).length === 0 ? EVENT_IDS.slice() : target.events,
          headersText: JSON.stringify(target.headers ?? {}, null, 2),
        })
      }, [targets])

      const save = useCallback(async () => {
        if (draft === null) return
        // 必填项先在本地拦：错误直接进弹框（此前错误只写到弹框外的页面级 error 里，用户看不见）
        const meta = channelMeta[draft.channel]
        const missing = []
        if (String(draft.name ?? '').trim() === '') missing.push('名称')
        if (meta?.input === 'key') {
          if (String(draft.key ?? '').trim() === '') missing.push(meta.keyLabel ?? 'key')
        } else if (String(draft.url ?? '').trim() === '') {
          missing.push('地址')
        }
        if (missing.length > 0) {
          setError(`还差必填项：${missing.join('、')}`)
          return
        }
        let headers
        if (draft.channel === 'custom' && draft.headersText !== undefined) {
          try {
            headers = JSON.parse(draft.headersText || '{}')
          } catch {
            setError('自定义请求头不是合法 JSON')
            return
          }
        }
        // 「关心事件」的语义（REQ-261001203114-19b6 FR-5）：
        // 全勾 = **全收**（提交空列表 + all，未来新增事件自动包含）；否则 = 用户明确挑选的集合（explicit，永不自动追加）。
        // 之前恒提交显式全量列表，导致新增事件被白名单挡在门外（老目标收不到中断通知）。
        const chosen = Array.isArray(draft.events) ? draft.events : []
        const allChecked = chosen.length === EVENT_IDS.length && EVENT_IDS.every(id => chosen.includes(id))
        const saved = await write('/targets', {
          target: {
            ...(draft.id === null ? {} : { id: draft.id }),
            name: draft.name, channel: draft.channel,
            ...(channelMeta[draft.channel]?.input === 'key'
              ? { key: draft.key ?? '' }
              : { url: draft.url }),
            ...(draft.secretRef ? { secretRef: draft.secretRef } : {}),
            ...(headers === undefined ? {} : { headers }),
            enabled: draft.enabled !== false,
            events: allChecked ? [] : chosen,
            eventsMode: allChecked ? 'all' : 'explicit',
            isDefault: draft.isDefault === true,
          },
        })
        if (saved) {
          // 保存成功后把真实 id 等落回草稿：否则新建的目标一直显示「id: 保存后生成」，
          // 点「发送测试」只会得到「先保存再测试」，看起来像按钮没反应。
          const fresh = saved.target
            ?? (saved.targets ?? []).find(t => t.name === draft.name && t.channel === draft.channel)
          setDraft(prev => (prev === null ? prev : { ...prev, ...(fresh ?? {}), headersText: prev.headersText }))
        }
      }, [draft, write])

      /** 启停：弹框标题行与卡片内联时共用同一个处理器（避免两处逻辑分叉）。
       *  必须放在下面的 `if (loading) return` **之前**——hook 不能出现在提前 return 之后，
       *  否则 loading 变化时 hook 数量变化，真 React 会抛 "Rendered more hooks than during the previous render"。 */
      /** 启停：弹框标题行与卡片内联时共用同一个处理器（避免两处逻辑分叉）。 */
      const toggleEnabled = useCallback(async enabled => {
        setDraft(prev => (prev === null ? prev : { ...prev, enabled }))
        await write('/targets', { target: { ...draft, enabled, headersText: undefined } })
      }, [draft, write])

      if (loading) return h('div', { style: { padding: 16, ...MUTED } }, '加载中…')

      return h('div', { style: { padding: '4px 2px' } },
        // content-head：面包屑 + 两个入口（对齐原型；这两个按钮只切换本页的信息块，不打开文件系统）
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 } },
          h('div', { style: { flex: 1 } },
            h('div', { style: { fontSize: 13, color: MUTED.color } }, '设置 › 通知推送'),
            h('div', { style: MUTED }, '把「对话完成 / 等待回答 / 等待授权 / 目标终态」推到你配置的 webhook；未绑定的会话发默认目标组。')),
        ),

        h(TabBar, { tab, onChange: setTab, bindingCount: bindings.length }),

        // 缺渠道元数据说明 Host 还是旧版：与其让人猜「为什么没有固定地址/官网说明」，直接说清怎么修
        Object.keys(channelMeta).length === 0
          ? h('div', {
            style: { marginBottom: 10, padding: '6px 8px', borderRadius: 6, background: 'rgba(217,119,6,.12)', color: 'var(--dsh-warning, #b45309)', fontSize: 12 },
          }, '当前 Host 未加载新版插件：拿不到「渠道固定地址 / 官网配置说明」（界面已降级为完整 URL 输入）。请重启 Host 后刷新本页。')
          : null,

        error === null ? null : h('div', {
          style: { marginBottom: 10, padding: '6px 8px', borderRadius: 6, background: 'rgba(185,28,28,.1)', color: 'var(--dsh-danger, #b91c1c)', fontSize: 12 },
        }, error),

        tab === 'targets'
          ? h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
            h(ChannelRail, { targets, selectedId: draft?.id ?? null, onSelect: selectTarget, onAdd: startAdd, meta: channelMeta, boundIds }),
            draft === null
              // 左栏 rail 已经把所有目标列全了（按渠道 + 默认组 + 徽标），这里不再重复一张清单
              ? null
              : h(Modal, {
                title: draft.name || '（未命名）',
                subtitle: draft.id === null ? 'id: 保存后生成' : `id: ${draft.id}`,
                icon: draft.channel,
                channelLabel: channelMeta[draft.channel]?.label ?? draft.channel,
                onClose: () => { setDraft(null); setTestResult(null); setError(null) },
                // 启用开关放标题行右侧（卡片自己那层头在弹框内不再渲染）
                headerRight: h(Switch, { on: draft.enabled !== false, onToggle: toggleEnabled }),
              }, h(TargetCard, {
                inModal: true,
                meta: channelMeta, payloadDefaults: state?.payloadDefaults ?? PAYLOAD_DEFAULTS,
                boundSessions: draft.id === null ? [] : sessionsOf(draft.id),
                draft, secrets: state?.secrets ?? {},
                saving, error,
                onChange: patch => setDraft(prev => ({ ...prev, ...patch })),
                onSave: save,
                onDelete: async () => {
                  if (draft.id === null) { setDraft(null); return }
                  try {
                    if (typeof window.confirm === 'function' && !window.confirm(`删除目标「${draft.name}」？`)) return
                  } catch { /* 无 confirm 直接删 */ }
                  if (await write('/targets/delete', { id: draft.id })) setDraft(null)
                },
                onToggle: toggleEnabled,
                testing,
                onTest: async () => {
                  if (draft.id === null) { setTestResult({ ok: false, reason: '还没保存：先点「保存」再发送测试' }); return }
                  setTesting(true)
                  setTestResult({ ok: true, pending: true, reason: '正在发送…' })
                  try {
                    const { data } = await call('/test', { id: draft.id })
                    setTestResult(data)
                  } catch (e) {
                    setTestResult({ ok: false, reason: `测试请求失败：${String(e?.message ?? e)}` })
                  } finally {
                    setTesting(false)
                  }
                  reload()
                },
                testResult,
              })),
            )
          : h(BindingTable, {
            bindings, targets, busy: saving,
            onUnbind: async sessionId => { await write('/bindings/delete', { sessionId }) },
          }))
    }

    // ─────────────────────────── 插件装配 ───────────────────────────

    return {
      // 仅供测试：挂出内部组件，测试可真正渲染一次并断言字段是否都在（见 test/client-render.test.js）
      __test: { Section, ChannelRail, TargetCard, EventFilterGrid, HelpPopover, BindingTable, TabBar, Modal, Switch, PayloadEditor, PayloadPreview, payloadPreviewLines },
      inject: ['slots'],

      apply(ctx) {
        ensureStyles()
        let disposed = false

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-notice-webhook',
          order: 21,
          label: () => '通知推送',
        }, Section))

        // 给其他插件的可嵌入选择器（客户端服务 v1）。
        if (typeof ctx.provide === 'function') {
          ctx.effect?.(() => {
            const dispose = ctx.provide(CLIENT_SERVICE_KEY, {
              version: CLIENT_SERVICE_VERSION,
              /**
               * @param options.sessionId - 要绑定的会话（宿主自己知道）
               * @param options.selected - 已选目标 id
               * @param options.onConfirm - `(targetIds) => void`
               * @param options.onCancel - 可选
               * @param options.readOnly - 只读展示
               * @returns React 元素；服务已失效时返回 null（宿主应回落自己的界面）
               */
              renderTargetPicker(options = {}) {
                if (disposed) return null
                return h(TargetPickerHost, options)
              },
            })
            return () => {
              disposed = true
              try { dispose?.() } catch { /* 卸载失败不抛 */ }
            }
          }, 'dsh-notice-webhook: client service')
        }
      },
    }
  },
})
