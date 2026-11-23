/**
 * gate-service.js —— EcState 的唯一所有者（CONTRACT §2.2，按架构收敛改为文件落盘）。
 * 门状态存 <projectRoot>/.engineering-craft/state.json（stateVersion=1），跨会话按项目连续；
 * 所有写操作集中在本模块，工具/命令只转发。路径统一规范化并做项目根白名单校验。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { checkGate, nextRole, gatesBetween, DEFAULT_PIPELINE } from './rules.js'

/** 状态文件名与目录名（相对 projectRoot）。 */
export const STATE_DIR_NAME = '.engineering-craft'
export const STATE_FILE_NAME = 'state.json'

/** 默认门规则（CONTRACT §4.2）。 */
export const DEFAULT_GATES = Object.freeze({
  G1: { requiredArtifacts: ['prd'], requireUserConfirm: true, requireEvidence: false },
  G2: { requiredArtifacts: ['adr', 'contract'], requireUserConfirm: true, requireEvidence: false },
  G3: { requiredArtifacts: [], requireUserConfirm: false, requireEvidence: true },
})

/** 形态 B 默认阈值（Config thresholds.minFilesForParallel，缺省 2）。纯内存，不落盘。 */
let roleDefaults = { thresholds: { minFilesForParallel: 2 } }

/**
 * 设置形态 B 的 Config 默认值（由 index.js apply 注入；纯内存，进程重启后回缺省）。
 * @param {{thresholds?: {minFilesForParallel?: number}}} [opts] Config 阈值；传入即整体替换默认值
 * @returns {void}
 */
export function setRoleDefaults(opts = {}) {
  roleDefaults = { thresholds: { minFilesForParallel: 2 }, ...opts }
}

/**
 * 读形态 B 当前 Config 默认值（测试用：可保存后还原）。
 * @returns {{thresholds: {minFilesForParallel: number}}}
 */
export function getRoleDefaults() {
  return roleDefaults
}

/** ArtifactKey → 交接物文件名（CONTRACT §8，_extension 项见 §9）。 */
const ARTIFACT_FILES = Object.freeze({
  prd: 'PRD.md', adr: 'ADR.md', contract: 'CONTRACT.md', plan: 'PLAN.md',
  brief: 'BRIEF.md', release: 'RELEASE.md', testReport: 'TEST-REPORT.md', findings: 'FINDINGS.md',
})

/**
 * ArtifactKey → RoleKey（CONTRACT §9：pipeline.handoffs 的键是岗位而非交接物）。
 * 一个岗位可产出多个交接物（architect=adr+contract，reviewer=brief+findings），映射到同一 role。
 * @type {Record<string, string>}
 */
const ARTIFACT_TO_ROLE = Object.freeze({
  prd: 'product', adr: 'architect', contract: 'architect', plan: 'developer',
  testReport: 'tester', brief: 'reviewer', findings: 'reviewer', release: 'ops',
})

/**
 * 领域错误构造器（CONTRACT §4.1）。
 * @param {string} code EcErrorCode
 * @param {string} message 人可读说明
 * @param {object} [details] 结构化上下文
 * @returns {{code: string, message: string, details: object}}
 */
export function ecError(code, message, details = {}) {
  return { code, message, details }
}

/** Result 构造器。 */
const ok = (value) => ({ ok: true, value })
const fail = (error) => ({ ok: false, error })

/**
 * 规范化 projectRoot：相对路径按 cwd 解析，绝对路径原样 normalize；不接受空串。
 * @param {string|undefined} input 项目根
 * @returns {string} 绝对规范路径
 */
export function normalizeProjectRoot(input) {
  const raw = typeof input === 'string' && input.trim() ? input.trim() : process.cwd()
  return resolve(normalize(raw))
}

