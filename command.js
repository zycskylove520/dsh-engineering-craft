/**
 * command.js —— /ec 子命令（CONTRACT §6，防御性注册）。
 * 核心能力在 tools/能力层，命令是便利层：ctx.commands 不存在或注册失败都不阻断插件激活。
 */
import { ecGate } from './tools.js'
import { metricsAction } from './metrics.js'
import { memoryAction } from './memory.js'
import { normalizeProjectRoot } from './gate-service.js'

/**
 * 解析并执行一行 /ec 子命令（纯逻辑，便于 Host 与 HTTP action 复用）。
 * @param {string} line 形如 "/ec status"、"gate G2"、"memory init"
 * @param {string} [projectRoot] 项目根，缺省 cwd
 * @param {{capabilities?: {subagent?: boolean}, thresholds?: {minFilesForParallel?: number}}} [opts]
 *   形态 B 三道门参数；缺省沿用 ec_stage 的判定（能力门默认开、阈值 2）
 * @returns {object} 结构化结果（含 ok / 各子命令字段）
 */
export function runEcCommand(line, projectRoot, opts = {}) {
  const root = normalizeProjectRoot(projectRoot)
  const parts = String(line ?? '').trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] === '/ec' ? parts[1] : parts[0]) ?? 'status'
  const rest = parts.slice(parts[0] === '/ec' ? 2 : 1)

  if (sub === 'status') {
    const state = ecGate.read(root)
    const role = ecGate.nextRole(root, opts)
    return {
      ok: true, command: 'status', stage: state.stage,
      gates: Object.fromEntries(Object.entries(state.gates).map(([g, v]) => [g, v.passed])),
      role: role.role, mode: role.mode ?? 'A', parallelRoles: role.roles ?? [],
      blockedBy: role.blockedBy ?? null,
      missingArtifacts: Object.entries(state.artifacts).filter(([, v]) => !v).map(([k]) => k),
    }
  }
  if (sub === 'next') {
    const role = ecGate.nextRole(root, opts)
    return {
      ok: true, command: 'next', ...role,
      mode: role.mode ?? 'A', parallelRoles: role.roles ?? [], ready: Boolean(role.role),
    }
  }
  if (sub === 'gate') {
    const gate = (rest[0] ?? '').toUpperCase()
    if (!['G1', 'G2', 'G3'].includes(gate)) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '用法：/ec gate <G1|G2|G3> [evidence]' } }
    }
    if (gate === 'G3') {
      const evidence = rest.slice(1).join(' ')
      const sep = evidence.indexOf('::')
      const r = ecGate.confirmG3(root, {
        command: (sep >= 0 ? evidence.slice(0, sep) : evidence).trim(),
        outputDigest: (sep >= 0 ? evidence.slice(sep + 2) : '').trim(),
      })
      return r.ok ? { ok: true, command: 'gate', ...r.value } : r
    }
    // G1/G2 需人拍板：命令里只有用户显式 --confirm 才放行（agent 不得代批）。
    if (!rest.includes('--confirm')) {
      return { ok: false, error: { code: 'NOT_USER_CONFIRMED', message: `门 ${gate} 须人拍板：请点确认卡或用 /ec gate ${gate} --confirm`, details: { gate } } }
    }
    const r = ecGate.confirmGate(root, gate)
    return r.ok ? { ok: true, command: 'gate', ...r.value } : r
  }
  if (sub === 'metrics') {
    return { ...metricsAction({ action: 'list', limit: Number(rest[0]) || 20, projectRoot: root }), command: 'metrics' }
  }
  if (sub === 'memory') {
    const action = rest[0] ?? 'query'
    const layer = rest[1]
    const query = rest.slice(2).join(' ') || undefined
    return { ...memoryAction({ action, layer, query, projectRoot: root }), command: 'memory' }
  }
  return { ok: false, error: { code: 'INVALID_INPUT', message: `未知 /ec 子命令 ${sub}`, details: { sub } } }
}

/**
 * 把 /ec 命令注册进 Host（防御性）。
 * @param {object} ctx Cordis Context；commands 服务可选
 * @returns {() => void} disposer（注销命令；ctx.commands 缺失时为 no-op）
 */
export function registerEcCommand(ctx) {
  // cordis 的 ctx.<service> 对未 inject 的服务会直接抛，必须用 ctx.get 容错获取。
  let commands
  try {
    commands = typeof ctx?.get === 'function' ? ctx.get('commands') : ctx?.commands
  } catch { commands = undefined }
  if (!commands || typeof commands.register !== 'function') return () => {}
  try {
    const dispose = commands.register({
      name: '/ec',
      description: '工程套件统一入口：status / next / gate / metrics / memory',
      async execute(agent, line) {
        try {
          return runEcCommand(line)
        } catch (e) {
          return { ok: false, error: { code: 'INVALID_INPUT', message: String(e?.message ?? e) } }
        }
      },
    })
    return typeof dispose === 'function' ? dispose : () => {}
  } catch (e) {
    // 命令是便利层；注册失败只降级，不影响工具/面板。错误不静默：打印到宿主控制台。
    console.warn('[engineering-craft] /ec 命令注册失败，已降级：', e?.message ?? e)
    return () => {}
  }
}
