/**
 * tools.js —— 四个工具 spec（CONTRACT §5，defineTool 输入）。
 * 每个 spec 交 index.js 统一 ctx.tools.register(defineTool(spec))；
 * parameters 是标准 JSON Schema object，每个 type:'object' 都显式写 additionalProperties。
 * execute(args, exec) 返回普通对象，失败为 {ok:false,error:{code,...}}；exec.signal 可取消。
 */
import EcGate, { ecError, resolveAllowedRoot, normalizeToolError } from './gate-service.js'
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

/** 领域错误归一化统一在 gate-service.normalizeToolError（此处 import 复用）。 */

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
  description: '查询当前工程阶段与门状态、尝试过门、取下一个应启动的岗位，或开新任务（重置六岗状态）；门未过时拒绝进入下游动作。识别到用户提出新需求时，先调 mode=new-task 归档旧状态并重置，再严格按六岗位流水线推进——不允许跳过任何岗位，小任务也要逐岗走完（可在岗位内评估后直接把该岗交接物标记为完成）。',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string', enum: ['query', 'confirm-gate', 'next-role', 'new-task'], default: 'query',
        description: 'query=只读状态；confirm-gate=记录人确认/证据；next-role=返回下一岗位；new-task=归档旧 state 并把六岗位/门/交接物重置为初始态（工程记忆不动）。识别到新需求时先调它，再走六岗',
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
    // FIX-required-default：mode 有 default='query'，不再列 required——否则 execute 的
    // args.mode ?? 'query' 兜底永远不生效，省略 mode 的调用在 schema 层就被拒。
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
      if (mode === 'new-task') {
        const r = ecGate.resetForNewTask(root)
        // 扁平化 stage 与 query 模式响应一致，同时带完整 state 与归档路径供追溯。
        return r.ok ? { ok: true, archived: r.value.archived, stage: r.value.state.stage, state: r.value.state } : r
      }
      if (mode === 'next-role') {
        const role = ecGate.nextRole(root, roleOpts)
        return { ok: true, ...role }
      }
      if (mode === 'confirm-gate') {
        if (!args.gate) return { ok: false, error: ecError('INVALID_INPUT', 'confirm-gate 须指定 gate', {}) }
        // G1/G2 只由人拍板：工具调用者须显式声明 userConfirmed；G3 走证据路径。
        if (args.gate === 'G3') {
          const input = String(args.evidence ?? '').trim()
          if (!input) {
            return { ok: false, error: ecError('NO_EVIDENCE', 'G3 confirm-gate 须提供 evidence（命令::输出摘要）', { gate: 'G3' }) }
          }
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
      return normalizeToolError(e, '读取工程状态失败')
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
      kind: { type: 'string', enum: ['prd', 'adr', 'contract', 'plan', 'brief', 'release', 'testReport', 'findings', 'progress'] },
      path: { type: 'string', description: '目标路径（省略则落 .project_memory/tmp/<文件名>）；必须落在 .project_memory/tmp/ 内——落在项目根外返回 PATH_OUT_OF_ROOT，落在项目根内但 tmp 外返回 ARTIFACT_OUTSIDE_TMP' },
      projectRoot: { type: 'string', description: '项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录' },
    },
    required: ['action', 'kind'],
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
      return normalizeToolError(e, '交接物操作失败')
    }
  },
}

/**
 * ec_memory spec：初始化/写入/检索 .project_memory/ 规范层。
 * @type {ToolSpec}
 */
