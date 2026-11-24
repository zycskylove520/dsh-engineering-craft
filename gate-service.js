/**
 * gate-service.js —— EcState 的唯一所有者（CONTRACT §2.2，按架构收敛改为文件落盘）。
 * 门状态存 <projectRoot>/.ec-state/state.json（stateVersion=2），跨会话按项目连续；
 * 所有写操作集中在本模块，工具/命令只转发。路径按标签形态规范化，并做 projectRoot 内的防 .. 穿越校验。
 * 无旧路径/旧版本兼容：只读新路径、版本必须为 STATE_VERSION，否则报错。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { checkGate, nextRole, gatesBetween, DEFAULT_PIPELINE, STAGE_ORDER, GATE_TARGET_STAGE } from './rules.js'
import { isAbsoluteFor, joinFor, dirnameFor, resolveFor, nativePath } from './ec-path.js'

/**
 * 状态目录名（相对 projectRoot）。
 * `.engineering-craft` 在 skill 里是记忆目录内的空文件 marker，故插件状态目录用 `.ec-state/`。
 */
export const STATE_DIR_NAME = '.ec-state'
export const STATE_FILE_NAME = 'state.json'
export const STATE_VERSION = 2

/** 只在目标阶段更靠后时推进 stage；重复/迟到确认保持当前阶段（避免 delivery 被 G1 打回 design）。 */
function advanceStage(current, target) {
  return STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(current) ? target : current
}

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

/** ArtifactKey → 交接物文件名（单一真相源；artifacts.js 从此处 import）。 */
export const ARTIFACT_FILES = Object.freeze({
  prd: 'PRD.md', adr: 'ADR.md', contract: 'CONTRACT.md', plan: 'PLAN.md',
  brief: 'BRIEF.md', release: 'RELEASE.md', testReport: 'TEST-REPORT.md', findings: 'FINDINGS.md',
  progress: 'PROGRESS.md',
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
 * 领域错误码白名单：只有本插件 ecError 产出的 code 才算领域错误（带 details），可原样返回。
 * Node fs 错误（ENOENT/EACCES/EISDIR…）虽也带字符串 code，但不是领域错误，须转成 STORAGE_UNAVAILABLE，
 * 否则裸 Error（丢 details、码值不在枚举内）会透传给调用方。
 */
export const DOMAIN_CODES = new Set([
  'INVALID_INPUT', 'NOT_USER_CONFIRMED', 'MISSING_ARTIFACT', 'NO_EVIDENCE', 'GATE_NOT_PASSED',
  'GATE_ORDER', 'PATH_OUT_OF_ROOT', 'STORAGE_UNAVAILABLE', 'STORAGE_BLOCKED',
  'INVALID_MEMORY_ENTRY', 'ARTIFACT_OUTSIDE_TMP', 'ARTIFACT_SCHEMA_FAIL',
])

/**
 * 归一化工具/命令异常：领域错误原样返回；系统异常包装成 STORAGE_UNAVAILABLE。
 * @param {unknown} e 捕获的异常
 * @param {string} context 场景描述
 * @returns {{ok: false, error: object}} 失败 Result
 */
export function normalizeToolError(e, context) {
  if (e && typeof e === 'object' && typeof e.code === 'string'
    && DOMAIN_CODES.has(e.code) && Object.hasOwn(e, 'details')) {
    return { ok: false, error: e }
  }
  return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `${context}：${e?.message ?? e}`, {}) }
}

/**
 * 规范化 projectRoot：相对路径按 cwd 解析，绝对路径原样 normalize；不接受空串。
 * @param {string|undefined} input 项目根
 * @returns {string} 绝对规范路径
 */
export function normalizeProjectRoot(input) {
  const raw = typeof input === 'string' && input.trim() ? input.trim() : process.cwd()
  return resolveFor(raw)
}

/**
 * 路径安全：校验 target 是否落在 projectRoot 标签内（防 .. / 异 scheme 分隔符 / 兄弟目录前缀穿越）。
 *
 * 【为何用宿主 fs 语义校验】fs 落盘时 Windows 会把 /remote/... 当 <当前盘>:\remote\...、
 * 把 \ 当分隔符并折叠 ..。若用 POSIX 标签语义校验，'..\evil.md' 不被折叠会误判为"在根内"，
 * 但落盘却跑到根外（已实证的安全漏洞）。故 containment 一律用 nativePath（宿主 fs）语义折叠后判断；
 * 返回值仍按标签形态 resolveFor 构造，保证远端标签 /remote/... 在 state.json 里原样保留。
 * 另：root 为文件系统根（/ 或 C:\）时前缀需去尾分隔符，否则 '//' 双分隔符会拒绝所有子路径。
 *
 * @param {string} target 目标路径（绝对或相对 root）
 * @param {string} root projectRoot 标签（绝对路径）
 * @returns {string|null} 合法返回标签形态的规范路径，否则 null
 */
