/**
 * command.js —— /ec 子命令（CONTRACT §6，防御性注册）。
 * 核心能力在 tools/能力层，命令是便利层：ctx.commands 不存在或注册失败都不阻断插件激活。
 * 所有错误统一走 ecError（领域错误白名单 + 系统异常包装），不冒用 INVALID_INPUT。
 */
import { ecGate } from './tools.js'
import { metricsAction } from './metrics.js'
import { memoryAction, LAYERS } from './memory.js'
import { ecError, resolveAllowedRoot, DOMAIN_CODES } from './gate-service.js'
import { readActiveRoot, writeActiveRoot, clearActiveRoot } from './active-root.js'

/**
 * 解析并执行一行 /ec 子命令（纯逻辑，便于 Host 与 HTTP action 复用）。
 * @param {string} line 形如 "/ec status"、"gate G2"、"memory init"
 * @param {string} [projectRoot] 项目根，缺省 cwd
 * @param {{capabilities?: {subagent?: boolean}, thresholds?: {minFilesForParallel?: number}}} [opts]
 *   形态 B 三道门参数；缺省沿用 ec_stage 的判定（能力门默认开、阈值 2）
 * @returns {object} 结构化结果（含 ok / 各子命令字段）
 */
export function runEcCommand(line, projectRoot, opts = {}) {
  // projectRoot 是文本标签（本机或远端路径均可）：只做规范化，不做白名单/存在性校验。
  const root = resolveAllowedRoot(projectRoot ?? process.cwd())
  if (!root) {
    return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签（须非空字符串）', { projectRoot }) }
  }
  const parts = String(line ?? '').trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] === '/ec' ? parts[1] : parts[0]) ?? 'status'
  const rest = parts.slice(parts[0] === '/ec' ? 2 : 1)

  try {
    // P0-3：确认并持久化"当前工程根"。/ec use <path> 只在用户显式调用时执行；
    // promptSection 读它，避免用 process.cwd() 注入错项目的阶段/门数字。
    if (sub === 'use') {
      const target = rest.join(' ')
      if (!target) {
        return { ok: true, command: 'use', root: readActiveRoot(), hint: '用法：/ec use <项目根>；/ec use clear 清除' }
      }
      if (target === 'clear') {
        const r = clearActiveRoot()
        return { ...r, command: 'use', root: null }
      }
      const r = writeActiveRoot(target)
      return { ...r, command: 'use' }
    }
    if (sub === 'which') {
      return { ok: true, command: 'which', root: readActiveRoot() }
    }
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
    if (sub === 'new-task') {
      // 识别到新需求时由 agent 主动调用：归档旧 state + 重置六岗；工程记忆不动。
      const r = ecGate.resetForNewTask(root)
      return r.ok ? { ok: true, command: 'new-task', archived: r.value.archived, stage: r.value.state.stage, state: r.value.state } : r
    }
    // 纪律落地：红灯/绿灯/验证/G3 证据共用 --test/--cmd/--out 旗标（与 ec_stage 同形）。
    const flag = (name) => {
      const i = rest.findIndex((a) => a === `--${name}`)
      return i >= 0 ? rest[i + 1] : undefined
    }
    if (sub === 'tdd' || sub === 'green' || sub === 'verify') {
      let r
      if (sub === 'tdd') r = ecGate.recordTdd(root, { failingTest: flag('test'), outputDigest: flag('out') })
      else if (sub === 'green') r = ecGate.recordGreen(root, { outputDigest: flag('out') })
      else r = ecGate.recordVerify(root, { command: flag('cmd'), outputDigest: flag('out') })
      return r.ok ? { ok: true, command: sub, stage: r.value.stage } : r
    }
    if (sub === 'plan') {
      // 结构化 PLAN 单元落 state.plan：--units 后接 JSON 数组字符串（与 ec_stage mode=plan 同源）。
      // JSON 常含空格与嵌套 []，不能用按空白切分的 rest。取 --units 之后到行尾的内容，
      // 剥掉可选的单/双引号包裹；剩余即完整 JSON 文本。
      const original = String(line)
      const idx = original.indexOf('--units')
      let raw = idx >= 0 ? original.slice(idx + '--units'.length).trim() : ''
      if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
        raw = raw.slice(1, -1)
      }
      let units
      try { units = JSON.parse(raw) } catch {
        return { ok: false, error: ecError('INVALID_INPUT', '/ec plan 的 --units 须为 JSON 数组字符串') }
      }
      const r = ecGate.setPlan(root, units)
      return r.ok ? { ok: true, command: 'plan', plan: r.value.plan, stage: r.value.stage } : r
    }
    if (sub === 'gate') {
      const gate = (rest[0] ?? '').toUpperCase()
      if (!['G1', 'G2', 'G3'].includes(gate)) {
        return { ok: false, error: ecError('INVALID_INPUT', '用法：/ec gate <G1|G2|G3>（G3 须带 --cmd "命令" --out "输出摘要"，与 verify 同形）') }
      }
      if (gate === 'G3') {
        // G3 证据唯一契约：--cmd + --out，与 verify / ec_stage / HTTP 层同形。不接受 :: 字符串。
        const r = ecGate.confirmG3(root, {
          command: flag('cmd'),
          outputDigest: flag('out'),
        })
        return r.ok ? { ok: true, command: 'gate', ...r.value } : r
      }
      // G1/G2 需人拍板：命令里只有用户显式 --confirm 才放行（agent 不得代批）。
      if (!rest.includes('--confirm')) {
        return { ok: false, error: ecError('NOT_USER_CONFIRMED', `门 ${gate} 须人拍板：请点确认卡或用 /ec gate ${gate} --confirm`, { gate }) }
      }
      const r = ecGate.confirmGate(root, gate)
      return r.ok ? { ok: true, command: 'gate', ...r.value } : r
    }
    if (sub === 'metrics') {
      return { ...metricsAction({ action: 'list', limit: Number(rest[0]) || 20, projectRoot: root }), command: 'metrics' }
    }
    if (sub === 'memory') {
      const action = rest[0] ?? 'query'
      // 形如：/ec memory write conventions <内容...>；recall 用线索；目录内文件走具名 --file=
      const named = rest.filter((a) => a.startsWith('--'))
      const positional = rest.slice(1).filter((a) => !a.startsWith('--'))
      // 未知 flag 直接拒绝，不静默丢弃（评审 F15）。
      const allowedFlags = ['--file=', '--id=', '--status=', '--kind=']
      const knownFlags = named.filter((a) => allowedFlags.some((f) => a.startsWith(f)))
      const unknown = named.filter((a) => !allowedFlags.some((f) => a.startsWith(f)))
      if (unknown.length) {
        return { ok: false, error: ecError('INVALID_INPUT', `未知 /ec memory 参数：${unknown.join(' ')}`, { unknown }) }
      }
      const flag = (prefix) => knownFlags.find((a) => a.startsWith(prefix))?.slice(prefix.length) || undefined
      // FIX-memory-recall-arg：recall/query 是"线索优先"，layer 是可选过滤器。
      // 旧实现把第一个位置参数无条件当 layer，导致 `/ec memory recall 依赖注入`（单参数）报
      // "非法规范层 依赖注入"。现在：首个位置参数若是合法 layer 且后面还有内容，才当 layer；
      // 否则整段都是 query。写/audit/init 等 action 仍按原样（layer 就是第一个位置参数）。
      let layer
      let query
      const first = positional[0]
      const restQuery = positional.slice(1).join(' ')
      if ((action === 'recall' || action === 'query') && first && !LAYERS.includes(first)) {
        // 首个位置参数不是合法 layer → 整段都是线索（单参数 recall 不再报"非法规范层"）
        layer = undefined
        query = positional.join(' ') || undefined
      } else {
        // 合法 layer（含 layer-only recall：recall conventions）或写入类 action
        layer = first
        query = restQuery || undefined
      }
      const fileArg = flag('--file=')
      if (fileArg === '') {
        return { ok: false, error: ecError('INVALID_INPUT', '--file= 不能为空') }
      }
      return {
        ...memoryAction({
          action, layer, query, projectRoot: root,
          // write 的正文取线索位（/ec memory write conventions <正文>）；其余 action 用 query。
          content: action === 'write' ? query : undefined,
          file: fileArg,
          id: flag('--id='),
          status: flag('--status='),
          kind: flag('--kind='),
        }),
        command: 'memory',
      }
    }
    return { ok: false, error: ecError('INVALID_INPUT', `未知 /ec 子命令 ${sub}`, { sub }) }
  } catch (e) {
    // 系统异常（坏 state.json 等）统一包装，不冒充 INVALID_INPUT（评审 F10）。
    if (e && typeof e === 'object' && DOMAIN_CODES.has(e.code) && Object.hasOwn(e, 'details')) {
      return { ok: false, error: e }
    }
    return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `/ec ${sub} 执行失败：${e?.message ?? e}`, {}) }
  }
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
      description: '工程套件统一入口：use / which / status / next / new-task / tdd / green / verify / plan / gate / metrics / memory（tdd=记红灯 --test X --out Y；verify=记验证 --cmd "..." --out "..."；plan=落结构化单元 --units \'[{"id":"P1",...}]\'（同步 state.plan）；gate G3=过证据门 --cmd "..." --out "..."（与 verify 同形）；memory 支持 init/write/query/recall/audit/patch）',
      async execute(agent, line) {
        // runEcCommand 自身不抛（内部 try/catch）；这里仅兜底未预期的注册层异常。
        return runEcCommand(line)
      },
    })
    return typeof dispose === 'function' ? dispose : () => {}
  } catch (e) {
    // 命令是便利层；注册失败只降级，不影响工具/面板。错误不静默：打印到宿主控制台。
    console.warn('[engineering-craft] /ec 命令注册失败，已降级：', e?.message ?? e)
    return () => {}
  }
}