/**
 * 路径安全：校验目标绝对路径是否落在项目根内（防 .. / 软链前缀穿越）。
 * @param {string} target 目标绝对路径
 * @param {string} root 允许根（绝对路径）
 * @returns {string|null} 合法返回规范绝对路径，否则 null
 */
export function safePathWithin(target, root) {
  if (typeof target !== 'string' || !target.trim()) return null
  const r = resolve(normalize(root))
  const t = resolve(normalize(isAbsolute(target) ? target : join(r, target)))
  if (t === r || t.startsWith(r + sep)) return t
  return null
}

/**
 * state.json 的绝对路径（不要求文件存在）。
 * @param {string} projectRoot 项目根
 * @returns {string} state.json 绝对路径
 */
export function statePathOf(projectRoot) {
  return join(normalizeProjectRoot(projectRoot), STATE_DIR_NAME, STATE_FILE_NAME)
}

/**
 * 由 projectRoot 构造初始 EcState（CONTRACT §9，version=1）。
 * @param {string} projectRoot 项目根绝对路径
 * @returns {object} 初始状态（调用方拥有，可安全 mutate）
 */
export function initialState(projectRoot) {
  const root = normalizeProjectRoot(projectRoot)
  return {
    version: 1,
    projectRoot: root,
    stage: 'requirements',
    gates: {
      G1: { passed: false, confirmedBy: 'user', at: null, evidence: null },
      G2: { passed: false, confirmedBy: 'user', at: null, evidence: null },
      G3: { passed: false, confirmedBy: 'agent', at: null, evidence: null },
    },
    artifacts: {
      prd: null, adr: null, contract: null, plan: null,
      brief: null, release: null, testReport: null, findings: null,
    },
    plan: [],
    pipeline: { role: null, status: 'pending', handoffs: {} },
    metrics: { lastGate: null, blockCount: 0 },
    updatedAt: 0,
  }
}

/**
 * 工程状态服务：读写 state.json，封装门判定与推进（架构收敛后替代 SessionProjection）。
 * 所有写口都在本类；工具/命令经本类访问状态，不另存副本。
 */
export default class EcGate {
  /**
   * @param {object} [config={}] 插件 Config（gates 规则可覆盖默认）
   */
  constructor(config = {}) {
    this.gates = { ...DEFAULT_GATES, ...(config?.gates || {}) }
  }

