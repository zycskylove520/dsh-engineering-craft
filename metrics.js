/**
 * metrics.js —— GATE-LOG 门度量记录/回看（CONTRACT §5.4）。
 *
 * 对齐 skill core/gate-metrics.md：落点 <projectRoot>/.project_memory/tmp/GATE-LOG.md
 * （执行临时产物，不进规范层、INDEX 不登记、任务结束可清理）。
 * 六字段：日期(date) / 阶段(stage) / 门(gate) / 结果(outcome: 拦住|通过|绕过) /
 * 缺什么(missing) / 处置(disposition)。每行一条 JSON（bounded 读取）。
 * 无旧路径/旧字段兼容。
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { normalizeProjectRoot, safePathWithin, ecError } from './gate-service.js'
import { joinFor } from './ec-path.js'
import { MEMORY_DIR_NAME, TMP_DIR } from './memory.js'

/** GATE-LOG 文件名（skill 规定 GATE-LOG.md）。 */
export const GATE_LOG_NAME = 'GATE-LOG.md'
/** 六字段对应的结果取值。 */
export const OUTCOMES = Object.freeze(['拦住', '通过', '绕过'])

/**
 * GATE-LOG 绝对路径。
 * @param {string} projectRoot 项目根
 * @returns {string} GATE-LOG 绝对路径
 */
export function gateLogPathOf(projectRoot) {
  return joinFor(normalizeProjectRoot(projectRoot), MEMORY_DIR_NAME, TMP_DIR, GATE_LOG_NAME)
}

/**
 * 记录或回看门度量（工具 ec_gate_metrics 的能力实现）。
 * @param {{action: 'record'|'list', projectRoot?: string, gate?: string, outcome?: string,
 *         stage?: string, missing?: string, disposition?: string, limit?: number}} args 入参
 * @returns {{ok: true, records: Array<object>, truncated: boolean, status?: string}|{ok: false, error: object}} Result
 */
export function metricsAction(args) {
  const action = String(args?.action ?? 'list')
  const projectRoot = args.projectRoot ?? process.cwd()
  const root = safePathWithin(projectRoot, projectRoot)
  if (!root) return { ok: false, error: ecError('INVALID_INPUT', `projectRoot 是空标签：${projectRoot}`, { projectRoot }) }
  const file = gateLogPathOf(root)
  const safe = safePathWithin(file, root)
  if (!safe) return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `日志路径越出项目根：${file}`, { path: file }) }

  if (action === 'record') {
    if (!['G1', 'G2', 'G3'].includes(args.gate)) {
      return { ok: false, error: ecError('INVALID_INPUT', `非法门 ${args.gate}`, { gate: args.gate }) }
    }
    if (!OUTCOMES.includes(args.outcome)) {
      return { ok: false, error: ecError('INVALID_INPUT', `非法结果 ${args.outcome}（须为 拦住|通过|绕过）`, { outcome: args.outcome }) }
    }
    const at = Date.now()
    const record = {
      date: new Date(at).toISOString().slice(0, 10),
      stage: String(args.stage ?? '').slice(0, 60),
      gate: args.gate,
      outcome: args.outcome,
      missing: String(args.missing ?? '').slice(0, 500),
      disposition: String(args.disposition ?? '').slice(0, 500),
    }
    try {
      mkdirSync(joinFor(root, MEMORY_DIR_NAME, TMP_DIR), { recursive: true })
      appendFileSync(safe, JSON.stringify(record) + '\n', 'utf8')
      return { ok: true, records: [record], truncated: false, status: 'recorded' }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `写 GATE-LOG 失败：${e?.message ?? e}`, { path: safe }) }
    }
  }

  if (action === 'list') {
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100))
    if (!existsSync(safe)) return { ok: true, records: [], truncated: false, status: 'empty', path: safe }
    let text = ''
    try { text = readFileSync(safe, 'utf8') } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `读 GATE-LOG 失败：${e?.message ?? e}`, { path: safe }) }
    }
    const all = text.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    const tail = all.slice(-limit).reverse()
    return { ok: true, records: tail, truncated: all.length > tail.length, status: 'listed', path: safe }
  }

  return { ok: false, error: ecError('INVALID_INPUT', `未知 metrics action ${action}`, { action }) }
}
