/**
 * memory.js —— .project_memory/ 规范层的 init/write/query（CONTRACT §5.3）。
 * 只存规范不写会话流水；目录名冲突时退到 .project_memory_engineer/ 并打标记（ADR §8）。
 * 写入内容必须含来源与日期指针（practices.md）；路径做项目根白名单校验。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ecError, safePathWithin } from './gate-service.js'

/** 规范层目录名。 */
export const MEMORY_DIR_NAME = '.project_memory'
export const MEMORY_FALLBACK_DIR_NAME = '.project_memory_engineer'

/** 允许的层（"index" 单指 INDEX.md）。 */
const LAYERS = ['index', 'architecture', 'conventions', 'project', 'open-questions']

/**
 * 解析规范层目标路径：优先 .project_memory/，若该名字被非目录占用则退到备选目录。
 * @param {string} projectRoot 项目根
 * @param {string} layer 层名
 * @returns {{path: string, dir: string, fallback: boolean}} 目标路径与是否降级
 */
export function memoryPathOf(projectRoot, layer) {
  const root = safePathWithin(projectRoot, projectRoot) || projectRoot
  let dir = join(root, MEMORY_DIR_NAME)
  let fallback = false
  // 同名普通文件占住 .project_memory 时才退到备选目录；目录存在/不存在都按正常处理。
  if (existsSync(dir) && !statSync(dir).isDirectory()) {
    dir = join(root, MEMORY_FALLBACK_DIR_NAME)
    fallback = true
  }
  const file = layer === 'index' ? 'INDEX.md' : `${layer}.md`
  const marker = join(dir, '.engineering-craft-marker')
  if (fallback && !existsSync(marker)) {
    // 降级目录此时尚未创建：先建目录再写 marker，否则 ENOENT 原生异常穿透工具层（BUG-02）。
    // marker 只是标记，写入失败不应阻断正式操作——容错，由后续 init/write 的 STORAGE_UNAVAILABLE 覆盖真实落盘失败。
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(marker, '# 本目录是 .project_memory 的备选（ADR §8 名字冲突降级）\n', 'utf8')
    } catch { /* marker 容错：正式落盘由 init/write 各自处理并报领域错误 */ }
  }
  return { path: join(dir, file), dir, fallback }
}

/**
 * 判断内容是否带来源与日期指针（practices.md：write 的硬约束）。
 * @param {string} content 待写正文
 * @returns {boolean} 含"来源"与 YYYY-MM-DD 日期即为 true
 */
export function hasProvenance(content) {
  return typeof content === 'string'
    && /来源|来源[:：]/.test(content)
    && /\d{4}-\d{2}-\d{2}/.test(content)
}

/**
 * 初始化/写入/检索工程记忆（工具 ec_memory 的能力实现）。
 * @param {{action: 'init'|'write'|'query', projectRoot?: string, layer?: string, content?: string, query?: string}} args 入参
 * @returns {{ok: true, action: string, path: string, excerpt?: string, status: string}
 *          |{ok: false, error: {code: string, message: string, details: object}}} Result
 */
export function memoryAction(args) {
  const action = String(args?.action ?? '')
  const projectRoot = args.projectRoot ?? process.cwd()
  const rootSafe = safePathWithin(projectRoot, projectRoot)
  if (!rootSafe) {
    return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `项目根非法：${projectRoot}`, { projectRoot }) }
  }
  const layer = String(args.layer ?? 'index')
  if (!LAYERS.includes(layer)) {
    return { ok: false, error: ecError('INVALID_INPUT', `非法规范层 ${layer}`, { layer }) }
  }
  const target = memoryPathOf(rootSafe, layer)
  const safe = safePathWithin(target.path, rootSafe)
  if (!safe) {
    return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `记忆路径越出项目根：${target.path}`, { path: target.path }) }
  }

  if (action === 'init') {
    const dirs = [target.dir, join(target.dir, 'architecture'), join(target.dir, 'conventions'), join(target.dir, 'project')]
    try {
      for (const d of dirs) mkdirSync(d, { recursive: true })
      const indexPath = join(target.dir, 'INDEX.md')
      if (!existsSync(indexPath)) {
        writeFileSync(indexPath, '# 工程记忆 INDEX\n\n> 只存规范，不存会话流水。\n\n- 架构：architecture/\n- 约定：conventions/\n- 未决：open-questions.md\n', 'utf8')
      }
      return { ok: true, action, path: indexPath, status: 'initialized' }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `建记忆库失败：${e?.message ?? e}`, { path: target.dir }) }
    }
  }

  if (action === 'write') {
    if (typeof args.content !== 'string' || !args.content.trim()) {
      return { ok: false, error: ecError('INVALID_INPUT', 'write 需要 content', { layer }) }
    }
    if (!hasProvenance(args.content)) {
      return { ok: false, error: ecError('INVALID_INPUT', 'write 的 content 必须含"来源"与 YYYY-MM-DD 日期指针', { layer }) }
    }
    try {
      mkdirSync(dirname(safe), { recursive: true })
      writeFileSync(safe, args.content.trimEnd() + '\n', 'utf8')
      return { ok: true, action, path: safe, status: 'written' }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `写规范失败：${e?.message ?? e}`, { path: safe }) }
    }
  }

  if (action === 'query') {
    if (!existsSync(safe)) return { ok: true, action, path: safe, excerpt: '', status: 'not-found' }
    let text = ''
    try { text = readFileSync(safe, 'utf8') } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `读规范失败：${e?.message ?? e}`, { path: safe }) }
    }
    const needle = String(args.query ?? '').trim()
    if (!needle) return { ok: true, action, path: safe, excerpt: text.slice(0, 2000), status: 'read' }
    const lines = text.split('\n')
    const hits = lines.filter((line) => line.includes(needle)).slice(0, 30)
    return {
      ok: true, action, path: safe,
      excerpt: hits.length ? hits.join('\n').slice(0, 2000) : `未命中「${needle}」`,
      status: hits.length ? 'matched' : 'no-match',
    }
  }

  return { ok: false, error: ecError('INVALID_INPUT', `未知 memory action ${action}`, { action }) }
}
