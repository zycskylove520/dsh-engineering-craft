/**
 * tools.js —— 四个工具 spec（CONTRACT §5，defineTool 输入）。
 * 每个 spec 交 index.js 统一 ctx.tools.register(defineTool(spec))；
 * parameters 是标准 JSON Schema object，每个 type:'object' 都显式写 additionalProperties。
 * execute(args, exec) 返回普通对象，失败为 {ok:false,error:{code,...}}；exec.signal 可取消。
 */
import EcGate, { ecError, resolveAllowedRoot } from './gate-service.js'
import { artifactAction } from './artifacts.js'
import { memoryAction } from './memory.js'
import { metricsAction } from './metrics.js'

/** 共享门服务实例（状态核心唯一写口）。 */
export const ecGate = new EcGate()

/** 标准 JSON Schema：可取消检查点（exec.signal 已 abort 时不继续执行副作用）。 */
function cancelled(exec) {
  return Boolean(exec?.signal?.aborted)
}

/** 取消结果。 */
const CANCELLED = () => ({ ok: false, error: ecError('INVALID_INPUT', '工具执行已取消', { reason: 'aborted' }) })

/**
 * 工具 spec 统一形状（CONTRACT §2.3）。
 * @typedef {{name: string, description: string, parameters: object, output?: object,
 *            execute: (args: object, exec?: {signal?: AbortSignal}) => Promise<object>}} ToolSpec
 */

/**
 * ec_stage spec：查询阶段/门、记录人确认或 G3 证据、取下一岗位。
 * @type {ToolSpec}
 */
export const ecStageTool = {
  name: 'ec_stage',
  description: '查询当前工程阶段与门状态、尝试过门、或取下一个应启动的岗位；门未过时拒绝进入下游动作。',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string', enum: ['query', 'confirm-gate', 'next-role'], default: 'query',
        description: 'query=只读状态；confirm-gate=记录人确认/证据；next-role=返回下一岗位',
      },
      gate: { type: 'string', enum: ['G1', 'G2', 'G3'], description: 'confirm-gate 时必填' },
      evidence: { type: 'string', description: 'G3 confirm-gate 时必填：命令+输出摘要（非全文）' },
      userConfirmed: { type: 'boolean', description: 'G1/G2 confirm-gate 时必填：确认卡由人点过才置 true，agent 不得自报' },
      capabilities: {
        type: 'object',
        properties: { subagent: { type: 'boolean', description: '能力门：false 关闭研发岗形态 B，退回形态 A 顺序岗位' } },
        additionalProperties: false,
        description: '形态 B 能力门，缺省视为可用（DSH 原生 subagent）',
      },
      thresholds: {
        type: 'object',
        properties: { minFilesForParallel: { type: 'integer', description: '收益门：最小并行单元数，默认 2' } },
        additionalProperties: false,
        description: '形态 B 收益门阈值',
      },
      projectRoot: { type: 'string', description: '项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录' },
    },
    required: ['mode'],
    additionalProperties: false,
  },
  async execute(args, exec) {
    if (cancelled(exec)) return CANCELLED()
    const root = resolveAllowedRoot(args.projectRoot ?? process.cwd())
    if (!root) return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签（须非空字符串）', {}) }
    // 坏 state.json / 字段残缺时 ecGate.read 会抛领域错误（EcError）；统一转成 Result，
    // 不让裸错误对象穿透工具层（CONTRACT §0：可恢复失败用 Result，禁止裸 SyntaxError）。
    try {
      const mode = args.mode ?? 'query'
      const roleOpts = { capabilities: args.capabilities, thresholds: args.thresholds }
      if (mode === 'next-role') {
        const role = ecGate.nextRole(root, roleOpts)
        return { ok: true, ...role }
      }
      if (mode === 'confirm-gate') {
        if (!args.gate) return { ok: false, error: ecError('INVALID_INPUT', 'confirm-gate 须指定 gate', {}) }
        // G1/G2 只由人拍板：工具调用者须显式声明 userConfirmed；G3 走证据路径。
        if (args.gate === 'G3') {
          const input = String(args.evidence ?? '')
          const sep = input.indexOf('::')
          const command = (sep >= 0 ? input.slice(0, sep) : input).trim()
          const outputDigest = (sep >= 0 ? input.slice(sep + 2) : '').trim()
          const r = ecGate.confirmG3(root, { command, outputDigest })
          return r.ok ? { ok: true, ...r.value } : r
        }
        if (args.userConfirmed !== true) {
          return {
            ok: false,
            error: ecError('NOT_USER_CONFIRMED', 'G1/G2 须人拍板：确认卡点击后由 Host 命令传入 userConfirmed=true', { gate: args.gate }),
          }
        }
        const r = ecGate.confirmGate(root, args.gate, {})
        return r.ok ? { ok: true, ...r.value } : r
      }
      const state = ecGate.read(root)
      const gateResults = Object.fromEntries(['G1', 'G2', 'G3'].map((g) => [g, ecGate.check(root, g)]))
      const role = ecGate.nextRole(root, roleOpts)
      const missingArtifacts = Object.entries(state.artifacts).filter(([, v]) => !v).map(([k]) => k)
      return {
        ok: true,
        stage: state.stage,
        gates: Object.fromEntries(Object.entries(state.gates).map(([g, v]) => [g, v.passed])),
        gateResults,
        nextRole: role.role,
        mode: role.mode ?? 'A',
        parallelRoles: role.roles ?? [],
        missingArtifacts,
        blockedBy: role.blockedBy ?? null,
      }
    } catch (e) {
      if (e && typeof e === 'object' && typeof e.code === 'string') return { ok: false, error: e }
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `读取工程状态失败：${e?.message ?? e}`, {}) }
    }
  },
}