export const ecMemoryTool = {
  name: 'ec_memory',
  description: '初始化或按 INDEX 线索读写 .project_memory/ 工程记忆（6 职责目录+3 根文件+tmp）；write=写规范（职责目录强制五件套+内容质量软警告，tmp 与 3 根文件 index/status/open-questions 免校验自由文本）；recall=写码前检索套用（字面整句优先、零命中时分词/二元组回退；相关性排序），命中条目 id 列入 PLAN constraints；audit=建库自检并给 qualityScore（RULE 占比/配方覆盖/证据模式/清单式/幻觉条目/PLAN），qualityScore≥60 才算过自检；patch=按 id 条目级更新。写记忆时优先写可套用的 RULE 配方（抄哪个文件→改哪几处→怎么验证），少写 FACT 清单；bug 用 [OPEN ID] 五件套，别写成散文。\n五件套落盘格式（职责目录 write 必须逐行齐全，缺一即 INVALID_MEMORY_ENTRY）：\n  ## [RULE R-XXX-01] 一句话规则\n  证据: 项目内相对路径（模式描述，不写瞬时行号；行号可放括号辅助）\n  记录: YYYY-MM-DD · 实测|推断|用户约定\n（标题前缀 ## 可省，但 kind、稳定 id、证据行、记录行四者缺一不可；证据须指向模式而非仅路径:行号；等级与状态正交，状态另起「状态: 待复核/已复核」行。tmp 与 3 根文件免校验——根文件是导航/快照/清单，写成五件套也行但不强制。）\naudit 扣分维度可直接对照其 warnings 的 rule 字段：low-rule-ratio（RULE 占比<35%）、few-recipes（配方<3 条）、recipe-no-verify、list-not-rule（陈述含计数/顿号并列清单）、evidence-no-pattern（证据只有路径:行号）、plugin-internal-as-project-fact、missing-boundary（每篇开头缺「本篇管…不管…」）、single-file-dump（目录≥8 条却只写 overview.md）、missing-plan。注意：职责目录的 overview.md 是 init 生成的边界声明导航桩，audit 已豁免其 no-five-part-entries（不会因空桩扣 48 分）；但真正主题文件散文无条目仍会报。改完重跑 audit 看 qualityScore。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string', enum: ['init', 'write', 'query', 'recall', 'audit', 'patch'],
        description: 'init=建骨架（6目录+3根文件+标记+tmp，职责目录各建 overview.md 桩）；write=写规范（职责目录五件套校验+内容软警告：清单式/纯行号证据/插件实现幻觉/overview 过大；tmp 与 3 根文件免校验自由文本；file 参数指定主题文件名，职责目录按主题分篇，overview 只留总览）；query=按需读；recall=检索套用（字面整句优先，零命中分词/二元组回退，按相关性排序返回 id/kind/matchMode）；audit=建库自检并给 qualityScore（RULE占比/配方覆盖/证据模式/清单式/幻觉/PLAN/单篇堆积，≥60 合格；init 的 overview 桩已豁免 no-five-part-entries）；patch=按 id 改一条（content 或 status）',
      },
      projectRoot: { type: 'string', description: '项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录' },
      layer: {
        type: 'string',
        enum: ['index', 'status', 'open-questions', 'architecture', 'conventions', 'api-contracts', 'data-model', 'testing', 'build', 'tmp'],
        description: 'write/query/patch 的目标层；recall 时作为可选目录过滤',
      },
      file: { type: 'string', description: '职责目录内的文件名（如 architecture/engine.md 的 engine，省略默认 overview）' },
      content: { type: 'string', description: 'write 时正文（职责目录须五件套；tmp 与 index/status/open-questions 三根文件自由文本）；patch 时为该条新正文' },
      query: { type: 'string', description: 'query/recall 的检索线索（recall 全规范层扫描，字面整句优先、零命中分词回退，按相关性排序返回 id/kind/matchMode）' },
      kind: { type: 'string', enum: ['RULE', 'FACT', 'DECISION', 'OPEN'], description: 'recall 时按陈述类型过滤' },
      id: { type: 'string', description: 'patch 时的稳定 id（须在目标文件内唯一命中）' },
      status: { type: 'string', description: 'patch 时追加/替换「状态: 」行（如 已复核/待复核）' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  async execute(args, exec) {
    if (cancelled(exec)) return CANCELLED()
    const root = resolveAllowedRoot(args.projectRoot ?? process.cwd())
    if (!root) return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签（须非空字符串）', {}) }
    try {
      return memoryAction({ ...args, projectRoot: root })
    } catch (e) {
      return normalizeToolError(e, '工程记忆操作失败')
    }
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
      outcome: { type: 'string', enum: ['拦住', '通过', '绕过'], description: 'record 时必填' },
      stage: { type: 'string', description: 'record 时：产品/架构/研发/测试/评审/运维' },
      missing: { type: 'string', description: 'record 时：缺什么（六字段之一）' },
      disposition: { type: 'string', description: 'record 时：处置（六字段之一）' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'list 时最多返回条数' },
      projectRoot: { type: 'string', description: '项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录' },
    },
    // FIX-required-default：action 有 default='list'，不列 required，省略时 execute 兜底生效。
    // removals: required: ['action']
    additionalProperties: false,
  },
  async execute(args, exec) {
    if (cancelled(exec)) return CANCELLED()
    const root = resolveAllowedRoot(args.projectRoot ?? process.cwd())
    if (!root) return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签（须非空字符串）', {}) }
    try {
      return metricsAction({ ...args, projectRoot: root })
    } catch (e) {
      return normalizeToolError(e, '门度量操作失败')
    }
  },
}

/** 四个工具 spec（CONTRACT §5），供 index.js 批量注册。 */
export const ECO_TOOLS = Object.freeze([ecStageTool, ecArtifactTool, ecMemoryTool, ecGateMetricsTool])