export function safePathWithin(target, root) {
  if (typeof target !== 'string' || !target.trim()) return null
  if (typeof root !== 'string' || !root.trim()) return null
  // 1) 安全校验：按宿主 fs 语义解析（折叠 \ 与 ..、识别盘符/UNC 交叉），杜绝落盘越界。
  const rootNative = nativePath.resolve(nativePath.normalize(root))
  const targetNative = nativePath.isAbsolute(target)
    ? nativePath.resolve(nativePath.normalize(target))
    : nativePath.resolve(rootNative, target)
  const prefix = rootNative.endsWith(nativePath.sep) ? rootNative : rootNative + nativePath.sep
  const contained = targetNative === rootNative || targetNative.startsWith(prefix)
  if (!contained) return null
  // 2) 返回值：按标签形态构造，保持 /remote/... 原样（不写盘符），与 projectRoot 标签一致。
  const rLabel = resolveFor(root)
  return isAbsoluteFor(target) ? resolveFor(target) : resolveFor(joinFor(rLabel, target))
}

/**
 * projectRoot 解析（无状态校验的纯文本标签）。
 *
 * projectRoot 是「用户声明的工程目录文本标签」——可以是本机路径，也可以是远端路径
 * （如 /remote/path/to/Project）。插件不做白名单/存在性校验：
 *   - 工程在哪、是不是远程、要不要挂载，由用户/宿主记忆与 SSH 工具负责；
 *   - 本插件只把标签规范化后原样用于落盘（<标签>/.ec-state/）。
 * 绝对标签（POSIX / 开头或 Windows 盘符）原样保留；相对标签按 process.cwd() 解析。
 *
 * @param {string} input 调用方给的项目根标签
 * @returns {string|null} 规范化后的标签；仅空/非字符串返回 null
 */
export function resolveAllowedRoot(input) {
  if (typeof input !== 'string' || !input.trim()) return null
  const raw = input.trim()
  if (isAbsoluteFor(raw)) return resolveFor(raw)
  return resolveFor(joinFor(resolveFor(process.cwd()), raw))
}

/**
 * state.json 的绝对路径（不要求文件存在）。
 * @param {string} projectRoot 项目根
 * @returns {string} state.json 绝对路径
 */
export function statePathOf(projectRoot) {
  const root = normalizeProjectRoot(projectRoot)
  return joinFor(root, STATE_DIR_NAME, STATE_FILE_NAME)
}

/**
 * 由 projectRoot 构造初始 EcState（CONTRACT §9，version=1）。
 * @param {string} projectRoot 项目根绝对路径
 * @returns {object} 初始状态（调用方拥有，可安全 mutate）
 */