  /**
   * 读某项目的工程状态。缺文件返回 initialState，不写盘（读操作无副作用）。
   * @param {string} projectRoot 项目根绝对路径
   * @returns {object} EcState 快照（JSON；调用方不得 mutate）
   */
  read(projectRoot) {
    const file = statePathOf(projectRoot)
    if (!existsSync(file)) return initialState(projectRoot)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || parsed.version !== 1) {
      throw new Error(`stateVersion 不匹配：${file} 期望 1，实际 ${parsed?.version}`)
    }
    return parsed
  }

  /**
   * 写状态（内部唯一落盘口）：建目录 + 写 state.json。
   * @param {object} state 完整 EcState
   * @returns {string} state.json 绝对路径
   */
  write(state) {
    const file = statePathOf(state.projectRoot)
    mkdirSync(join(state.projectRoot, STATE_DIR_NAME), { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
    return file
  }

  /**
   * 读某会话的工程状态（CONTRACT §2.2 stateOf 的签名兼容层：session 参数可为项目根字符串）。
   * @param {string|{projectRoot?: string}} session 项目根或带 projectRoot 的会话对象
   * @returns {object} 当前状态快照
   */
  stateOf(session) {
    return this.read(typeof session === 'string' ? session : session?.projectRoot)
  }

  /**
   * 校验门是否满足放行条件（封装 rules.checkGate，规则来自 Config）。
   * @param {string} projectRoot 项目根
   * @param {string} gateId G1|G2|G3
   * @returns {{ok: true}|{ok: false, error: object}} Result
   */
  check(projectRoot, gateId) {
    const state = this.read(projectRoot)
    return checkGate(gateId, state, this.gates[gateId])
  }

  /**
   * 记录人确认的门（G1/G2；go-no-go 由确认卡走同一路径）。G3 不接受本路径。
   * @param {string} projectRoot 项目根
   * @param {string} gateId 门 id
   * @param {{at?: number, evidence?: string}} [meta] 时间戳与证据摘要
   * @returns {{ok: true, value: object}|{ok: false, error: object}} Result<EcState, EcError>
   */
  confirmGate(projectRoot, gateId, meta = {}) {
    if (gateId === 'G3') {
      return fail(ecError('INVALID_INPUT', 'G3 不接受人确认路径，须走 confirmG3 提供命令证据', { gateId }))
    }
    if (!Object.hasOwn(this.gates, gateId)) {
      return fail(ecError('INVALID_INPUT', `未知门 ${gateId}`, { gateId }))
    }
    const state = this.read(projectRoot)
    const artifacts = state.artifacts
    const missing = (this.gates[gateId].requiredArtifacts || []).filter((k) => !artifacts[k])
    if (missing.length) {
      return fail(ecError('MISSING_ARTIFACT', `门 ${gateId} 缺交接物：${missing.join(', ')}`, { gateId, missingArtifacts: missing }))
    }
    state.gates[gateId] = {
      passed: true,
      confirmedBy: 'user',
      at: Number.isFinite(meta.at) ? meta.at : Date.now(),
      evidence: meta.evidence ?? null,
    }
    state.stage = gateId === 'G1' ? 'design' : 'coding'
    state.metrics.lastGate = gateId
    state.updatedAt = Date.now()
    try {
      // write() 返回落盘路径；Result.value 按 CONTRACT 应为 EcState，供工具/命令直接读取 stage/gates。
      this.write(state)
      return ok(state)
    } catch (e) {
      return fail(ecError('STORAGE_UNAVAILABLE', `状态落盘失败：${e?.message ?? e}`, { gateId }))
    }
  }

  /**
   * 记录 G3 窄检通过（需真实命令输出证据；confirmBy=agent）。
   * @param {string} projectRoot 项目根
   * @param {{command: string, outputDigest: string}} evidence 命令与输出摘要（非全文）
   * @returns {{ok: true, value: object}|{ok: false, error: object}} Result<EcState, EcError>
   */
  confirmG3(projectRoot, evidence) {
    if (!evidence || typeof evidence.command !== 'string' || !evidence.command.trim()
      || typeof evidence.outputDigest !== 'string' || !evidence.outputDigest.trim()) {
      return fail(ecError('NO_EVIDENCE', 'G3 须提供 command 与 outputDigest', { gate: 'G3' }))
    }
    const state = this.read(projectRoot)
    state.gates.G3 = {
      passed: true,
      confirmedBy: 'agent',
      at: Date.now(),
      evidence: `${evidence.command} :: ${evidence.outputDigest}`.slice(0, 500),
    }
    state.stage = 'testing'
    state.metrics.lastGate = 'G3'
    state.updatedAt = Date.now()
    try {
      // write() 返回落盘路径；Result.value 按 CONTRACT 应为 EcState，供工具/命令直接读取 stage/gates。
      this.write(state)
      return ok(state)
    } catch (e) {
      return fail(ecError('STORAGE_UNAVAILABLE', `状态落盘失败：${e?.message ?? e}`, { gate: 'G3' }))
    }
  }

  /**
   * 更新交接物路径指针或 PLAN 单元状态（路径须落在允许根内）。
   * @param {string} projectRoot 项目根
   * @param {{artifact?: string, path?: string, planId?: string, planStatus?: string}} patch 变更
   * @returns {{ok: true, value: object}|{ok: false, error: object}} Result<EcState, EcError>
   */
  update(projectRoot, patch = {}) {
    const state = this.read(projectRoot)
    if (patch.artifact) {
      if (!Object.hasOwn(ARTIFACT_FILES, patch.artifact)) {
        return fail(ecError('INVALID_INPUT', `未知交接物键 ${patch.artifact}`, { artifact: patch.artifact }))
      }
      const safe = patch.path ? safePathWithin(patch.path, projectRoot) : null
      if (!safe) {
        return fail(ecError('PATH_OUT_OF_ROOT', `交接物路径越出项目根：${patch.path}`, { artifact: patch.artifact, path: patch.path }))
      }
      state.artifacts[patch.artifact] = safe
      // 面板按 role 键读 handoffs（CONTRACT §9）；同一 role 多交接物时保留最新落盘的路径。
      const roleKey = ARTIFACT_TO_ROLE[patch.artifact]
      if (roleKey) state.pipeline.handoffs[roleKey] = safe
    }
    if (patch.planId) {
      const unit = state.plan.find((u) => u.id === patch.planId)
      if (!unit) return fail(ecError('INVALID_INPUT', `PLAN 单元不存在：${patch.planId}`, { planId: patch.planId }))
      if (!['todo', 'doing', 'done'].includes(patch.planStatus)) {
        return fail(ecError('INVALID_INPUT', `非法 PLAN 状态：${patch.planStatus}`, { planId: patch.planId, status: patch.planStatus }))
      }
      unit.status = patch.planStatus
    }
    state.updatedAt = Date.now()
    try {
      // write() 返回落盘路径；Result.value 按 CONTRACT 应为 EcState，供工具/命令直接读取 stage/gates。
      this.write(state)
      return ok(state)
    } catch (e) {
      return fail(ecError('STORAGE_UNAVAILABLE', `状态落盘失败：${e?.message ?? e}`, {}))
    }
  }

  /**
   * 返回当前应启动的下一个岗位（封装 rules.nextRole，透传形态 B 三道门参数）。
   * @param {string} projectRoot 项目根
   * @param {{capabilities?: {subagent?: boolean}, thresholds?: {minFilesForParallel?: number}}} [opts]
   * @returns {{role: string}|{role: null, blockedBy: string}|
   *   {role: 'developer', roles: string[], mode: 'B', units: Array<{id: string, ownerFiles: string[]}>}}
   */
  nextRole(projectRoot, opts = {}) {
    // Config 阈值作默认，调用方显式传的字段覆盖；能力门仍由 rules 默认开。
    const merged = {
      capabilities: { ...roleDefaults.capabilities, ...opts.capabilities },
      thresholds: { ...roleDefaults.thresholds, ...opts.thresholds },
    }
    return nextRole(this.read(projectRoot), DEFAULT_PIPELINE, merged)
  }

  /**
   * 计算从当前阶段到目标阶段须过的门（封装 rules.gatesBetween）。
   * @param {string} from 当前阶段
   * @param {string} to 目标阶段
   * @returns {string[]} 门 id 列表
   */
  gatesBetween(from, to) {
    return gatesBetween(from, to)
  }

  /**
   * 生成注入 prompt 的门状态段落文本（供 systemPrompt.section 使用）。
   * @param {string} projectRoot 项目根
   * @returns {string} 简短文本：当前阶段/未过门/在岗岗位；不重复工具说明
   */
  promptSection(projectRoot) {
    const state = this.read(projectRoot)
    const pending = ['G1', 'G2', 'G3'].filter((g) => !state.gates[g].passed)
    const role = this.nextRole(projectRoot)
    const missing = Object.entries(state.artifacts).filter(([, v]) => !v).map(([k]) => k)
    return [
      `工程流程：阶段=${state.stage}；未过门=${pending.join(',') || '无'}；`
      + `下一岗位=${role.role ?? '(无)'}（阻塞=${role.blockedBy ?? '无'}）`,
      `缺失交接物=${missing.join(',') || '无'}；门规则见 ec_stage 工具，拍板由人确认。`,
    ].join('\n')
  }
}
