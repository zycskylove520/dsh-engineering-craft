/**
 * index.js —— @local/dsh-engineering-craft 的 host 半入口（单 row，统一注册全部 host 能力）。
 * ⭐ optional peer 容错：@deepseek-ai/dsh-tools 的 defineTool 与 schemastery 的 z 都从宿主树找，
 *    找不到就本地兜底 / Config=undefined，绝不因一个 import 让整条插件不激活（证据：dsh-bili-scroll）。
 * 门状态存 <projectRoot>/.engineering-craft/state.json；Client 经 /api/engineering-craft/* 读写。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import EcGate, { DEFAULT_GATES, normalizeProjectRoot, safePathWithin, resolveAllowedRoot, statePathOf, setRoleDefaults } from './gate-service.js'
import { ECO_TOOLS, ecGate } from './tools.js'
import { registerEcCommand, runEcCommand } from './command.js'
import { metricsAction } from './metrics.js'

/** 插件自己那棵树（optionalDependencies 装出来的那份），用模块位置算，不依赖 cwd。 */
const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

/**
 * 可能藏着宿主 @deepseek-ai 包的地方（不写死某台机器，按可能性排序）。
 * @returns {string[]} 候选根
 */
function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)
  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch { /* 没有就算了 */ }
  }
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  try {
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }
  push(SELF_MODULES)
  return out
}

/** 按包的 exports['.'] 找入口文件，返回 file:// URL。 */
function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string'
      ? dot
      : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

/** 试从宿主树 import 一个包；拿不到返回 null。 */
async function fromHostTree(name) {
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue
    const url = entryUrlFor(root, name)
    if (!url) continue
    try { return await import(url) } catch { /* 换下一个 */ }
  }
  return null
}

/** 本地等价 defineTool：做 parameters/output.schema 的 additionalProperties 校验后原样返回。 */
function localDefineTool(options) {
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      throw new Error(`defineTool(${options.name}): ${where} 是 object 却没写 additionalProperties`)
    }
    for (const [k, v] of Object.entries(schema.properties || {})) check(v, `${where}.properties.${k}`)
  }
  check(options.parameters, 'parameters')
  check(options.output?.schema, 'output.schema')
  return options
}

/** 容错加载 host deps：宿主树 → 自身依赖 → 本地兜底。 */
async function loadHostDeps() {
  let zMod = await fromHostTree('schemastery')
  if (!zMod) {
    try { zMod = await import('@deepseek-ai/schemastery') } catch { zMod = null }
  }
  const z = zMod?.default ?? zMod ?? null

  let dtMod = await fromHostTree('dsh-tools')
  if (!dtMod) {
    try { dtMod = await import('@deepseek-ai/dsh-tools') } catch { dtMod = null }
  }
  const defineTool = dtMod?.defineTool || localDefineTool
  return { z, defineTool }
}

const hostDeps = await loadHostDeps()
/** schemastery 取不到时 Config=undefined，插件照常加载、设置页降级。 */
export const Config = !hostDeps.z ? undefined : hostDeps.z.object({
  gates: hostDeps.z.object({
    G1: hostDeps.z.object({
      requiredArtifacts: hostDeps.z.array(hostDeps.z.string()),
      requireUserConfirm: hostDeps.z.boolean(),
      requireEvidence: hostDeps.z.boolean(),
    }),
    G2: hostDeps.z.object({
      requiredArtifacts: hostDeps.z.array(hostDeps.z.string()),
      requireUserConfirm: hostDeps.z.boolean(),
      requireEvidence: hostDeps.z.boolean(),
    }),
    G3: hostDeps.z.object({
      requiredArtifacts: hostDeps.z.array(hostDeps.z.string()),
      requireUserConfirm: hostDeps.z.boolean(),
      requireEvidence: hostDeps.z.boolean(),
    }),
  }).default(DEFAULT_GATES).extra('volatile', true),
  thresholds: hostDeps.z.object({
    minFilesForParallel: hostDeps.z.natural(),
    minUnitsForWorkflow: hostDeps.z.natural(),
  }).default({ minFilesForParallel: 2, minUnitsForWorkflow: 6 }).extra('volatile', true),
  paths: hostDeps.z.object({
    memoryDirName: hostDeps.z.string(),
    artifactsRoot: hostDeps.z.string(),
  }).default({ memoryDirName: '.project_memory', artifactsRoot: '.' }).extra('volatile', true),
})

/** 仅列必须存在的 service：可选 service（commands/systemPrompt）一律用 ctx.get 容错取。 */
export const inject = ['tools', 'webServer']

/** textOutput：把工具返回的普通对象渲染成文本（dsh-bili-scroll 实测写法）。 */
const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
}

/** 无损 JSON 化：宿主只吃 lossless JSON，函数/循环引用会报 value is not lossless JSON。 */
const safe = (v) => {
  if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
}

/**
 * 计算人拍板待办（作为 GET state 的视图增强，不改 EcState 落盘结构）。
 * @param {object} state 当前 EcState
 * @returns {{gate: string}|null} 需要人拍板的门；无需拍板时 null
 */