export function initialState(projectRoot) {
  const root = normalizeProjectRoot(projectRoot)
  return {
    version: STATE_VERSION,
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
      progress: null,
    },
    plan: [],
    pipeline: { role: null, status: 'pending', handoffs: {} },
    releaseDecision: null,
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
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      // 坏 JSON 不能让裸 SyntaxError 穿透工具层；转成领域错误（STORAGE_UNAVAILABLE）。
      throw ecError('STORAGE_UNAVAILABLE', `state.json 解析失败：${file}（${e?.message ?? e}）`, { file })
    }
    if (!parsed || parsed.version !== STATE_VERSION) {
      throw ecError('STORAGE_UNAVAILABLE',
        `stateVersion 不匹配：${file} 期望 ${STATE_VERSION}，实际 ${parsed?.version}`, { file })
    }
    // 必要字段完整性：缺 gates/artifacts/plan 的残缺状态视为不可用，避免下游 deep 访问崩溃。
    if (!parsed.gates || !parsed.artifacts || !Array.isArray(parsed.plan)) {
      throw ecError('STORAGE_UNAVAILABLE', `state.json 字段不完整：${file}`, { file })
    }
    // gates 每门必须是对象且 passed 为布尔（否则 promptSection/gateResults 会 TypeError）。
    for (const g of ['G1', 'G2', 'G3']) {
      if (!parsed.gates[g] || typeof parsed.gates[g] !== 'object' || typeof parsed.gates[g].passed !== 'boolean') {
        throw ecError('STORAGE_UNAVAILABLE', `state.json 门字段不合法：${g}`, { file, gate: g })
      }
    }
    // 项目根一致性：state 内的 projectRoot 必须与请求的根匹配，防止拷贝/重命名导致跨项目写错。
    if (parsed.projectRoot && normalizeProjectRoot(parsed.projectRoot) !== normalizeProjectRoot(projectRoot)) {
      throw ecError('STORAGE_UNAVAILABLE', `state.json 的 projectRoot 与请求根不一致`, { file, stateRoot: parsed.projectRoot, requestRoot: projectRoot })
    }
    return parsed
  }

  /**
   * 写状态（内部唯一落盘口）：临时文件 + rename 原子替换，避免中途崩溃留下截断 JSON。
   * projectRoot 显式传入，不取 state 内部字段（防止陈旧的 state.projectRoot 写错项目）。
   * @param {object} state 完整 EcState
   * @param {string} [rootOverride] 显式项目根；缺省用 state.projectRoot（仅测试/内部调用）
   * @returns {string} state.json 绝对路径
   */
  write(state, rootOverride) {
    const root = normalizeProjectRoot(rootOverride ?? state.projectRoot)
    const file = statePathOf(root)
    const dir = joinFor(root, STATE_DIR_NAME)
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify({ ...state, projectRoot: root }, null, 2) + '\n', 'utf8')
      renameSync(tmp, file)
    } catch (e) {
      try { if (existsSync(tmp)) rmSync(tmp, { force: true }) } catch { /* 清理失败不掩盖主错 */ }
      throw e
    }
    return file
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
    // 门序：G2 须在 G1 之后确认，防止乱序拍板（G1→G2 是因果依赖）。
    if (gateId === 'G2' && !state.gates.G1.passed) {
      return fail(ecError('GATE_ORDER', 'G1 未过，不能先确认 G2', { gateId, prerequisite: 'G1' }))
    }
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
    state.stage = advanceStage(state.stage, GATE_TARGET_STAGE[gateId])
    state.metrics.lastGate = gateId
    state.updatedAt = Date.now()
    try {
      // write() 返回落盘路径；Result.value 按 CONTRACT 应为 EcState，供工具/命令直接读取 stage/gates。
      this.write(state, projectRoot)
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
    // 门序：G3 须在 G2 之后确认。
    if (!state.gates.G2.passed) {
      return fail(ecError('GATE_ORDER', 'G2 未过，不能先确认 G3', { gate: 'G3', prerequisite: 'G2' }))
    }
    state.gates.G3 = {
      passed: true,
      confirmedBy: 'agent',
      at: Date.now(),
      evidence: `${evidence.command} :: ${evidence.outputDigest}`.slice(0, 500),
    }
    state.stage = advanceStage(state.stage, 'testing')
    state.metrics.lastGate = 'G3'
    state.updatedAt = Date.now()
    try {
      // write() 返回落盘路径；Result.value 按 CONTRACT 应为 EcState，供工具/命令直接读取 stage/gates。
      this.write(state, projectRoot)
      return ok(state)
    } catch (e) {
      return fail(ecError('STORAGE_UNAVAILABLE', `状态落盘失败：${e?.message ?? e}`, { gate: 'G3' }))
    }
  }

  /**
   * 更新交接物路径指针或 PLAN 单元状态（路径须落在 projectRoot 标签内，防 .. 穿越）。
   * @param {string} projectRoot 项目根
   * @param {{artifact?: string, path?: string, planId?: string, planStatus?: string,
   *         constraints?: string[]}} patch 变更（constraints=检索套用命中的记忆条目 id，随 planId 更新）
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
      if (patch.planStatus && !['todo', 'doing', 'done'].includes(patch.planStatus)) {
        return fail(ecError('INVALID_INPUT', `非法 PLAN 状态：${patch.planStatus}`, { planId: patch.planId, status: patch.planStatus }))
      }
      if (patch.planStatus) unit.status = patch.planStatus
      if (Array.isArray(patch.constraints)) {
        unit.constraints = patch.constraints.filter((id) => typeof id === 'string').slice(0, 100)
      }
    }
    state.updatedAt = Date.now()
    try {
      // write() 返回落盘路径；Result.value 按 CONTRACT 应为 EcState，供工具/命令直接读取 stage/gates。
      this.write(state, projectRoot)
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
    // 复用同一 state 快照算 role，避免二次 read 造成快照撕裂。
    const role = nextRole(state, DEFAULT_PIPELINE, {
      capabilities: { ...roleDefaults.capabilities },
      thresholds: { ...roleDefaults.thresholds },
    })
    const missing = Object.entries(state.artifacts).filter(([, v]) => !v).map(([k]) => k)
    return [
      `工程流程：阶段=${state.stage}；未过门=${pending.join(',') || '无'}；`
      + `下一岗位=${role.role ?? '(无)'}（阻塞=${role.blockedBy ?? '无'}）`,
      `缺失交接物=${missing.join(',') || '无'}；门规则见 ec_stage 工具，拍板由人确认。`,
      '写业务/核心代码前：先用 ec_memory recall 按模块名+横切关注检索 .project_memory/，把命中条目 id 列进 .project_memory/tmp/PLAN.md 的 constraints；无命中标「无既有约定」。每个并行单元各自检索。',
      '收到「开始工程」时：取当前会话目录作候选，问用户是否在 `<该目录>` 构建并等确认；确认前不写文件，之后所有 ec_* 工具显式传已确认的 projectRoot（勿用宿主 cwd）。',
    ].join('\n')
  }
}
