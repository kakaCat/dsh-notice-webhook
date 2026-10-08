/**
 * Host Service `dshNoticeWebhook` —— 把「会话窗口 → webhook 目标」的绑定能力
 * 开放给同进程的其他 DSH 插件（FR-8 / FR-10）。
 *
 * v2 的变化（REQ-260930155231-0862 FR-5）：绑定的目标从"一条地址"变成"若干目标 id"，
 * 且**绑定即替代默认组、不叠加**。旧四个方法（bind/unbind/list/resolve）一个不删、语义不变。
 *
 * 设计纪律：**参数非法一律返回 false，绝不抛异常**——调用方是同进程的其他插件，
 * 抛异常会把别人的插件搞挂，而一个绑定失败远没有那么严重。
 *
 * 契约见 docs/requirements/REQ-260930155231-0862/design/interfaces.md「Host Service」。
 */

/** 服务名：消费方通过 `inject: ['dshNoticeWebhook']` 取用。 */
export const SERVICE_KEY = 'dshNoticeWebhook'

/** 接口版本（不是软件版本）；v2 = 新增多目标方法，旧方法语义不变。 */
export const SERVICE_VERSION = 2

/**
 * 构造服务对象（纯工厂，便于单测直接调用，不需要真 ctx）。
 *
 * @param deps.bindings - BindingStore 实例
 * @param deps.targets - TargetStore 实例
 * @param deps.resolveDefaultUrl - 返回当前默认地址的函数（配置可能热改）
 * @param deps.resolveAll - （可选）路由解析函数；缺省时 resolveAll 返回 null
 */
export function createService(deps) {
  const { bindings, targets, resolveDefaultUrl, resolveAll } = deps

  return {
    version: SERVICE_VERSION,

    /* ── 旧签名（REQ-260930123701-250a FR-9：必须继续可用，行为不变） ── */

    /**
     * 绑定（v1 语义）：该会话窗口的推送改走 url。
     * v2 里 url 会映射为一个 custom 目标并写入多目标绑定段（路由才能读到）；
     * 优先走注入的 bindLegacyUrl（它会同时维护 url 段与目标段）。
     * @returns false = 参数非法被拒
     */
    bind(sessionId, url) {
      if (typeof deps.bindLegacyUrl === 'function') return deps.bindLegacyUrl(sessionId, url)
      return bindings.bind(sessionId, url)
    },

    /** 解绑（同时清掉旧 url 绑定与多目标绑定）。@returns 是否真的删掉了一条 */
    unbind(sessionId) {
      return bindings.unbind(sessionId)
    },

    /** 全部旧版绑定（按 sessionId 升序）。 */
    list() {
      return bindings.list()
    },

    /** 解析某会话将使用的目标；无绑定且无默认地址时返回 null。 */
    resolve(sessionId) {
      return bindings.resolve(sessionId, resolveDefaultUrl())
    },

    /* ── 新增（v2） ── */

    /**
     * 把窗口绑定到若干目标 id。**语义：绑定即替代默认组（不叠加）**。
     * @returns false = 任一 id 不存在（整笔不生效，不做部分绑定）
     */
    bindTargets(sessionId, targetIds) {
      if (!Array.isArray(targetIds)) return false
      // 空数组 = 解绑（等价 unbindTargets），先校验 sessionId 合法性
      if (targetIds.length === 0) return bindings.unbindTargets(sessionId)
      for (const id of targetIds) {
        if (typeof id !== 'string' || targets.get(id) === undefined) return false
      }
      return bindings.bindTargets(sessionId, targetIds)
    },

    /**
     * 三方解绑专用：清掉该窗口的全部绑定（多目标 + 旧 url），回落默认组。
     * @returns 是否真的删掉了一条
     */
    unbindTargets(sessionId) {
      return bindings.unbindTargets(sessionId)
    },

    /** 全部窗口绑定（供宿主做"这个会话绑了谁"的展示/排查）。 */
    listBindings() {
      return bindings.listBindings().map(binding => ({
        ...binding,
        targets: binding.targetIds
          .map(id => targets.get(id))
          .filter(Boolean)
          .map(t => ({ id: t.id, name: t.name, channel: t.channel, enabled: t.enabled })),
      }))
    },

    /** 目标清单（不含密钥明文；secretRef 只回是否已配置）。 */
    listTargets() {
      return targets.list().map(t => {
        const { secretRef, ...rest } = t
        return { ...rest, secretRef: secretRef !== undefined ? secretRef : null, secretConfigured: secretRef !== undefined && secretRef.length > 0 }
      })
    },

    /** 该会话将投递的全部目标（由注入的路由解析算出；未注入返回 null）。 */
    resolveAll(sessionId, intent) {
      if (typeof resolveAll !== 'function') return null
      return resolveAll(sessionId, intent)
    },
  }
}

/**
 * 把服务注册到 Cordis 上下文，并挂上卸载清理。
 *
 * @param ctx - 宿主上下文（需要 provide；effect 可选）
 * @param service - createService(...) 的产物
 * @returns 清理函数
 */
export function provideService(ctx, service) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.provide !== 'function') return () => {}
  const dispose = ctx.provide(SERVICE_KEY, service)
  return () => {
    try {
      if (typeof dispose === 'function') dispose()
    } catch {
      /* 卸载失败不该再抛出去 */
    }
  }
}
