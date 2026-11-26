/**
 * gate-service.js —— EcState 的唯一所有者（CONTRACT §2.2，按架构收敛改为文件落盘）。
 * 门状态存 <projectRoot>/.ec-state/state.json（stateVersion=2），跨会话按项目连续；
 * 所有写操作集中在本模块，工具/命令只转发。路径按标签形态规范化，并做 projectRoot 内的防 .. 穿越校验。
 * 无旧路径/旧版本兼容：只读新路径、版本必须为 STATE_VERSION，否则报错。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
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
    // FIX-gates-deep-merge：逐门深合并。浅合并在只传 {G1:{requireEvidence:true}} 时
    // 会把 G1 的 requiredArtifacts/requireUserConfirm 冲掉 → 门被绕过（实测）。
    // 与 index.js apply() 的逐门合并口径一致。
    const merged = {}
    for (const g of ['G1', 'G2', 'G3']) {
      merged[g] = { ...DEFAULT_GATES[g], ...(config?.gates?.[g] || {}) }
    }
    this.gates = merged
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
    // v2 字段自愈：缺 pipeline/metrics/releaseDecision 等新增字段时用 initialState 补齐（内存），
    // 避免下游 deep 访问抛裸 TypeError（实测缺 metrics → confirmGate 写 lastGate 崩），
    // 且不破坏"v1 不迁移"的约定——version 不符仍在上面直接拒绝。
    const base = initialState(projectRoot)
    for (const k of ['pipeline', 'metrics', 'releaseDecision', 'updatedAt']) {
      if (parsed[k] === undefined) parsed[k] = base[k]
    }
    if (!Array.isArray(parsed.plan)) parsed.plan = []
    if (!parsed.artifacts || typeof parsed.artifacts !== 'object') {
      throw ecError('STORAGE_UNAVAILABLE', `state.json artifacts 字段不合法：${file}`, { file })
    }
    // artifacts 的新键（如 progress）补齐，避免 Object.entries 漏键
    for (const k of Object.keys(base.artifacts)) if (!(k in parsed.artifacts)) parsed.artifacts[k] = null
    // gates 每门必须是对象且 passed 为布尔（否则 promptSection/gateResults 会 TypeError）。
    for (const g of ['G1', 'G2', 'G3']) {
      if (!parsed.gates[g] || typeof parsed.gates[g] !== 'object' || typeof parsed.gates[g].passed !== 'boolean') {
        throw ecError('STORAGE_UNAVAILABLE', `state.json 门字段不合法：${g}`, { file, gate: g })
      }
    }
    // stage 必须是合法阶段：'bogus' 会让 advanceStage 的 indexOf=-1，任意门把阶段推到 design/coding。
    if (!STAGE_ORDER.includes(parsed.stage)) {
      throw ecError('STORAGE_UNAVAILABLE', `state.json stage 不合法：${parsed.stage}`, { file, stage: parsed.stage })
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
   * 开新任务：把当前 state 归档到 .ec-state/history/，再把主 state 重置为初始态。
   * 工程记忆（.project_memory/）与 activeRoot 不动——换的是"本次任务的流程状态"，
   * 不是项目本身。归档保证误判也能恢复（history 内按时间戳命名，永不覆盖）。
   * @param {string} projectRoot 项目根
   * @returns {{ok:true, value:{archived:string, state:object}}|{ok:false, error:object}} Result
   */
  resetForNewTask(projectRoot) {
    try {
      const root = normalizeProjectRoot(projectRoot)
      if (!root) return fail(ecError('INVALID_INPUT', 'projectRoot 是空标签', { projectRoot }))
      const dir = joinFor(root, STATE_DIR_NAME)
      const file = statePathOf(root)
      let archived = null
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8')
        // 归档前校验：坏 state 不归档成垃圾，但仍允许重置（返回错误让上层决定是否修）。
        try { JSON.parse(text) } catch {
          return fail(ecError('STORAGE_UNAVAILABLE', `state.json 解析失败，无法归档：${file}`, { file }))
        }
        const historyDir = joinFor(dir, 'history')
        mkdirSync(historyDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        archived = joinFor(historyDir, `state-${stamp}.json`)
        writeFileSync(archived, text, 'utf8')
      }
      const fresh = initialState(root)
      this.write(fresh, root)
      return ok({ archived, state: fresh })
    } catch (e) {
      return fail(ecError('STORAGE_UNAVAILABLE', `开新任务重置失败：${e?.message ?? e}`, {}))
    }
  }

  /**
   * 六岗是否已全部完成（判断"是否该开新任务"）：所有交接物路径非空。
   * @param {object} state EcState
   * @returns {boolean}
   */
  static allRolesComplete(state) {
    const artifacts = state?.artifacts ?? {}
    return Object.values(artifacts).every((v) => Boolean(v))
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
      // FIX-gate-at-zero：at 是确认时间戳，0/负数不是有效确认时刻；
      // 旧实现 Number.isFinite(0)=true 接受 at=0，但 checkGate 用 !gate.at 判未确认，
      // 落盘"已过"而面板"未确认"自相矛盾（实测）。这里只接受正数。
      at: Number.isFinite(meta.at) && meta.at > 0 ? meta.at : Date.now(),
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
      // FIX-g3-evidence：分别截断命令与摘要，再拼接——整体 slice(0,500) 会在命令过长时
      // 把命令+摘要整段尾部截掉，G3 证据只剩半条命令，摘要语义丢失（实测）。
      evidence: `${String(evidence.command ?? '').slice(0, 240)} :: ${String(evidence.outputDigest ?? '').slice(0, 240)}`,
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
    // P0-3：没有已确认项目根时，只输出红线，不输出任何阶段/门数字（宁可少说，别说错项目的）。
    if (!projectRoot) {
      return [
        '工程套件：尚未确认项目根。收到「开始工程」时：取当前会话目录作候选，问用户是否在 `<该目录>` 构建并等确认；确认前不写文件。',
        '用户确认后用 `/ec use <项目根>` 落定；之后所有 ec_* 工具显式传该 projectRoot（勿用宿主 cwd）。',
      ].join('\n')
    }
    let state
    try { state = this.read(projectRoot) } catch {
      return [`工程套件：项目根=${projectRoot}，但状态读取失败（见 ec_stage）；先修复 .ec-state/state.json 再注入流程状态。`].join('\n')
    }
    const pending = ['G1', 'G2', 'G3'].filter((g) => !state.gates[g].passed)
    // 复用同一 state 快照算 role，避免二次 read 造成快照撕裂。
    const role = nextRole(state, DEFAULT_PIPELINE, {
      capabilities: { ...roleDefaults.capabilities },
      thresholds: { ...roleDefaults.thresholds },
    })
    const missing = Object.entries(state.artifacts).filter(([, v]) => !v).map(([k]) => k)
    const allComplete = EcGate.allRolesComplete(state)
    const lines = [
      `工程套件：已确认项目根=${projectRoot}`,
      `流程：阶段=${state.stage}；未过门=${pending.join(',') || '无'}；`
      + `下一岗位=${role.role ?? '(无)'}（阻塞=${role.blockedBy ?? '无'}）`,
      `缺失交接物=${missing.join(',') || '无'}；门规则见 ec_stage 工具，拍板由人确认。`,
      // FIX-enforce-pipeline：每轮注入六岗硬纪律——堵住"增量小功能直接改、不走完整流水线"偷懒。
      // 允许在岗位内评估后把某岗直接标完成（落交接物），但不允许跳过岗位本身。
      '流程纪律（硬）：所有代码任务必须严格走 product→architect→developer→tester→reviewer→ops 六岗位流水线，不得跳过任何岗位、不得以"小功能/增量"为由直接改代码。若某岗位经评估确不适用，也要按流程落该岗交接物把它标记为完成（ec_artifact create 落盘即登记），再由 ec_stage(mode=next-role) 推进到下一岗——岗位可以"快速完成"，不能被跳过。',
    ]
    if (allComplete) {
      // FIX-new-task-aware：六岗全完成时，提示 agent 识别新需求要主动重置（用户不会每次说"开始工程"）。
      // agent 看到本轮用户提的是新需求（而非对上一任务的追问/收尾）时，先调 ec_stage(mode='new-task')
      // 归档旧状态并重置，再从 product 岗重新走六岗；不要复用上一需求的全完成状态直接开工。
      lines.push('当前六岗位已全部完成（上一需求已交付）。若用户本轮提出的是**新需求**（不是对上一需求的追问或收尾），先主动调 `ec_stage(mode="new-task")`（或 `/ec new-task`）归档旧状态并重置六岗，再从 product 岗重新走完整流水线；工程记忆与已确认项目根保持不变。旧状态可在 .ec-state/history/ 找回。')
    }
    // P1-2：仅当记忆库「尚无实质内容」时注入建库指令，避免每轮代码任务塞建库噪音。
    // 字面量而非 import memory.js（memory.js 已 import gate-service，避免 ESM 环）。
    // BUG-fix(lazy-init)：此前用 existsSync(memDir) 判断——init 建完空骨架目录就存在，
    // 下一轮 prompt 立刻切到检索纪律分支，建库四步指令消失，agent 通读/落盘全靠自觉而偷懒。
    // 改为按「内容完成度」判断：五件套规范条目数不足或 tmp/PLAN.md 未落盘，都视为建库未完成，继续注入。
    const memDir = joinFor(projectRoot, '.project_memory')
    const bootstrapped = this.memoryBootstrapped(memDir)
    if (!bootstrapped.done) {
      // BUG-fix(style-reading)：通读要求显式列出风格维度与各自落篇位置——
      // 新旧代码风格一致靠 conventions 里的风格篇，不能只说一句"通读"。
      lines.push(
        `工程记忆建库未完成（规范条目 ${bootstrapped.entries}/12，tmp/PLAN.md${bootstrapped.hasPlan ? '已落盘' : '未落盘'}；达标=条目≥12 且 PLAN 已落盘，此提示才会消失）：建库五步——`,
        '①先 ec_memory init 建骨架（已建过则跳过）；',
        '②按顶层目录分批通读源码（不读透不进下一步），通读时至少记录六类信息：设计风格与分层架构（→ architecture/）、代码编写风格与命名习惯（→ conventions/style.md）、注释习惯（→ conventions/comments.md）、错误处理与日志模式（→ conventions/erroring.md）、对外接口契约（→ api-contracts/）、数据结构约定（→ data-model/）；这些风格维度缺一不可，新代码与旧代码风格保持一致全靠它们；',
        '③在 .project_memory/tmp/PLAN.md 写逻辑文档树+覆盖映射（tmp 免五件套）；',
        '④按五件套落盘 6 职责目录+3 根文件（职责目录按主题分篇，见下）；',
        '⑤跑 ec_memory audit，qualityScore≥60 且贴出报告才算过自检。',
        '建库内容硬要求（audit 会逐条计分）：',
        '· 职责目录按主题分篇：每个目录的 overview.md 只写总览+指针（≤2KB），具体条目按主题写进同目录的 <topic>.md（如 architecture/ 拆 config.md / engine.md / model.md，conventions/ 拆 style.md / comments.md / erroring.md / model.md，api-contracts/ 拆 core.md / model.md / data.md）。每个目录≥8 条却只有 overview.md 一篇会被 audit 标 single-file-dump 扣分；ec_memory write 用 file 参数指定主题文件名，不传默认 overview。',
        '· RULE 占比≥35%：FACT 只写"非写不可的客观事实"，其余全部写成可套用的 RULE/DECISION；只有项目照片没有配方的库判不合格。',
        '· 高频动作必须有配方（≥3 条带步骤的 RULE）：新增模块/新增接口/新增数据集等高频动作，每条写清「抄哪个文件 → 改哪几处 → 怎么验证」，验证步骤不可省。',
        '· 证据主体 = 文件路径 + 模式描述（"在 config_manager.py 的 link 解析流水线里"）；行号只能放括号里辅助，删掉行号仍要能定位。只写 a.py:1; b.py:2 会被标 evidence-no-pattern。',
        '· 清单式计数（183 个 .py / 7 类引擎 / 3 处 bug）一律改写成规律，否则下个月就过期（list-not-rule）。',
        '· open-questions.md 每条 bug 必须是 [OPEN BUG-NN] 五件套（含证据行/记录行/状态行），禁止写成 "- **BUG-01** ..." 散文列表——散文进不了 recall，修 bug 时 agent 一条都捞不到。',
        '· 只写项目本身的事实；禁止把 .engineering-craft 标记、init 产物等工程套件自身实现写成项目约定（那是幻觉条目）。',
      )
    } else {
      lines.push('写业务/核心代码前：先用 ec_memory recall 按模块名+横切关注检索 .project_memory/（按相关性排序），把命中条目 id 列进 .project_memory/tmp/PLAN.md 的 constraints；无命中标「无既有约定」。每个并行单元各自检索。')
    }
    lines.push('项目根变更用 `/ec use <项目根>`；未确认前不得写文件。')
    return lines.join('\n')
  }

  /**
   * 记忆库「内容完成度」探测（供 promptSection 建库分支判断；字面量实现，不 import memory.js）。
   * 完成标准：规范层五件套条目数达到阈值（12）且 tmp/PLAN.md 已落盘。
   * 空骨架（刚 init、只有模板桩）不算完成——防止 agent init 后建库指令立刻消失。
   * @param {string} memDir 记忆目录绝对路径
   * @returns {{done: boolean, entries: number, hasPlan: boolean}} 探测结果
   */
  memoryBootstrapped(memDir) {
    const BOOTSTRAP_MIN_ENTRIES = 12
    // FIX-boot-count：必须与 memory.js 的 HEADER_RE 同源——锚行首（容错缩进/# 标题/- 列表前缀）
    // 且要求合法 id（[A-Za-z][\w-]*）。旧正则 anywhere 匹配，散文里引用 `[FACT   ]`/`[OPEN bad id]`
    // 也被计入，12 行垃圾就把建库判成完成、提前撤掉建库指令（实测）。
    const HEADER_LIKE = /^\s*(?:#{1,6}\s+|[-*+]\s+)?\[(?:RULE|FACT|DECISION|OPEN)\s+[A-Za-z][\w-]*\]/m
    let entries = 0
    const countMd = (d) => {
      let list = []
      try { list = readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const ent of list) {
        const p = joinFor(d, ent.name)
        if (ent.isDirectory()) {
          if (ent.name === 'tmp') continue
          countMd(p)
        } else if (ent.name.endsWith('.md')) {
          try {
            for (const line of readFileSync(p, 'utf8').split('\n')) {
              if (HEADER_LIKE.test(line)) entries += 1
            }
          } catch { /* 读不了不计 */ }
        }
      }
    }
    countMd(memDir)
    const hasPlan = existsSync(joinFor(memDir, 'tmp', 'PLAN.md'))
    return { done: entries >= BOOTSTRAP_MIN_ENTRIES && hasPlan, entries, hasPlan }
  }
}
