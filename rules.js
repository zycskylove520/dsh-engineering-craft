/**
 * rules.js —— 工程流程门规则纯函数集（CONTRACT §2.1）。
 * 无 ctx / fs 依赖；工具、命令、面板共用这一份判定。错误码见 CONTRACT §4.1。
 */
import { posix } from 'node:path'

/**
 * 门标识 → 该门放行后进入的阶段（CONTRACT §9 stage 枚举）。
 * @type {Record<string, string>}
 */
export const GATE_TARGET_STAGE = Object.freeze({ G1: 'design', G2: 'coding', G3: 'testing' })

/**
 * 阶段推进顺序；gatesBetween 用它在两个 stage 间取区间。
 * @type {string[]}
 */
export const STAGE_ORDER = ['requirements', 'design', 'coding', 'testing', 'review', 'delivery', 'release']

/**
 * 默认岗位顺序表：product→architect→developer→tester→reviewer→ops（ADR §6.1）。
 * outputs 是该岗位准出交接物键；全部落盘才算该岗位完成，部分落盘则阻塞在缺失键上。
 * @type {ReadonlyArray<{role: string, outputs: string[]}>}
 */
export const DEFAULT_PIPELINE = Object.freeze([
  { role: 'product', outputs: ['prd'] },
  { role: 'architect', outputs: ['adr', 'contract'] },
  { role: 'developer', outputs: ['plan'] },
  { role: 'tester', outputs: ['testReport'] },
  { role: 'reviewer', outputs: ['brief', 'findings'] },
  { role: 'ops', outputs: ['release'] },
])

/**
 * 判定单个门是否满足放行条件（纯函数）。
 * @param {string} gateId 门标识 G1|G2|G3
 * @param {object} state 当前工程状态（只读，不得修改）
 * @param {{requiredArtifacts: string[], requireUserConfirm: boolean, requireEvidence: boolean}} rule 该门的 Config 规则
 * @returns {{ok: true} | {ok: false, error: {code: string, message: string, details: object}}} ok=放行；否则 error.code 指明缺交接物/未确认/无证据
 */
export function checkGate(gateId, state, rule) {
  const fail = (code, message, details) => ({ ok: false, error: { code, message, details } })

  if (!Object.hasOwn(GATE_TARGET_STAGE, gateId)) {
    return fail('INVALID_INPUT', `未知门标识 ${String(gateId)}`, { gateId })
  }

  const gate = state?.gates?.[gateId] ?? {}
  const artifacts = state?.artifacts ?? {}
  const missingArtifacts = (Array.isArray(rule?.requiredArtifacts) ? rule.requiredArtifacts : [])
    .filter((key) => !artifacts[key])

  if (missingArtifacts.length > 0) {
    return fail('MISSING_ARTIFACT', `门 ${gateId} 缺交接物：${missingArtifacts.join(', ')}`, { gateId, missingArtifacts })
  }
  // 需人拍板的门：确认方必须是 user 且记录过确认时刻（at），两者缺一即 NOT_USER_CONFIRMED。
  // 这比笼统的 passed=false 更具体，面板可直接提示"等人确认"。
  // FIX-gate-at-zero：用显式 null/undefined 判断，不用 falsy（at=0 也曾经算"已确认"的歧义）。
  if (rule?.requireUserConfirm && (gate.confirmedBy !== 'user' || gate.at == null)) {
    return fail('NOT_USER_CONFIRMED', `门 ${gateId} 需要人确认，当前确认方=${gate.confirmedBy ?? 'null'} at=${gate.at ?? 'null'}`, { gateId })
  }
  if (rule?.requireEvidence && !gate.evidence) {
    return fail('NO_EVIDENCE', `门 ${gateId} 缺真实命令输出证据`, { gateId })
  }
  // FUSION-TDD/VERIFY：最终门 G3 无条件要求"先有失败测试（红）+ 新鲜验证证据"。
  // 无兼容：state 没带 tdd/verification 字段 = 没做 = 拦，必须补做才能过门。
  if (gateId === 'G3' && !state?.tdd?.redRecorded) {
    return fail('TDD_RED_MISSING', '门 G3 缺 TDD 红灯证据：写生产代码前须先有失败测试并调 ec_stage(mode="tdd") 记录', { gateId })
  }
  if (gateId === 'G3' && (!Array.isArray(state?.verification?.checks) || state.verification.checks.length === 0)) {
    return fail('VERIFY_MISSING', '门 G3 缺验证清单：宣称完成前须调 ec_stage(mode="verify") 落至少一条「命令+输出摘要」证据', { gateId })
  }
  if (!gate.passed) {
    return fail('GATE_NOT_PASSED', `门 ${gateId} 尚未记录放行`, { gateId })
  }
  return { ok: true }
}

