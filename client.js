/**
 * client.js —— @local/dsh-engineering-craft 的 Client 半（由 package.json dsh.client 自动挂载）。
 * 由 window.__ModuleLoader__.load 懒注册：main keyed 面板、header.actions 入口、shell.overlay 确认人拍板卡。
 * React 从 require('react') 取；样式只用 --dsw-alias-* theme token；数据走 fetch('/api/engineering-craft/*')。
 * 文案走 DSH 自带系统插件 @deepseek-ai/dsh-client-locale 的命名空间字典（zh/en），切语言无需 reload。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-engineering-craft',

  /**
   * Client 懒工厂（无副作用）；React 与 locale 都从浏览器模块表取，禁止自带。
   * @param {(name: string) => any} require 浏览器模块表
   */
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useSyncExternalStore } = React

    // 本插件的命名空间字典（zh/en 都齐全，符合 dsh-client-locale 的 register 契约）。
    const NS = '@local/dsh-engineering-craft'
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
        'role.developerParallel': '研发 ×{n}（并行）',
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
        'role.developerParallel': 'Developer ×{n} (parallel)',
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
    // conversation.view tab 组件拿不到 projectRoot；由 conversation.input.left 探针按 sessionId
    // 问宿主 /api/engineering-craft/workspace 得到根，存这里并通知面板刷新（same-session 上下文）。
    let sessionRoot = null
    const rootSubs = new Set()
    const setSessionRoot = (p) => {
      if (typeof p !== 'string' || !p.trim() || p === sessionRoot) return
      sessionRoot = p.trim()
      for (const fn of rootSubs) { try { fn() } catch { /* 单个订阅者失败不影响其它 */ } }
    }

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
        sessionRoot,
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

      // 探针异步拿到会话工作区后通知面板重取（探针注册在 conversation.input.left）
      useEffect(() => {
        const fn = () => setVersion((v) => v + 1)
        rootSubs.add(fn)
        return () => rootSubs.delete(fn)
      }, [])

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
      const parallelRoles = Array.isArray(state.parallelRoles) ? state.parallelRoles : []
      const pipeline = h('ol', null, ROLE_KEYS.map((key) => {
        const handoff = state.pipeline?.handoffs?.[key]
        // 形态 B 下 developer 行显示并行单元数；其余岗位与其他状态一律不改。
        const label = key === 'developer' && parallelRoles.length > 0
          ? t('role.developerParallel').replace('{n}', String(parallelRoles.length))
          : t(`role.${key}`)
        return h('li', { key }, `${label}${handoff ? ' ✓' : ''}`)
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
      // hooks 必须在任何提前返回之前调用，保证每次渲染数量/顺序恒定（React 规则）。
      const submit = useCallback(async (decision, gate) => {
        const r = await api('/api/engineering-craft/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectRoot: root,
            kind: gate === 'go-no-go' ? 'go-no-go' : 'confirm-gate',
            gate,
            decision,
            userConfirmed: true,
          }),
        })
        if (r.ok !== false) setState((s) => ({ ...s, pendingConfirm: null }))
      }, [root])
      if (!pending) return null

      const title = pending.gate === 'go-no-go' ? t('confirm.goNoGo') : `${t('confirm.title')}：${pending.gate}`
      return h('div', { style: cardStyle },
        h('strong', null, title),
        h('div', null,
          h('button', { style: buttonStyle, onClick: () => submit('approve', pending.gate) }, t('confirm.approve')),
          h('button', { style: buttonStyle, onClick: () => submit('reject', pending.gate) }, t('confirm.reject')),
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
     * 隐藏探针（注册在 conversation.input.left）：该槽位每个会话都渲染，props 带 sessionId。
     * 拿 sessionId 问宿主当前工作区路径 → setSessionRoot → 面板重取。
     * 机制与 dsh-bili-scroll 的 ScopeProbe 一致（已验证可从 props 拿 sessionId）。
     */
    function WorkspaceProbe(props) {
      const sessionId = props?.sessionId
      useEffect(() => {
        if (!sessionId) return
        let alive = true
        api(`/api/engineering-craft/workspace?session=${encodeURIComponent(sessionId)}`).then((r) => {
          if (alive && r?.ok && r?.workspace?.path) setSessionRoot(r.workspace.path)
        })
        return () => { alive = false }
      }, [sessionId])
      return h('span', { 'data-ec-probe': '', style: { display: 'none' } })
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

      // DSH slot 标识字段按 slot 类型不同（实测样板）：
      //  - main 是 keyed slot，用 key（skill-explorer/ssh/im/settings/free-search 均如此）；
      //  - conversation.session.header.actions / shell.overlay 用 id（dsh-cost-meter 如此）。
      // 旧实现三处都用 key，导致 header 入口与确认卡被拒（BUG-06）；一度把 main 也改成 id，
      // 那会反过来破坏原本正确的 main 面板——故 main 恢复 key，另两处保持 id。
      ctx.effect(() => slots.inject('main', () => slots.register({
        name: 'main', key: 'engineering-craft', order: 50,
        locale: localeSeat,
      }, EcPanel)), 'engineering-craft: main 面板')

      // 入口放在「对话/轨迹/上下文/刷过的视频/编队」同一行 —— 该行是 conversation.view list 槽，
      // 壳子 viewTabs() 对每个注册项画一个 tab（证据：dsh-bili-scroll client.js 注释 + dsh-context
      // 的 context/fleet tab 都注册在此）。样板字段：{name:'conversation.view', id, order, label, scope:'session'}。
      // 曾误用 sidebar.right.pane.tab / sidebarRightTabs（那是右侧 studio 行，不是这里），已纠正。
      const TAB_ID = 'engineering-craft'
      const tabLabel = () => (localeSeat?.translate('panel.title') ?? DICT.zh['panel.title'])
      ctx.effect(() => slots.inject('conversation.view', () => {
        try {
          return slots.register({
            name: 'conversation.view',
            id: TAB_ID,
            order: 90,
            label: tabLabel(),
            scope: 'session',
            locale: localeSeat,
          }, (props) => h(EcPanel, { ...props, embedded: true }))
        } catch (e) {
          console.warn('[engineering-craft] conversation.view tab 注册降级：', e?.message ?? e)
          return () => {}
        }
      }), 'engineering-craft: 会话 tab 入口')

      // 隐藏探针：从会话上下文拿 sessionId → 查宿主工作区 → 面板得到 projectRoot。
      try {
        ctx.effect(() => slots.inject('conversation.input.left', () => slots.register({
          name: 'conversation.input.left', id: 'engineering-craft-scope', order: 5,
        }, (props) => h(WorkspaceProbe, props || {}))), 'engineering-craft: 工作区探针')
      } catch (e) {
        console.warn('[engineering-craft] 工作区探针注册降级：', e?.message ?? e)
      }

      ctx.effect(() => slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay', id: 'engineering-craft-confirm', order: 100,
        locale: localeSeat,
      }, EcConfirmCard)), 'engineering-craft: 拍板确认卡')
    }

    // 与 dsh-context 样板一致：factory 只声明 slots/locale；sidebarRightTabs 在 apply 内用 ctx.inject 动态取。
    return { inject: ['slots', 'locale'], apply }
  },
})
