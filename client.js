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
        'panel.handoffs': '交接物清单',
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
        'panel.parallelHint': '并行 {n} 单元',
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
        'panel.handoffs': 'Handoffs',
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
        'panel.parallelHint': '{n} units in parallel',
        'role.tester': 'Tester',
        'role.reviewer': 'Reviewer',
        'role.ops': 'Operations',
      },
    }

    const ROLE_KEYS = ['product', 'architect', 'developer', 'tester', 'reviewer', 'ops']
    const GATES = ['G1', 'G2', 'G3']
    // 交接物 → 岗位（与 gate-service.ARTIFACT_TO_ROLE 一致；progress 属研发接力，单列）。
    const ROLE_ARTIFACTS = {
      product: ['prd'],
      architect: ['adr', 'contract'],
      developer: ['plan', 'progress'],
      tester: ['testReport'],
      reviewer: ['brief', 'findings'],
      ops: ['release'],
    }

    // 语义色 token：优先宿主 alias 主题色，缺时用 color-mix 混出玻璃质感，跟着主题走。
    const ACCENT = 'var(--dsw-alias-fg-accent, var(--dsw-alias-text-accent, #7aa2f7))'
    const TRACK = 'var(--dsw-alias-border-subtle, rgba(136,136,136,.35))'
    const CYAN = 'var(--dsw-alias-fg-accent, #4dd0e1)'

    // 一次性注入 keyframes（内联 style 写不了动画；用唯一 id 防重复）。
    // 无 document 的环境（测试/SSR）安全跳过。
    let stylesInjected = false
    function ensureStyles() {
      if (stylesInjected || typeof document === 'undefined' || !document.head) return
      stylesInjected = true
      const id = 'dsh-engcraft-ui-styles'
      if (document.getElementById(id)) return
      const style = document.createElement('style')
      style.id = id
      style.textContent = [
        '@keyframes ec-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
        '@keyframes ec-pop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}',
        '@keyframes ec-flow{to{background-position:24px 0}}',
        '@keyframes ec-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, ' + ACCENT + ' 55%, transparent)}60%{box-shadow:0 0 0 7px color-mix(in srgb, ' + ACCENT + ' 0%, transparent)}}',
        '@keyframes ec-float{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(12px,-9px,0)}}',
        '@keyframes ec-sweep{0%{background-position:200% 0}100%{background-position:-200% 0}}',
        '@keyframes ec-pop-pulse{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}',
        // 卡片大范围极光横扫（纯 background-position 动画，任何 Chromium 都支持；不用 @property/mask）
        '@keyframes ec-aurora{0%{background-position:-160% 0}100%{background-position:260% 0}}',
        '.ec-rise{animation:ec-rise .45s cubic-bezier(.2,.8,.2,1) both}',
        '.ec-pop{animation:ec-pop .5s cubic-bezier(.2,.9,.3,1.3) both}',
        '.ec-flow{background-size:24px 100%;animation:ec-flow 1s linear infinite}',
        // 卡片极光带：一条斜向高光从左扫到右，盖在卡片上（宽 60%，逐渐淡出）
        '.ec-card::before{content:"";position:absolute;inset:0;border-radius:16px;pointer-events:none;'
          + 'background:linear-gradient(115deg,transparent 35%,color-mix(in srgb, ' + CYAN + ' 18%, transparent) 48%,'
          + 'color-mix(in srgb, ' + ACCENT + ' 22%, transparent) 52%,transparent 65%);'
          + 'background-size:220% 100%;animation:ec-aurora 6s ease-in-out infinite;opacity:.55}',
        // 漂浮光斑（右上角，柔和 blur，不遮左侧阶段文字）
        '.ec-card::after{content:"";position:absolute;width:170px;height:170px;right:-45px;top:-75px;border-radius:50%;'
          + 'background:radial-gradient(circle,color-mix(in srgb, ' + ACCENT + ' 24%, transparent),transparent 70%);'
          + 'filter:blur(10px);animation:ec-float 11s ease-in-out infinite;pointer-events:none}',
        // 激活/分叉节点的脉冲光环（先弹入再持续脉冲）
        '.ec-pop-pulse{animation:ec-pop .5s cubic-bezier(.2,.9,.3,1.3) both,ec-pulse 2s ease-out .5s infinite}',
        // 通过门药丸的扫光
        '.ec-sweep{background-size:200% 100%;animation:ec-sweep 3.2s linear infinite}',
        '@media(prefers-reduced-motion:reduce){.ec-rise,.ec-pop,.ec-flow,.ec-card::before,.ec-card::after,.ec-pop-pulse,.ec-sweep{animation:none!important}}',
      ].join('')
      document.head.appendChild(style)
    }

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

    // 全部配色走 --dsw-alias-* theme token（fallback 仅为 token 缺失时的中性色），跟随主题。
    const panelStyle = {
      padding: '18px 20px',
      color: 'var(--dsw-alias-fg-default, #e6e6e6)',
      background: 'var(--dsw-alias-bg-surface, transparent)',
      fontFamily: 'var(--dsw-alias-font-sans, inherit)',
      fontSize: '13px', lineHeight: 1.5,
    }
    const cardStyle = {
      position: 'relative', overflow: 'hidden',
      padding: '18px 20px',
      border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,.1))',
      borderRadius: '16px',
      // 大卡打底也用半透明层，让下层分区卡更贴合 dsh-context 的层叠质感
      background:
        `radial-gradient(circle at 6% 0%, color-mix(in srgb, ${ACCENT} 10%, transparent), transparent 46%),`
        + `radial-gradient(circle at 100% 100%, color-mix(in srgb, ${CYAN} 8%, transparent), transparent 42%),`
        + 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.28))',
      color: 'var(--dsw-alias-fg-default, inherit)',
      boxShadow: `0 8px 30px rgba(0,0,0,.2), inset 0 1px 0 var(--dsw-alias-border-subtle, rgba(255,255,255,.06))`,
      fontFamily: 'var(--dsw-alias-font-sans, inherit)',
    }
    const headStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '10px', marginBottom: '16px',
    }
    const titleStyle = {
      margin: 0, fontSize: '16px', fontWeight: 700, letterSpacing: '.3px',
      display: 'flex', alignItems: 'center', gap: '8px',
    }
    const iconDotStyle = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '28px', height: '28px', borderRadius: '9px',
      background: `linear-gradient(135deg, color-mix(in srgb, ${ACCENT} 30%, transparent), color-mix(in srgb, ${CYAN} 18%, transparent))`,
      color: ACCENT, fontSize: '15px',
      boxShadow: `0 0 0 1px color-mix(in srgb, ${ACCENT} 28%, transparent), 0 2px 10px color-mix(in srgb, ${ACCENT} 20%, transparent)`,
    }
    const iconBtnStyle = {
      width: '28px', height: '28px', padding: 0,
      border: '1px solid var(--dsw-alias-border-subtle, #8884)',
      borderRadius: '8px', background: 'transparent',
      color: 'var(--dsw-alias-fg-muted, var(--dsw-alias-fg-default, inherit))',
      fontSize: '15px', cursor: 'pointer', transition: 'transform .15s, opacity .15s',
    }
    const heroStyle = {
      display: 'flex', gap: '10px', marginBottom: '4px',
      padding: '14px 16px', borderRadius: '12px',
      // 更亮一层的玻璃卡（layer-2），浮在大卡之上
      background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.42))',
      border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,.1))',
      boxShadow: '0 3px 14px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04)',
    }
    const heroCellStyle = { flex: 1, minWidth: 0 }
    const heroLabelStyle = {
      fontSize: '11px', opacity: .6, textTransform: 'uppercase',
      letterSpacing: '.6px', marginBottom: '6px',
    }
    const badgeStyle = {
      display: 'inline-block', padding: '4px 12px', borderRadius: '999px',
      background: `linear-gradient(120deg, color-mix(in srgb, ${ACCENT} 16%, transparent), color-mix(in srgb, ${CYAN} 10%, transparent))`,
      color: ACCENT,
      border: `1px solid color-mix(in srgb, ${ACCENT} 32%, transparent)`,
      fontSize: '12px', fontWeight: 700,
      boxShadow: `inset 0 1px 0 color-mix(in srgb, ${ACCENT} 20%, transparent)`,
    }
    // 阶段值：静态不闪烁，用前景主色保证清晰可读（不依赖可能偏暗的 accent）
    const stageBadgeStyle = {
      display: 'inline-block', padding: '5px 13px', borderRadius: '999px',
      background: `linear-gradient(120deg, color-mix(in srgb, ${ACCENT} 22%, transparent), color-mix(in srgb, ${CYAN} 14%, transparent))`,
      color: 'var(--dsw-alias-fg-default, #e6e6e6)',
      border: `1px solid color-mix(in srgb, ${ACCENT} 40%, transparent)`,
      fontSize: '14px', fontWeight: 700, letterSpacing: '.2px',
      boxShadow: `inset 0 1px 0 color-mix(in srgb, ${ACCENT} 20%, transparent)`,
    }
    const nextRoleTextStyle = { fontSize: '14px', fontWeight: 600 }
    const blockedStyle = { fontSize: '11px', opacity: .7, marginTop: '3px' }
    // 分区小卡：半透明分层底色（dsh-context 的 layer-1/2 打法），深色下即一层层黑色玻璃卡
    const sectionStyle = {
      marginTop: '12px', padding: '12px 14px', borderRadius: '12px',
      background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.32))',
      border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,.08))',
      boxShadow: 'inset 0 1px 0 var(--dsw-alias-border-subtle, rgba(255,255,255,.05)), 0 2px 10px rgba(0,0,0,.12)',
    }
    const sectionTitleStyle = {
      fontSize: '11px', opacity: .6, textTransform: 'uppercase',
      letterSpacing: '.6px', marginBottom: '9px',
    }
    const gateRowStyle = { display: 'flex', gap: '8px', flexWrap: 'wrap' }
    const gateOnStyle = {
      padding: '5px 13px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
      background: `linear-gradient(120deg, color-mix(in srgb, ${ACCENT} 26%, transparent), color-mix(in srgb, ${CYAN} 14%, transparent))`,
      color: ACCENT,
      border: `1px solid color-mix(in srgb, ${ACCENT} 45%, transparent)`,
      boxShadow: `0 2px 10px color-mix(in srgb, ${ACCENT} 22%, transparent)`,
    }
    const gateOffStyle = {
      padding: '5px 12px', borderRadius: '999px', fontSize: '12px',
      background: 'transparent', opacity: .65,
      border: '1px solid var(--dsw-alias-border-subtle, #8884)',
    }
    const stepRowStyle = { display: 'flex', alignItems: 'flex-start', width: '100%' }
    const stepItemStyle = {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '6px', minWidth: '48px', textAlign: 'center',
    }
    const stepDotBase = {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '26px', height: '26px', borderRadius: '50%',
      fontSize: '12px', fontWeight: 700, boxSizing: 'border-box',
    }
    const stepDoneStyle = {
      ...stepDotBase,
      background: `linear-gradient(135deg, color-mix(in srgb, ${ACCENT} 32%, transparent), color-mix(in srgb, ${CYAN} 20%, transparent))`,
      color: ACCENT,
      border: `1px solid color-mix(in srgb, ${ACCENT} 50%, transparent)`,
      boxShadow: `0 0 12px color-mix(in srgb, ${ACCENT} 24%, transparent)`,
    }
    const stepActiveStyle = {
      ...stepDotBase,
      width: '30px', height: '30px',
      background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${CYAN} 32%, transparent), color-mix(in srgb, ${ACCENT} 20%, transparent))`,
      color: ACCENT,
      border: `2px solid ${ACCENT}`,
      boxShadow: `0 0 0 4px color-mix(in srgb, ${ACCENT} 16%, transparent), 0 0 16px color-mix(in srgb, ${ACCENT} 50%, transparent)`,
    }
    const stepPendingStyle = {
      ...stepDotBase,
      background: 'transparent', opacity: .5,
      border: '1px solid var(--dsw-alias-border-subtle, #8884)',
    }
    const stepLabelBase = { fontSize: '11px', whiteSpace: 'nowrap', opacity: .6 }
    const stepLabelActive = { ...stepLabelBase, fontWeight: 700, opacity: 1, color: ACCENT }
    const connectorBase = { flex: 1, height: '2px', margin: '13px 4px 0', background: TRACK, opacity: .5, borderRadius: '2px' }
    const connectorDone = {
      ...connectorBase, opacity: 1,
      background: `linear-gradient(90deg, color-mix(in srgb, ${ACCENT} 70%, transparent), color-mix(in srgb, ${CYAN} 70%, transparent), color-mix(in srgb, ${ACCENT} 70%, transparent))`,
    }
    // 并行岗位：一个大节点下挂多个并行小节点（分叉），用竖线汇聚
    const forkWrapStyle = {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '5px', minWidth: '56px', textAlign: 'center',
    }
    const forkNodeStyle = {
      ...stepDotBase,
      width: '30px', height: '30px',
      background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${CYAN} 32%, transparent), color-mix(in srgb, ${ACCENT} 20%, transparent))`,
      color: ACCENT,
      border: `2px solid ${ACCENT}`,
      boxShadow: `0 0 0 4px color-mix(in srgb, ${ACCENT} 16%, transparent), 0 0 16px color-mix(in srgb, ${ACCENT} 45%, transparent)`,
    }
    const forkBranchRowStyle = {
      display: 'flex', gap: '4px', justifyContent: 'center',
      paddingTop: '4px', borderTop: `1px dashed color-mix(in srgb, ${ACCENT} 45%, transparent)`,
      maxWidth: '84px', flexWrap: 'wrap',
    }
    const forkLeafStyle = {
      padding: '2px 6px', borderRadius: '6px', fontSize: '10px',
      fontFamily: 'var(--dsw-alias-font-mono, monospace)',
      background: `color-mix(in srgb, ${ACCENT} 18%, transparent)`,
      color: ACCENT,
      border: `1px solid color-mix(in srgb, ${ACCENT} 40%, transparent)`,
      whiteSpace: 'nowrap',
    }
    const artifactGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }
    const artifactGroupStyle = {
      padding: '9px 11px', borderRadius: '10px',
      background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.3))',
      border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,.08))',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)',
    }
    const artifactGroupHeadStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: '11px', fontWeight: 700, marginBottom: '7px', opacity: .9,
    }
    const artifactCountStyle = { fontSize: '10px', opacity: .6, fontFamily: 'var(--dsw-alias-font-mono, monospace)' }
    const artifactItemsStyle = { display: 'flex', gap: '5px', flexWrap: 'wrap' }
    const artifactDoneStyle = {
      padding: '3px 8px', borderRadius: '6px', fontSize: '10px',
      fontFamily: 'var(--dsw-alias-font-mono, monospace)',
      background: `color-mix(in srgb, ${ACCENT} 20%, transparent)`,
      color: ACCENT,
      border: `1px solid color-mix(in srgb, ${ACCENT} 40%, transparent)`,
    }
    const artifactMissingStyle = {
      padding: '3px 8px', borderRadius: '6px', fontSize: '10px',
      fontFamily: 'var(--dsw-alias-font-mono, monospace)',
      background: 'transparent', opacity: .75,
      border: '1px dashed var(--dsw-alias-border-subtle, #8884)',
    }
    const planItemStyle = {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-subtle, #8883)',
    }
    const mutedStyle = { opacity: .55 }
    const confirmTitleStyle = { fontSize: '15px', fontWeight: 700, marginBottom: '14px' }
    const confirmBtnBase = {
      padding: '7px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
      cursor: 'pointer', transition: 'opacity .15s',
    }
    const confirmApproveStyle = {
      ...confirmBtnBase,
      background: 'var(--dsw-alias-bg-accent, rgba(127,127,127,.2))',
      color: 'var(--dsw-alias-fg-accent, inherit)',
      border: '1px solid var(--dsw-alias-bg-accent, transparent)',
    }
    const confirmRejectStyle = {
      ...confirmBtnBase,
      background: 'transparent',
      color: 'var(--dsw-alias-fg-default, inherit)',
      border: '1px solid var(--dsw-alias-border-subtle, #8884)',
    }
    /** 主面板：显示阶段 / 三门 / PLAN / 六岗位树；只读 EcState。 */
    function EcPanel(props) {
      ensureStyles()
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

      const stageName = state.stage ?? '-'
      const nextRole = state.nextRole ?? state.pipeline?.role ?? null
      const parallelRoles = Array.isArray(state.parallelRoles) ? state.parallelRoles : []
      const nextLabel = nextRole === 'developer' && parallelRoles.length > 0
        ? t('role.developerParallel').replace('{n}', String(parallelRoles.length))
        : (nextRole ? t(`role.${nextRole}`) : t('panel.none'))
      const blocked = state.blockedBy

      // 阶段门药丸：过的亮、没过的暗
      const gatePills = h('div', { style: gateRowStyle }, GATES.map((g) => {
        const passed = Boolean(state.gates?.[g]?.passed)
        return h('span', {
          key: g,
          className: passed ? 'ec-sweep' : undefined,
          title: passed ? t('panel.gatePassed') : t('panel.gatePending'),
          style: passed ? gateOnStyle : gateOffStyle,
        }, `${g} ${passed ? '✓' : '○'}`)
      }))

      // 岗位流水线步骤条：以当前 nextRole 定位 active，已产出交接物的标 done。
      // 研发岗在形态 B（mode==='B' 且并行单元非空）时画成分叉节点：主节点下挂多个并行叶子。
      const modeB = state.mode === 'B' && nextRole === 'developer' && parallelRoles.length > 0
      const roleIdx = Math.max(0, ROLE_KEYS.indexOf(nextRole))
      const steps = []
      ROLE_KEYS.forEach((key, i) => {
        const handoff = state.pipeline?.handoffs?.[key]
        const isDone = Boolean(handoff) || (nextRole && i < roleIdx)
        const isActive = nextRole ? i === roleIdx : false
        const isFork = modeB && key === 'developer'
        const circleStyle = isActive ? stepActiveStyle : (isDone ? stepDoneStyle : stepPendingStyle)
        const idxLabel = isDone && !isActive ? '✓' : String(i + 1)
        if (isFork) {
          // 分叉节点：主圆点 + 下方并行单元叶子条
          steps.push(h('div', { key: key, style: forkWrapStyle },
            h('div', { className: 'ec-pop-pulse', style: forkNodeStyle }, '⚡'),
            h('div', { style: isActive ? stepLabelActive : stepLabelBase },
              t('role.developerParallel').replace('{n}', String(parallelRoles.length))),
            h('div', { style: forkBranchRowStyle }, parallelRoles.map((u) =>
              h('span', { key: String(u), style: forkLeafStyle }, String(u)))),
          ))
        } else {
          steps.push(h('div', { key: key, style: stepItemStyle },
            h('div', { className: isActive ? 'ec-pop-pulse' : undefined, style: circleStyle }, idxLabel),
            h('div', { style: isActive ? stepLabelActive : stepLabelBase }, t(`role.${key}`)),
          ))
        }
        if (i < ROLE_KEYS.length - 1) {
          const connDone = isDone && i + 1 < roleIdx
          steps.push(h('div', {
            key: `${key}-conn`,
            className: connDone ? 'ec-flow' : undefined,
            style: connDone ? connectorDone : connectorBase,
          }))
        }
      })

      // 交接物：按岗位分组的小卡，每项 ✓ 已交 / ○ 缺失（替代原来的平铺 chips）
      const artifacts = state.artifacts ?? {}
      const artifactCards = h('div', { style: artifactGridStyle }, ROLE_KEYS.map((role) => {
        const keys = ROLE_ARTIFACTS[role]
        const doneCount = keys.filter((k) => artifacts[k]).length
        return h('div', { key: role, style: artifactGroupStyle },
          h('div', { style: artifactGroupHeadStyle },
            h('span', null, t(`role.${role}`)),
            h('span', { style: artifactCountStyle }, `${doneCount}/${keys.length}`),
          ),
          h('div', { style: artifactItemsStyle }, keys.map((k) => {
            const done = Boolean(artifacts[k])
            return h('span', {
              key: k, title: k,
              style: done ? artifactDoneStyle : artifactMissingStyle,
            }, `${done ? '✓' : '○'} ${k}`)
          })),
        )
      }))

      // 计划单元列表
      const plans = Array.isArray(state.plan) && state.plan.length
        ? h('div', null, state.plan.map((u) => h('div', { key: u.id, style: planItemStyle },
          h('span', { style: badgeStyle }, u.id),
          h('span', null, u.target ?? ''),
          h('span', { style: mutedStyle }, `[${u.status ?? '-'}]`),
        )))
        : h('span', { style: mutedStyle }, t('panel.none'))

      return h('div', { className: 'ec-card', style: cardStyle },
        // 头部：标题 + 刷新
        h('div', { style: headStyle },
          h('h3', { style: titleStyle },
            h('span', { className: 'ec-pop', style: iconDotStyle }, '⚙'),
            t('panel.title'),
          ),
          h('button', {
            style: iconBtnStyle, title: t('panel.refresh'), 'aria-label': t('panel.refresh'),
            onClick: () => setVersion((v) => v + 1),
            onMouseEnter: (e) => { e.currentTarget.style.transform = 'rotate(45deg)' },
            onMouseLeave: (e) => { e.currentTarget.style.transform = '' },
          }, '⟳'),
        ),
        // Hero：阶段 + 下一岗位（错落入场）
        h('div', { className: 'ec-rise', style: { ...heroStyle, animationDelay: '0ms' } },
          h('div', { style: heroCellStyle },
            h('div', { style: heroLabelStyle }, t('panel.stage')),
            h('span', { style: stageBadgeStyle }, stageName),
          ),
          h('div', { style: heroCellStyle },
            h('div', { style: heroLabelStyle }, t('panel.nextRole')),
            h('div', { style: nextRoleTextStyle }, nextLabel),
            blocked ? h('div', { style: blockedStyle }, `${t('panel.blockedBy')}：${blocked}`) : null,
          ),
        ),
        // 阶段门
        h('div', { className: 'ec-rise', style: { ...sectionStyle, animationDelay: '60ms' } },
          h('div', { style: sectionTitleStyle }, t('panel.gates')),
          gatePills,
        ),
        // 岗位流水线步骤条
        h('div', { className: 'ec-rise', style: { ...sectionStyle, animationDelay: '120ms' } },
          h('div', { style: sectionTitleStyle }, t('panel.pipeline')),
          h('div', { style: stepRowStyle }, steps),
        ),
        // 缺失交接物
        h('div', { className: 'ec-rise', style: { ...sectionStyle, animationDelay: '180ms' } },
          h('div', { style: sectionTitleStyle }, t('panel.handoffs')),
          artifactCards,
        ),
        // 计划
        h('div', { className: 'ec-rise', style: { ...sectionStyle, animationDelay: '240ms' } },
          h('div', { style: sectionTitleStyle }, t('panel.plan')),
          plans,
        ),
      )
    }

    /** 人拍板确认卡：只有 state.pendingConfirm 非空时才显示。 */
    function EcConfirmCard(props) {
      ensureStyles()
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

      const isGoNoGo = pending.gate === 'go-no-go'
      const title = isGoNoGo ? t('confirm.goNoGo') : `${t('confirm.title')}：${pending.gate}`
      return h('div', { style: { ...cardStyle, borderColor: 'var(--dsw-alias-bg-accent, #888)' } },
        h('div', { style: headStyle },
          h('div', { style: confirmTitleStyle },
            h('span', { style: { ...iconDotStyle, background: 'var(--dsw-alias-bg-accent, rgba(127,127,127,.2))' } }, isGoNoGo ? '🚀' : '✋'),
            ' ', title,
          ),
        ),
        h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px' } },
          h('button', {
            style: confirmApproveStyle,
            onClick: () => submit('approve', pending.gate),
            onMouseEnter: (e) => { e.currentTarget.style.opacity = '.85' },
            onMouseLeave: (e) => { e.currentTarget.style.opacity = '1' },
          }, isGoNoGo ? t('confirm.goNoGo') : t('confirm.approve')),
          h('button', {
            style: confirmRejectStyle,
            onClick: () => submit('reject', pending.gate),
            onMouseEnter: (e) => { e.currentTarget.style.opacity = '.7' },
            onMouseLeave: (e) => { e.currentTarget.style.opacity = '1' },
          }, t('confirm.reject')),
        ),
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