export function pendingConfirmOf(state) {
  const artifacts = state?.artifacts || {}
  const gates = state?.gates || {}
  // confirmedBy 在初始态恒为 'user'（CONTRACT §9），不能用它判断"人是否已拍板"；at 才是确认时间戳。
  if (artifacts.prd && !gates.G1?.passed && !gates.G1?.at) return { gate: 'G1' }
  if (artifacts.adr && artifacts.contract && !gates.G2?.passed && !gates.G2?.at) return { gate: 'G2' }
  // go/no-go 是 ops 的准出门：评审交接物齐或 RELEASE.md 已落盘即应可见；
  // stage 不会自动走到 release（release 只在批准后才赋值），因此不能以 stage==='release' 为条件。
  if (!state?.releaseDecision
    && (state?.stage === 'delivery' || (artifacts.brief && artifacts.findings) || artifacts.release)) {
    return { gate: 'go-no-go' }
  }
  return null
}

/**
 * 插件入口：在一个 apply 内注册全部 host 能力。
 * @param {import('cordis').Context} ctx 插件上下文
 * @param {object} config 已校验的插件 Config
 */
export function apply(ctx, config) {
  // 门规则可被 Config 覆盖（缺省用 DEFAULT_GATES）。
  if (config?.gates) ecGate.gates = { ...DEFAULT_GATES, ...config.gates }
  // Config 阈值注入形态 B 默认（纯内存）；tools/command 经 EcGate.nextRole 统一读取。
  if (config?.thresholds) setRoleDefaults({ thresholds: config.thresholds })

  const defineTool = hostDeps.defineTool
  // 四个工具统一注册；textOutput + 无损 JSON 包装（dsh-bili-scroll 实测样板）。
  for (const spec of ECO_TOOLS) {
    ctx.tools.register(defineTool({
      ...spec,
      output: spec.output || textOutput,
      async execute(args, exec) { return safe(await spec.execute(args, exec)) },
    }))
  }

  // /ec 命令：便利层，失败不阻断激活。
  ctx.effect(() => registerEcCommand(ctx), 'engineering-craft: /ec 命令')

  // systemPrompt 注入：可选 service，用 ctx.get 容错取（cordis 的 ctx.<未 inject 服务> 会直接抛）。
  try {
    const sp = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined
    if (sp && typeof sp.section === 'function') {
      ctx.effect(() => sp.section({
        key: 'engineering-craft',
        render: () => ecGate.promptSection(process.cwd()),
      }), 'engineering-craft: prompt 门状态')
    }
  } catch (e) {
    console.warn('[engineering-craft] systemPrompt.section 注册失败，已降级：', e?.message ?? e)
  }

  const sendJson = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }
  const readBody = (req) => new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    req.on('data', (c) => {
      bytes += c.length
      if (bytes > 1_000_000) { finish({}); req.destroy(); return }
      chunks.push(c)
    })
    // 收集 Buffer 后一次 UTF-8 解码：避免中文跨 chunk 被拆成乱码。
    req.on('end', () => { try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { finish({}) } })
    req.on('error', () => finish({}))
  })

  /** loopback + 同源栅栏（dsh-bili-scroll sameOriginOk/fenceReject 思路）。 */
  const sameOriginOk = (req) => {
    const remote = String(req.socket?.remoteAddress ?? '')
    if (remote && remote !== '::1' && remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') return false
    const host = String(req.headers.host || '')
    if (!host) return true
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return false
    const pick = String(req.headers.origin || req.headers.referer || '')
    if (!pick) return true
    try {
      const u = new URL(pick)
      return String(u.host || '').toLowerCase() === String(host).toLowerCase()
    } catch { return false }
  }
  let fence = null
  let fenceTried = false
  const getFence = () => {
    if (fenceTried) return fence
    fenceTried = true
    for (const fn of [
      () => (typeof ctx.get === 'function' ? ctx.get('connection') : null),
      () => Reflect.get(ctx, 'connection'),
      () => ctx.root?.connection,
    ]) {
      try {
        const c = fn()
        if (c && typeof c.requestRejection === 'function') { fence = c; break }
      } catch { /* 换下一个 */ }
    }
    return fence
  }
  const fenceReject = (req, res) => {
    const conn = getFence()
    if (!conn) return false
    try {
      const rejection = conn.requestRejection({ headers: req.headers })
      if (rejection === undefined) return false
      res.statusCode = typeof rejection === 'number' ? rejection : 403
      res.end()
      return true
    } catch {
      res.statusCode = 403
      res.end()
      return true
    }
  }

  /** 统一项目根校验：须落在显式允许根集合内（EC_ALLOWED_ROOTS，缺省 cwd），与工具层同策略。 */
  const resolveRoot = (input) => resolveAllowedRoot(input)

  /** POST action 的业务分发：与 /ec 命令共用门逻辑，人拍板动作保持用户专属。 */
  const runAction = (body) => {
    const root = resolveRoot(body.projectRoot)
    if (!root) return { ok: false, error: { code: 'PATH_OUT_OF_ROOT', message: 'projectRoot 非法' } }
    if (body.kind === 'next-role') return { ok: true, ...ecGate.nextRole(root) }
    if (body.kind === 'metrics') return metricsAction({ action: 'list', limit: body.limit ?? 20, projectRoot: root })
    if (body.kind === 'gate' || body.kind === 'confirm-gate') {
      const gate = String(body.gate ?? '').toUpperCase()
      if (gate === 'G3') {
        return ecGate.confirmG3(root, { command: String(body.command ?? ''), outputDigest: String(body.outputDigest ?? '') })
      }
      if (body.userConfirmed !== true) {
        return { ok: false, error: { code: 'NOT_USER_CONFIRMED', message: '须由确认卡点过（userConfirmed=true）', details: { gate } } }
      }
      // 人拍板确认卡有「退回」按钮：decision=reject 时不得放行门、不得推进阶段。
      // 旧实现忽略 decision，点「退回」与点「确认」等价，语义反转（BUG-04）。
      if (body.decision === 'reject') {
        const state = ecGate.read(root)
        try {
          metricsAction({ action: 'record', gate, outcome: 'blocked', reason: '人拍板退回', projectRoot: root })
        } catch { /* 度量是旁路，写失败不影响打回语义 */ }
        return {
          ok: true, decision: 'reject', gate,
          stage: state.stage,
          gates: Object.fromEntries(Object.entries(state.gates).map(([g, v]) => [g, v.passed])),
        }
      }
      return ecGate.confirmGate(root, gate, {})
    }
    if (body.kind === 'go-no-go') {
      if (body.userConfirmed !== true) {
        return { ok: false, error: { code: 'NOT_USER_CONFIRMED', message: 'go/no-go 只能由人拍板', details: {} } }
      }
      const state = ecGate.read(root)
      state.releaseDecision = body.decision === 'approve' ? 'go' : 'no-go'
      state.stage = state.releaseDecision === 'go' ? 'release' : 'delivery'
      state.updatedAt = Date.now()
      try {
        // write() 只返回落盘路径（字符串），不可展开；响应要带 EcState 摘要与门状态。
        ecGate.write(state)
        return {
          ok: true, decision: state.releaseDecision,
          stage: state.stage,
          gates: Object.fromEntries(Object.entries(state.gates).map(([g, v]) => [g, v.passed])),
        }
      }
      catch (e) { return { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: String(e?.message ?? e) } } }
    }
    // 与 ec_stage 工具保持一致：HTTP action 也允许调用方显式覆盖并行判据（不传则用 Config 默认）。
    if (body.kind === 'command') {
      const opts = {}
      if (body.capabilities && typeof body.capabilities === 'object') opts.capabilities = body.capabilities
      if (body.thresholds && typeof body.thresholds === 'object') opts.thresholds = body.thresholds
      return runEcCommand(String(body.line ?? ''), root, opts)
    }
    return { ok: false, error: { code: 'INVALID_INPUT', message: `未知 action kind ${body.kind}` } }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/engineering-craft',
    /**
     * @param {object} req HTTP 请求
     * @param {object} res HTTP 响应
     */
    async handler(req, res) {
      if (fenceReject(req, res)) return
      if (!sameOriginOk(req)) return sendJson(res, 403, { ok: false, error: '只接受本机同源请求' })
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        // 会话 → 工作区路径：面板 tab（conversation.view）拿不到 projectRoot，只能拿 sessionId，
        // 由宿主查 workspaceRegistry（与 dsh-bili-scroll session-scope 同一已验证机制）。
        if (req.method === 'GET' && url.pathname === '/api/engineering-craft/workspace') {
          const sid = String(url.searchParams.get('session') || '').trim()
          let workspace = null
          try {
            const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
            for (const w of (registry?.list?.() || [])) {
              if ((w?.sessionIds || []).some((x) => String(x) === sid)) {
                workspace = { path: String(w.path || ''), title: String(w.title || '') }
                break
              }
            }
          } catch { /* 注册表不可用 → 返回空，面板显示"未检测到项目根"，不崩 */ }
          return sendJson(res, 200, { ok: true, session: sid, workspace })
        }
        if (req.method === 'GET' && url.pathname === '/api/engineering-craft/state') {
          const input = url.searchParams.get('projectRoot')
          const root = resolveRoot(input)
          if (!root) return sendJson(res, 400, { ok: false, error: { code: 'PATH_OUT_OF_ROOT', message: 'projectRoot 非法或未传' } })
          const state = ecGate.read(root)
          const next = ecGate.nextRole(root)
          return sendJson(res, 200, {
            ...state,
            nextRole: next.role ?? null,
            mode: next.mode ?? 'A',
            parallelRoles: next.roles ?? [],
            pendingConfirm: pendingConfirmOf(state),
          })
        }
        if (req.method === 'POST' && url.pathname === '/api/engineering-craft/action') {
          const body = await readBody(req)
          const result = runAction(body)
          return sendJson(res, result.ok ? 200 : 400, safe(result))
        }
        return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${url.pathname}` })
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message ?? e) })
      }
    },
  }), 'engineering-craft: /api/engineering-craft 路由')
}

/** 供外部查询状态文件路径（测试/排障用）。 */
export { statePathOf }
