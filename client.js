/**
 * client.js —— @local/engineering-craft-suite 的 Client 半（由 package.json dsh.client 自动挂载）。
 * 由 window.__ModuleLoader__.load 懒注册：main keyed 面板、header.actions 入口、shell.overlay 确认人拍板卡。
 * React 从 require('react') 取；样式只用 --dsw-alias-* theme token；数据走 fetch('/api/engineering-craft/*')。
 * 文案走 DSH 自带系统插件 @deepseek-ai/dsh-client-locale 的命名空间字典（zh/en），切语言无需 reload。
 */
window.__ModuleLoader__.load({
  id: '@local/engineering-craft-suite',

  /**
   * Client 懒工厂（无副作用）；React 与 locale 都从浏览器模块表取，禁止自带。
   * @param {(name: string) => any} require 浏览器模块表
   */
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useSyncExternalStore } = React

    // 本插件的命名空间字典（zh/en 都齐全，符合 dsh-client-locale 的 register 契约）。
    const NS = '@local/engineering-craft-suite'
    const DICT = {
      zh: {
        'panel.title': '工程流程',
        'panel.stage': '阶段',
        'panel.gates': '阶段门',
        'panel.gatePassed': '已通过',
        'panel.gatePending': '未通过',
        'panel.nextRole': '下一岗位',
        'panel.blockedBy': '阻塞',
        'panel.missingArtifacts': '缺失交接物',
        'panel.plan': '计划',
        'panel.pipeline': '岗位流水线',
        'panel.refresh': '刷新',
        'panel.loading': '加载中…',
        'panel.noProject': '未检测到项目根（projectRoot）',
        'panel.readFailed': '状态读取失败',
        'panel.none': '无',
        'confirm.title': '需要你拍板',
        'confirm.approve': '确认',
        'confirm.reject': '退回',
        'confirm.goNoGo': '发布 go / no-go',
        'openPanel': '工程面板',
        'role.product': '产品',
        'role.architect': '架构',
        'role.developer': '研发',
        'role.tester': '测试',
        'role.reviewer': '评审',
        'role.ops': '运维',
      },
      en: {
        'panel.title': 'Engineering workflow',
        'panel.stage': 'Stage',
        'panel.gates': 'Stage gates',
        'panel.gatePassed': 'Passed',
        'panel.gatePending': 'Pending',
        'panel.nextRole': 'Next role',
        'panel.blockedBy': 'blocked by',
        'panel.missingArtifacts': 'Missing handoffs',
        'panel.plan': 'Plan',
        'panel.pipeline': 'Role pipeline',
        'panel.refresh': 'Refresh',
        'panel.loading': 'Loading…',
        'panel.noProject': 'No project root detected (projectRoot)',
        'panel.readFailed': 'Failed to read state',
        'panel.none': 'none',
        'confirm.title': 'Decision required',
        'confirm.approve': 'Confirm',
        'confirm.reject': 'Send back',
        'confirm.goNoGo': 'Go / no-go',
        'openPanel': 'Engineering panel',
        'role.product': 'Product',
        'role.architect': 'Architect',
        'role.developer': 'Developer',
        'role.tester': 'Tester',
        'role.reviewer': 'Reviewer',
        'role.ops': 'Operations',
      },
    }

    const ROLE_KEYS = ['product', 'architect', 'developer', 'tester', 'reviewer', 'ops']
    const GATES = ['G1', 'G2', 'G3']

    // locale seat：apply 里注入；组件通过 useT() 订阅 revision，语言切换即时重渲染。
    // 稳定的 noop 后备，保证 hook 无条件调用（符合 hooks 规则），locale 缺失时退化为 zh 字典。
    const NOOP_SUBSCRIBE = () => () => {}
    const FALLBACK_SNAPSHOT = Object.freeze({ active: 'zh', revision: 0 })
    const fallbackSnapshot = () => FALLBACK_SNAPSHOT
    const fallbackTranslate = (k) => (DICT.zh[k] ?? k)
    let localeSeat = null // { subscribe, getSnapshot, translate }

    /**
     * 翻译 hook：用 useSyncExternalStore 订阅 LocaleFace revision；返回稳定的 t(key)。
     * hook 始终无条件调用；locale seat 缺失时用 noop 后备（zh 字典）。
     * @returns {(key: string) => string} 翻译函数
     */
    function useT() {
      const seat = localeSeat
      const subscribe = (typeof useSyncExternalStore === 'function')
        ? (seat?.subscribe ?? NOOP_SUBSCRIBE)
        : NOOP_SUBSCRIBE
      const getSnap = seat?.getSnapshot ?? fallbackSnapshot
      if (typeof useSyncExternalStore === 'function') {
        useSyncExternalStore(subscribe, getSnap, getSnap)
      }
      return seat?.translate ?? fallbackTranslate
    }

    /** 从各种来源猜 projectRoot；取不到返回 null（面板显示提示，不崩）。 */
    function guessProjectRoot(props) {
      const candidates = [
        props?.projectRoot,
        window.__DSH_BOOT__?.workspace,
        window.__DSH_BOOT__?.workspaceRoot,
        window.__DSH_BOOT__?.projectRoot,
        window.__dshWorkspace__,
      ]
      for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim()
      try {
        const m = new URLSearchParams(location.search).get('projectRoot')
        if (m) return m
      } catch { /* 无 location */ }
      return null
    }

    /** 统一 fetch JSON；失败不抛到渲染层，返回带 error 的对象。 */
    async function api(path, options) {
      try {
        const r = await fetch(path, options)
        return await r.json()
      } catch (e) {
        return { ok: false, error: { code: 'NETWORK', message: String(e?.message ?? e) } }
      }
    }

    const panelStyle = {
      padding: '16px',
      color: 'var(--dsw-alias-fg-default, inherit)',
      background: 'var(--dsw-alias-bg-surface, transparent)',
      fontFamily: 'var(--dsw-alias-font-sans, inherit)',
    }
    const cardStyle = {
      padding: '12px 16px',
      border: '1px solid var(--dsw-alias-border-subtle, #8884)',
      borderRadius: '8px',
      background: 'var(--dsw-alias-bg-surface, inherit)',
      color: 'var(--dsw-alias-fg-default, inherit)',
    }
    const buttonStyle = {
      padding: '4px 12px',
      marginRight: '8px',
      border: '1px solid var(--dsw-alias-border-subtle, #8884)',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-accent, transparent)',
      color: 'var(--dsw-alias-fg-accent, inherit)',
      cursor: 'pointer',
    }

    /** 主面板：显示阶段 / 三门 / PLAN / 六岗位树；只读 EcState。 */
    function EcPanel(props) {
      const t = useT()
      const root = guessProjectRoot(props)
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [version, setVersion] = useState(0)

      useEffect(() => {
        let alive = true
        if (!root) { setError(t('panel.noProject')); return () => { alive = false } }
        api(`/api/engineering-craft/state?projectRoot=${encodeURIComponent(root)}`).then((r) => {
          if (!alive) return
          if (r.version === undefined && r.error) setError(r.error.message ?? t('panel.readFailed'))
          else { setState(r); setError(null) }
        })
        return () => { alive = false }
      }, [root, version])

      if (error) return h('div', { style: panelStyle }, h('p', null, `${t('panel.title')}：${error}`))
      if (!state) return h('div', { style: panelStyle }, h('p', null, `${t('panel.title')}：${t('panel.loading')}`))

      const stage = h('p', null, `${t('panel.stage')}：${state.stage ?? '-'}`)
      const gates = h('div', null,
        h('strong', null, `${t('panel.gates')}：`),
        h('span', null, GATES.map((g) => `${g}=${state.gates?.[g]?.passed ? t('panel.gatePassed') : t('panel.gatePending')}`).join('  ')),
      )
      const role = h('p', null, `${t('panel.nextRole')}：${state.nextRole ?? state.pipeline?.role ?? '-'}${state.blockedBy ? `（${t('panel.blockedBy')}：${state.blockedBy}）` : ''}`)
      const missing = h('p', null, `${t('panel.missingArtifacts')}：${Object.entries(state.artifacts ?? {}).filter(([, v]) => !v).map(([k]) => k).join(', ') || t('panel.none')}`)
      const plan = h('ul', null, (state.plan ?? []).map((u) => h('li', { key: u.id }, `${u.id} ${u.target} [${u.status}]`)))
      const pipeline = h('ol', null, ROLE_KEYS.map((key) => {
        const handoff = state.pipeline?.handoffs?.[key]
        return h('li', { key }, `${t(`role.${key}`)}${handoff ? ' ✓' : ''}`)
      }))

      return h('div', { style: panelStyle },
        h('h3', null, t('panel.title')),
        stage, gates, role, missing,
        h('h4', null, t('panel.plan')), plan,
        h('h4', null, t('panel.pipeline')), pipeline,
        h('button', { style: buttonStyle, onClick: () => setVersion((v) => v + 1) }, t('panel.refresh')),
      )
    }

    /** 人拍板确认卡：只有 state.pendingConfirm 非空时才显示。 */
    function EcConfirmCard(props) {
      const t = useT()
      const root = guessProjectRoot(props)
      const [state, setState] = useState(null)

      useEffect(() => {
        let alive = true
        if (!root) return () => { alive = false }
        api(`/api/engineering-craft/state?projectRoot=${encodeURIComponent(root)}`).then((r) => {
          if (alive && r.version !== undefined) setState(r)
        })
        return () => { alive = false }
      }, [root])

      const pending = state?.pendingConfirm
      if (!pending) return null

      const submit = useCallback(async (decision) => {
        const r = await api('/api/engineering-craft/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectRoot: root,
            kind: pending.gate === 'go-no-go' ? 'go-no-go' : 'confirm-gate',
            gate: pending.gate,
            decision,
            userConfirmed: true,
          }),
        })
        if (r.ok !== false) setState((s) => ({ ...s, pendingConfirm: null }))
      }, [root, pending])

      const title = pending.gate === 'go-no-go' ? t('confirm.goNoGo') : `${t('confirm.title')}：${pending.gate}`
      return h('div', { style: cardStyle },
        h('strong', null, title),
        h('div', null,
          h('button', { style: buttonStyle, onClick: () => submit('approve') }, t('confirm.approve')),
          h('button', { style: buttonStyle, onClick: () => submit('reject') }, t('confirm.reject')),
        ),
      )
    }

    /** header.actions 的轻量入口按钮：点击弹出/聚焦工程面板（main slot 由 DSH keyed 机制呈现）。 */
    function EcPanelButton(props) {
      const t = useT()
      const [open, setOpen] = useState(false)
      return h('div', null,
        h('button', { style: buttonStyle, onClick: () => setOpen((v) => !v) }, t('openPanel')),
        open ? h(EcPanel, props) : null,
      )
    }

    /**
     * Client 上下文；注册字典与三个 slot，每个 inject 回调返回 register 的 disposer。
     * 只依赖 DSH 自带系统插件 ctx.locale（@deepseek-ai/dsh-client-locale）。
     * @param {{slots: object, locale?: object}} ctx Client 上下文
     */
    function apply(ctx) {
      const locale = ctx?.locale
      if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        // 注册命名空间字典（zh/en 齐全）；返回 disposer 交给 ctx.effect。
        ctx.effect(() => locale.register(NS, DICT), 'engineering-craft: locale 字典')
        const translate = locale.bind(NS)
        // LocaleRuntime 同时是 LocaleFace：subscribe/getSnapshot 订阅语言切换。
        const subscribe = typeof locale.subscribe === 'function'
          ? locale.subscribe.bind(locale)
          : (fn) => { if (typeof ctx.on === 'function') return ctx.on('locale/change', fn); return () => {} }
        const getSnapshot = typeof locale.getSnapshot === 'function'
          ? locale.getSnapshot.bind(locale)
          : () => locale
        localeSeat = { subscribe, getSnapshot, translate }
      }

      const slots = ctx?.slots
      if (!slots || typeof slots.register !== 'function' || typeof slots.inject !== 'function') return

      ctx.effect(() => slots.inject('main', () => slots.register({
        name: 'main', key: 'engineering-craft', order: 50,
        locale: localeSeat,
      }, EcPanel)), 'engineering-craft: main 面板')

      ctx.effect(() => slots.inject('conversation.session.header.actions', () => slots.register({
        name: 'conversation.session.header.actions',
        key: 'engineering-craft-open',
        order: 50,
        label: () => (localeSeat?.translate('openPanel') ?? DICT.zh.openPanel),
        title: () => (localeSeat?.translate('openPanel') ?? DICT.zh.openPanel),
        locale: localeSeat,
      }, EcPanelButton)), 'engineering-craft: header 入口')

      ctx.effect(() => slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay', key: 'engineering-craft-confirm', order: 100,
        locale: localeSeat,
      }, EcConfirmCard)), 'engineering-craft: 拍板确认卡')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
