/**
 * metrics.js —— GATE-LOG 门度量记录/回看（CONTRACT §5.4）。
 * 存 <projectRoot>/.engineering-craft/gate-log.jsonl（每行一条 JSON，bounded 读取）；
 * 每次门拦截/放行都留原因与指针，供反复拦截时回写规范。路径做项目根白名单校验。
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR_NAME, normalizeProjectRoot, safePathWithin, ecError } from './gate-service.js'

/** GATE-LOG 文件名。 */
export const GATE_LOG_NAME = 'gate-log.jsonl'

/**
 * GATE-LOG 绝对路径。
 * @param {string} projectRoot 项目根
 * @returns {string} jsonl 绝对路径
 */
export function gateLogPathOf(projectRoot) {
  return join(normalizeProjectRoot(projectRoot), STATE_DIR_NAME, GATE_LOG_NAME)
}

/**
 * 记录或回看门度量（工具 ec_gate_metrics 的能力实现）。
 * @param {{action: 'record'|'list', projectRoot?: string, gate?: string, outcome?: 'blocked'|'passed',
 *         reason?: string, limit?: number}} args 入参
 * @returns {{ok: true, records: Array<{gate: string, outcome: string, reason: string, at: number, evidencePath: string}>,
 *           truncated: boolean, status?: string}|{ok: false, error: object}} Result
 */
export function metricsAction(args) {
  const action = String(args?.action ?? 'list')
  const projectRoot = args.projectRoot ?? process.cwd()
  const root = safePathWithin(projectRoot, projectRoot)
  if (!root) return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `项目根非法：${projectRoot}`, { projectRoot }) }
  const file = gateLogPathOf(root)
  const safe = safePathWithin(file, root)
  if (!safe) return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `日志路径越出项目根：${file}`, { path: file }) }

  if (action === 'record') {
    if (!['G1', 'G2', 'G3'].includes(args.gate)) {
      return { ok: false, error: ecError('INVALID_INPUT', `非法门 ${args.gate}`, { gate: args.gate }) }
    }
    if (!['blocked', 'passed'].includes(args.outcome)) {
      return { ok: false, error: ecError('INVALID_INPUT', `非法结果 ${args.outcome}`, { outcome: args.outcome }) }
    }
    const record = {
      gate: args.gate,
      outcome: args.outcome,
      reason: String(args.reason ?? '').slice(0, 500),
      at: Date.now(),
      evidencePath: safe,
    }
    try {
      mkdirSync(join(root, STATE_DIR_NAME), { recursive: true })
      appendFileSync(safe, JSON.stringify(record) + '\n', 'utf8')
      return { ok: true, records: [record], truncated: false, status: 'recorded' }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `写 GATE-LOG 失败：${e?.message ?? e}`, { path: safe }) }
    }
  }

  if (action === 'list') {
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100))
    if (!existsSync(safe)) return { ok: true, records: [], truncated: false, status: 'empty' }
    let text = ''
    try { text = readFileSync(safe, 'utf8') } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `读 GATE-LOG 失败：${e?.message ?? e}`, { path: safe }) }
    }
    const all = text.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    const tail = all.slice(-limit).reverse()
    return { ok: true, records: tail, truncated: all.length > tail.length, status: 'listed' }
  }

  return { ok: false, error: ecError('INVALID_INPUT', `未知 metrics action ${action}`, { action }) }
}
