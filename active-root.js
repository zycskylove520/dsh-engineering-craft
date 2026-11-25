/**
 * active-root.js —— 「当前已确认工程根」的持久化（P0-3）。
 *
 * 背景：index.js 的 systemPrompt.section 原用 process.cwd() 调 promptSection，
 * 而宿主 cwd 常与用户确认的项目根不一致（TinyTrain 场景：cwd=default-workspace，
 * 工程在 D:\Project\python\TinyTrain）。每轮注入的都是错项目的阶段/门数字。
 *
 * 为什么不放 state.json：state.json 是按 projectRoot 分文件的（<root>/.ec-state/state.json），
 * 且 read() 有「state 内 projectRoot 必须与请求根一致」的校验——用它存全局当前项目会成环。
 * 因此用宿主 cwd 下的独立轻量文件 .ec-state/active-root 存一个文本标签。
 *
 * 只存文本标签，不做存在性/白名单校验（与 projectRoot 的既有语义一致）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAllowedRoot } from './gate-service.js'

/** 当前项目根的持久化目录/文件（相对宿主 cwd）。 */
export const ACTIVE_ROOT_DIR = '.ec-state'
export const ACTIVE_ROOT_FILE = 'active-root'

function activeRootPath(cwd = process.cwd()) {
  return join(cwd, ACTIVE_ROOT_DIR, ACTIVE_ROOT_FILE)
}

/**
 * 读取已确认项目根。无文件或空内容返回 null（调用方据此只输出红线、不输出阶段数字）。
 * @param {string} [cwd] 宿主工作目录
 * @returns {string|null} 规范化后的项目根标签
 */
export function readActiveRoot(cwd = process.cwd()) {
  const file = activeRootPath(cwd)
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file, 'utf8').trim()
    return raw ? resolveAllowedRoot(raw) : null
  } catch {
    return null
  }
}

/**
 * 持久化已确认项目根（原子替换，防截断）。
 * @param {string} projectRoot 用户确认的项目根标签
 * @param {string} [cwd] 宿主工作目录
 * @returns {{ok: true, root: string}|{ok: false, error: object}}
 */
export function writeActiveRoot(projectRoot, cwd = process.cwd()) {
  const root = resolveAllowedRoot(projectRoot)
  if (!root) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'projectRoot 是空标签', details: { projectRoot } } }
  }
  try {
    const dir = join(cwd, ACTIVE_ROOT_DIR)
    mkdirSync(dir, { recursive: true })
    const file = activeRootPath(cwd)
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, root + '\n', 'utf8')
    try { renameSync(tmp, file) } catch (e) {
      try { if (existsSync(tmp)) rmSync(tmp, { force: true }) } catch { /* 不掩盖主错 */ }
      throw e
    }
    return { ok: true, root }
  } catch (e) {
    return { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: `active-root 落盘失败：${e?.message ?? e}`, details: {} } }
  }
}

/** 清除已确认项目根（/ec use clear）。 */
export function clearActiveRoot(cwd = process.cwd()) {
  const file = activeRootPath(cwd)
  try {
    if (existsSync(file)) rmSync(file, { force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: `清除失败：${e?.message ?? e}`, details: {} } }
  }
}