/**
 * 按严格岗位顺序返回下一个应启动的岗位（纯函数）。
 * 仅当上游交接物路径存在（非 null 且对应文件已落盘）时放行该岗位；
 * 本岗位交接物部分落盘则阻塞在缺失键上（如 architect 有 ADR 缺 CONTRACT）。
 * 下一岗位为 developer 且三道门全过时返回形态 B（研发岗内部并行单元），
 * 否则维持形态 A 返回形状（不加 mode 字段）。
 *
 * 注意：本函数是交接物驱动的岗位推进，门（G1/G2/G3）是"可查询的纪律"而非内核强制钩子——
 * nextRole 不消费 gates，门状态由 ec_stage 查询暴露、由人按纪律遵守（README「已知限制」已声明）。
 * @param {object} state 当前状态
 * @param {ReadonlyArray<{role: string, outputs: string[]}>} [order=DEFAULT_PIPELINE] 岗位顺序表
 * @param {{capabilities?: {subagent?: boolean}, thresholds?: {minFilesForParallel?: number}}} [opts]
 *   能力门默认开（DSH 原生 subagent）；minFilesForParallel 沿用旧字段名，语义为"最小并行单元数"。
 * @returns {{role: string} | {role: null, blockedBy: string} |
 *   {role: 'developer', roles: string[], mode: 'B', units: Array<{id: string, ownerFiles: string[]}>}}
 *   blockedBy 为缺失交接物键
 */
export function nextRole(state, order = DEFAULT_PIPELINE, opts = {}) {
  const artifacts = state?.artifacts ?? {}
  for (const entry of order) {
    const outputs = Array.isArray(entry.outputs) ? entry.outputs : []
    const present = outputs.filter((key) => artifacts[key])
    if (present.length === outputs.length) continue
    // 部分产物已落盘 = 该岗位正在交接中，缺失键即阻塞点；一个都没有 = 该岗位可启动。
    if (present.length === 0) {
      if (entry.role === 'developer') {
        const units = parallelUnits(state, opts)
        if (units) {
          return { role: 'developer', roles: units.map((u) => u.id), mode: 'B', units }
        }
      }
      return { role: entry.role }
    }
    const missing = outputs.find((key) => !artifacts[key])
    return { role: null, blockedBy: missing }
  }
  return { role: null, blockedBy: 'all-complete' }
}

/**
 * 三道门判定：全过则返回可并行的 todo 单元，否则 null（调用方退回形态 A）。
 * @param {object} state 当前状态
 * @param {{capabilities?: {subagent?: boolean}, thresholds?: {minFilesForParallel?: number}}} opts
 * @returns {Array<{id: string, ownerFiles: string[]}>|null}
 */
function parallelUnits(state, opts) {
  // 能力门：DSH 天生具备 subagent，只有显式 false 才关闭形态 B；关闭不是单 agent 降级，仍回形态 A。
  if (opts?.capabilities?.subagent === false) return null
  const plan = Array.isArray(state?.plan) ? state.plan : []
  // 收益门看可并行候选（todo）；形状门的重叠检测须覆盖所有未完成单元（含 doing），
  // 否则新派发的 todo 单元可能与正在进行的 doing 单元写同一个文件。
  const candidates = plan.filter((u) => u?.status === 'todo')
  const active = plan.filter((u) => u?.status === 'todo' || u?.status === 'doing')
  const threshold = Number.isFinite(opts?.thresholds?.minFilesForParallel)
    ? opts.thresholds.minFilesForParallel
    : 2
  // 收益门：字段名沿用 Config 的 minFilesForParallel，语义为最小并行单元数。
  if (candidates.length < threshold || candidates.length < 2) return null
  // 空 ownerFiles 视为归属不可判定，保守拒绝（ADR-PARALLEL §取舍与风险）。
  if (active.some((u) => !Array.isArray(u.ownerFiles) || u.ownerFiles.length === 0)) return null
  const seen = new Set()
  const ids = new Set()
  // 任务形状门：任一文件被两个未完成单元声明归属即重叠，重叠会让并行写入互相覆盖。
  // posix.normalize 折叠中间 ./ 与 ..，统一分隔符 + 小写，避免 src/a.js 与 src/./a.js 绕过。
  for (const u of active) {
    if (ids.has(u.id)) return null // id 重复也算不可判定
    ids.add(u.id)
    for (const file of u.ownerFiles) {
      // FIX-shape-trailing-slash：折叠尾部斜杠，否则 'src/a.js' 与 'src/a.js/' 视为不同文件，
      // 两个并行单元可写同一文件互相覆盖。去尾部 /（保留根 '/' 语义与本判定无关）。
      const key = posix.normalize(String(file).replace(/\\/g, '/')).toLowerCase().replace(/\/+$/, '')
      if (seen.has(key)) return null
      seen.add(key)
    }
  }
  return candidates.map((u) => ({ id: u.id, ownerFiles: [...u.ownerFiles] }))
}

/**
 * 计算从当前阶段推进到目标阶段前必须通过的全部门（纯函数）。
 * @param {string} from 当前阶段
 * @param {string} to 目标阶段
 * @returns {string[]} 需通过的门 id 列表，顺序即推进顺序
 */
export function gatesBetween(from, to) {
  const a = STAGE_ORDER.indexOf(from)
  const b = STAGE_ORDER.indexOf(to)
  if (a < 0 || b <= a) return []

  const gates = []
  // 门守在阶段边界上：离开 STAGE_ORDER[i] 进入 i+1 前，须过目标为该阶段的门。
  for (let i = a; i < b; i += 1) {
    const targetStage = STAGE_ORDER[i + 1]
    for (const [gateId, stage] of Object.entries(GATE_TARGET_STAGE)) {
      if (stage === targetStage && !gates.includes(gateId)) gates.push(gateId)
    }
  }
  return gates
}
