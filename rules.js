/**
 * rules.js —— 工程流程门规则纯函数集（CONTRACT §2.1）。
 * 无 ctx / fs 依赖；工具、命令、面板共用这一份判定。错误码见 CONTRACT §4.1。
 */

/**
 * 门标识 → 该门放行后进入的阶段（CONTRACT §9 stage 枚举）。
 * @type {Record<string, string>}
 */
const GATE_TARGET_STAGE = { G1: 'design', G2: 'coding', G3: 'testing' }

/**
 * 阶段推进顺序；gatesBetween 用它在两个 stage 间取区间。
 * @type {string[]}
 */
const STAGE_ORDER = ['requirements', 'design', 'coding', 'testing', 'review', 'delivery', 'release']

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
  if (rule?.requireUserConfirm && (gate.confirmedBy !== 'user' || !gate.at)) {
    return fail('NOT_USER_CONFIRMED', `门 ${gateId} 需要人确认，当前确认方=${gate.confirmedBy ?? 'null'} at=${gate.at ?? 'null'}`, { gateId })
  }
  if (rule?.requireEvidence && !gate.evidence) {
    return fail('NO_EVIDENCE', `门 ${gateId} 缺真实命令输出证据`, { gateId })
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
 * @param {object} state 当前状态
 * @param {ReadonlyArray<{role: string, outputs: string[]}>} [order=DEFAULT_PIPELINE] 岗位顺序表
 * @returns {{role: string} | {role: null, blockedBy: string}} blockedBy 为缺失交接物键
 */
export function nextRole(state, order = DEFAULT_PIPELINE) {
  const artifacts = state?.artifacts ?? {}
  for (const entry of order) {
    const outputs = Array.isArray(entry.outputs) ? entry.outputs : []
    const present = outputs.filter((key) => artifacts[key])
    if (present.length === outputs.length) continue
    // 部分产物已落盘 = 该岗位正在交接中，缺失键即阻塞点；一个都没有 = 该岗位可启动。
    if (present.length === 0) return { role: entry.role }
    const missing = outputs.find((key) => !artifacts[key])
    return { role: null, blockedBy: missing }
  }
  return { role: null, blockedBy: 'all-complete' }
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