/**
 * ec_artifact spec：生成交接物模板或校验结构，只返回路径指针。
 * @type {ToolSpec}
 */
export const ecArtifactTool = {
  name: 'ec_artifact',
  description: '按交接物类型生成模板文件（绝对路径指针）或校验已有交接物结构，不写正文以外的文件。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'validate'], description: 'create=写模板；validate=只读校验' },
      kind: { type: 'string', enum: ['prd', 'adr', 'contract', 'plan', 'brief', 'release', 'testReport', 'findings'] },
      path: { type: 'string', description: '目标路径；须落在 projectRoot 标签内（防 .. 穿越）' },
      projectRoot: { type: 'string', description: '项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录' },
    },
    required: ['action', 'kind', 'path'],
    additionalProperties: false,
  },
  async execute(args, exec) {
    if (cancelled(exec)) return CANCELLED()
    const root = resolveAllowedRoot(args.projectRoot ?? process.cwd())
    if (!root) return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签（须非空字符串）', {}) }
    // 注入指针登记回调而非反向 import：登记失败由 artifactAction 转成 {ok:false,error} 返回。
    // ecGate.update 内部读 state.json 可能抛领域错误（坏 JSON）；统一兜成 Result。
    try {
      return artifactAction({
        ...args,
        projectRoot: root,
        update: (patch) => ecGate.update(root, patch),
      })
    } catch (e) {
      if (e && typeof e === 'object' && typeof e.code === 'string') return { ok: false, error: e }
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `交接物操作失败：${e?.message ?? e}`, {}) }
    }
  },
}

/**
 * ec_memory spec：初始化/写入/检索 .project_memory/ 规范层。
 * @type {ToolSpec}
 */
export const ecMemoryTool = {
  name: 'ec_memory',
  description: '初始化或按 INDEX 线索读写 .project_memory/ 规范层；只存规范，不写会话流水。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['init', 'write', 'query'], description: 'init=建骨架；write=写规范带来源+日期；query=按需读' },
      projectRoot: { type: 'string', description: '项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录' },
      layer: {
        type: 'string', enum: ['architecture', 'conventions', 'project', 'open-questions', 'index'],
        description: 'write/query 的目标层（index 指 INDEX.md）',
      },
      content: { type: 'string', description: 'write 时正文；须含来源与日期指针' },
      query: { type: 'string', description: 'query 时的检索线索（不倾倒全目录）' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  async execute(args, exec) {
    if (cancelled(exec)) return CANCELLED()
    const root = resolveAllowedRoot(args.projectRoot ?? process.cwd())
    if (!root) return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签（须非空字符串）', {}) }
    return memoryAction({ ...args, projectRoot: root })
  },
}

/**
 * ec_gate_metrics spec：记录/回看 GATE-LOG，bounded 输出。
 * @type {ToolSpec}
 */
export const ecGateMetricsTool = {
  name: 'ec_gate_metrics',
  description: '记录或回看 GATE-LOG 门度量（每次门拦截/放行的原因与指针），用于反复拦截时回写规范。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['record', 'list'], default: 'list' },
      gate: { type: 'string', enum: ['G1', 'G2', 'G3'], description: 'record 时必填' },
      outcome: { type: 'string', enum: ['blocked', 'passed'], description: 'record 时必填' },
      reason: { type: 'string', description: 'record 时：拦截/放行原因摘要（bounded）' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'list 时最多返回条数' },
      projectRoot: { type: 'string', description: '项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  async execute(args, exec) {
    if (cancelled(exec)) return CANCELLED()
    const root = resolveAllowedRoot(args.projectRoot ?? process.cwd())
    if (!root) return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签（须非空字符串）', {}) }
    return metricsAction({ ...args, projectRoot: root })
  },
}

/** 四个工具 spec（CONTRACT §5），供 index.js 批量注册。 */
export const ECO_TOOLS = Object.freeze([ecStageTool, ecArtifactTool, ecMemoryTool, ecGateMetricsTool])
