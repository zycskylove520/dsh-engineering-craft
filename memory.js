/**
 * memory.js —— 工程记忆规范层：init / write / query / recall（CONTRACT §5.3）。
 *
 * 对齐 engineering-craft skill 的「工程记忆系统定稿」（CHANGELOG 2026-11-24）：
 *   - 6 个标准职责目录 + 3 根文件，全部建、内容可薄但不缺位；
 *   - 执行临时产物统一放 .project_memory/tmp/（不进规范层、INDEX 不登记、可清理）；
 *   - 目录所有权用空文件 .engineering-craft 标记：无标记目录绝不写入，降级到 .project_memory_engineer/；
 *   - 每条陈述五件套（稳定 id + kind + 陈述 + 证据 + 日期与事实等级）+ 四条硬约束；
 *   - 写码前检索套用：recall 返回结构化命中（id/kind/文件）供 agent 列入 PLAN.constraints。
 *
 * 无旧格式/旧路径兼容：写入只有五件套一条路径，layer 只有新标准集。
 * 路径做 projectRoot 标签内的防 .. 穿越校验（gate-service.safePathWithin）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { ecError, safePathWithin } from './gate-service.js'
import { dirnameFor, joinFor } from './ec-path.js'

/** 记忆根目录名与冲突降级目录名。 */
export const MEMORY_DIR_NAME = '.project_memory'
export const MEMORY_FALLBACK_DIR_NAME = '.project_memory_engineer'
/** 目录所有权标记（空文件）：存在即"本 skill 创建/接管"（init-project-memory.md:10）。 */
export const OWNER_MARKER = '.engineering-craft'

/** 三个根文件（长期规范层）。 */
export const ROOT_FILES = Object.freeze(['INDEX.md', 'status.md', 'open-questions.md'])
/** 六个标准职责目录。 */
export const DUTY_DIRS = Object.freeze(['architecture', 'conventions', 'api-contracts', 'data-model', 'testing', 'build'])
/** 执行临时产物区（不属职责目录、不进规范层、INDEX 不登记、可清理）。 */
export const TMP_DIR = 'tmp'

/** layer → 根文件名。 */
const ROOT_LAYER_FILE = Object.freeze({
  index: 'INDEX.md',
  status: 'status.md',
  'open-questions': 'open-questions.md',
})
/** 合法 layer：根文件 + 职责目录 + tmp。 */
export const LAYERS = Object.freeze([...Object.keys(ROOT_LAYER_FILE), ...DUTY_DIRS, TMP_DIR])

/** 五件套识别：kind + 稳定 id（形如 [RULE R-SVC-01]）。 */
const HEADER_RE = /\[(RULE|FACT|DECISION|OPEN)\s+([A-Za-z][\w-]*)\]/
/** 仅 kind 标记（用于区分"缺 kind"与"缺 id"）。 */
const KIND_ONLY_RE = /\[(RULE|FACT|DECISION|OPEN)\b/
/** 证据行：必须在独立行行首（允许缩进）——只"包含"不算，防止五件套挤成一行。 */
const EVIDENCE_RE = /^\s*证据\s*[:：]\s*\S/m
/** 记录行：独立行 + 日期 + 事实等级。 */
const RECORD_RE = /^\s*记录\s*[:：]\s*(\d{4}-\d{2}-\d{2})\s*·\s*(实测|推断|用户约定)/m
/** 陈述条目的起始行（header）。 */
const ENTRY_LINE_RE = /^(\s*)(\[(?:RULE|FACT|DECISION|OPEN)\s+[^\]]+\])\s*(.*)$/
/** 证据/记录标记的匹配（用于把单行五件套切开）。 */
const EV_MARK_RE = /证据\s*[:：]/
const REC_MARK_RE = /记录\s*[:：]/
/** 禁止的本机绝对路径（盘符 + 用户目录 / skill 安装路径 / UNC）。 */
const ABS_PATH_RE = /[A-Za-z]:[\\/][Uu]sers[\\/]|[\\/]\.dsh[\\/]skills[\\/]|[A-Za-z]:[\\/]|^\\\\/
/** 事实等级与核实状态混写（等级字段里塞了状态词；"报告"不算状态词，避免误伤）。 */
const LEVEL_STATUS_MIX_RE = /(实测|推断|用户约定)\s*[（(][^）)]*(待复核|已复核|子代理|已核实)/
/** 职责文件名：仅安全 basename（拒绝 / \ .. 与空）。 */
const SAFE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * 判断目录可用性：missing=不存在（新建时打标记）、available=存在且带标记、unavailable=非目录或无标记。
 * @param {string} dir 目录绝对路径
 * @returns {'missing'|'available'|'unavailable'}
 */
function dirAvailability(dir) {
  if (!existsSync(dir)) return 'missing'
  if (!statSync(dir).isDirectory()) return 'unavailable'
  return existsSync(joinFor(dir, OWNER_MARKER)) ? 'available' : 'unavailable'
}

/**
 * 建目录并第一步写入所有权标记（空文件）。
 * @param {string} dir 目录绝对路径
 * @returns {void}
 */
function ensureOwnerDir(dir) {
  mkdirSync(dir, { recursive: true })
  const marker = joinFor(dir, OWNER_MARKER)
  if (!existsSync(marker)) writeFileSync(marker, '', 'utf8')
}

/**
 * 解析记忆目标路径（纯函数，无写副作用）：主目录须带标记；无标记时解析到降级目录。
 * 目录不存在时只返回 missing=true，不创建——创建由 write/init 负责（只读操作零副作用）。
 * @param {string} projectRoot 项目根标签
 * @param {string} layer 层名（根文件 / 职责目录 / tmp）
 * @param {string} [file] 职责目录内文件名（安全 basename）
 * @returns {{path: string, dir: string, fallback: boolean, blocked: boolean, missing: boolean}} 目标与状态
 */
export function memoryPathOf(projectRoot, layer, file) {
  const root = safePathWithin(projectRoot, projectRoot) || projectRoot
  let dir = joinFor(root, MEMORY_DIR_NAME)
  let fallback = false
  let blocked = false
  let avail = dirAvailability(dir)
  if (avail === 'unavailable') {
    dir = joinFor(root, MEMORY_FALLBACK_DIR_NAME)
    fallback = true
    avail = dirAvailability(dir)
    if (avail === 'unavailable') blocked = true
  }
  let rel
  if (ROOT_LAYER_FILE[layer]) {
    rel = ROOT_LAYER_FILE[layer]
  } else if (DUTY_DIRS.includes(layer) || layer === TMP_DIR) {
    const name = String(file ?? '').trim() || 'overview'
    rel = joinFor(layer, `${name}.md`)
  }
  return { path: joinFor(dir, rel), dir, fallback, blocked, missing: avail === 'missing' }
}

/**
 * 根文件初始模板。
 * @param {string} rf 根文件名
 * @returns {string} 模板正文
 */
function rootFileTemplate(rf) {
  if (rf === 'INDEX.md') {
    return '# 工程记忆 INDEX\n\n> 短导航：每篇一行指针 + 一句"这篇管什么"，不放内容。\n\n'
      + '- 架构（为什么这样设计）：architecture/\n'
      + '- 写法规范（应该怎么写）：conventions/\n'
      + '- 对外契约（怎么被调用）：api-contracts/\n'
      + '- 数据模型（数据长什么样）：data-model/\n'
      + '- 测试（怎么测）：testing/\n'
      + '- 构建（怎么构建）：build/\n'
      + '- 未决问题 / 技术债：open-questions.md\n'
      + '- 项目现状快照：status.md\n'
  }
  if (rf === 'status.md') {
    return '# 项目现状快照\n\n## 当前阶段\n\n## 已完成 / 进行中 / 规划中\n\n## 健康度\n\n'
      + '## 最近变更（仅项目重要变更，不写一次性排查插曲）\n'
  }
  return '# 未决问题 / 技术债\n\n> 随修复递减。等级（实测/推断/用户约定）与核实状态（已复核/待复核）分列，不混写。\n\n## 待协商\n'
}

/**
 * 校验一条记忆是否合 skill 规格（五件套 + 四条硬约束）。
 * @param {string} content 待写正文
 * @returns {{ok: true}|{ok: false, error: object}} Result
 */
export function validateMemoryEntry(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: ecError('INVALID_MEMORY_ENTRY', '记忆正文为空', { missing: ['content'] }) }
  }
  const missing = []
  if (!KIND_ONLY_RE.test(content)) missing.push('kind（RULE/FACT/DECISION/OPEN）')
  else if (!HEADER_RE.test(content)) missing.push('稳定 id（形如 [RULE R-SVC-01] 的 R-SVC-01 部分）')
  if (!EVIDENCE_RE.test(content)) missing.push('证据行（证据: 文件路径 + 模式描述）')
  if (!RECORD_RE.test(content)) missing.push('记录行（记录: YYYY-MM-DD · 实测|推断|用户约定）')
  if (missing.length > 0) {
    return { ok: false, error: ecError('INVALID_MEMORY_ENTRY', `记忆五件套缺失：${missing.join('、')}`, { missing }) }
  }
  if (ABS_PATH_RE.test(content)) {
    return { ok: false, error: ecError('INVALID_MEMORY_ENTRY',
      '记忆不得写入本机绝对路径（盘符/用户目录/skill 安装路径）；请改写为动作序列或项目内相对路径', { rule: 'no-absolute-path' }) }
  }
  if (LEVEL_STATUS_MIX_RE.test(content)) {
    return { ok: false, error: ecError('INVALID_MEMORY_ENTRY',
      '事实等级与核实状态须正交分列：等级只用 实测/推断/用户约定，状态另起「状态: 待复核/已复核」行',
      { rule: 'level-status-separate' }) }
  }
  return { ok: true }
}

/**
 * 把单行五件套 `[KIND ID] 正文。证据: X。记录: Y` 规范化成三行：
 *   [KIND ID] 正文
 *     证据: X
 *     记录: Y
 * 幂等：已经是多行的原样保留；非陈述行（标题/引用/状态: 等）原样保留。
 * 目的：LLM 调用 ec_memory write 时经常把五件套挤成一行（实测 TinyTrain 150 条全如此），
 * 在写入口统一规范化，保证规范层文档永远分条可读（五件套落盘标准）。
 * @param {string} content 原始正文
 * @returns {string} 规范化后的正文
 */
export function normalizeMemoryContent(content) {
  if (typeof content !== 'string') return content
  const out = []
  let fixed = 0
  for (const line of content.split('\n')) {
    const m = ENTRY_LINE_RE.exec(line)
    if (!m) { out.push(line); continue }
    const [, indent, header, rest] = m
    const iEv = rest.search(EV_MARK_RE)
    if (iEv < 0) { out.push(line); continue }
    const iRec = rest.slice(iEv).search(REC_MARK_RE)
    if (iRec < 0) { out.push(line); continue }
    const recAbs = iEv + iRec
    const body = rest.slice(0, iEv).trim().replace(/。\s*$/, '')
    const evidence = rest.slice(iEv, recAbs).replace(EV_MARK_RE, '').trim().replace(/。\s*$/, '')
    const record = rest.slice(recAbs).replace(REC_MARK_RE, '').trim()
    out.push(`${indent}${header} ${body}`.trimEnd())
    out.push(`${indent}  证据: ${evidence}`)
    out.push(`${indent}  记录: ${record}`)
    fixed += 1
  }
  return out.join('\n')
}

/**
 * 递归收集规范层下所有 .md（跳过 tmp/ 与标记文件）。
 * @param {string} dir 记忆根目录
 * @returns {string[]} md 文件绝对路径列表
 */
function collectMemoryFiles(dir) {
  const out = []
  if (!existsSync(dir)) return out
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = joinFor(d, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === TMP_DIR) continue
        walk(p)
      } else if (ent.name.endsWith('.md') && ent.name !== OWNER_MARKER) {
        out.push(p)
      }
    }
  }
  walk(dir)
  return out
}

/**
 * 把一个文件的行切成五件套条目（以 header 行分段），供 recall 返回整条。
 * @param {string[]} lines 文件行
 * @returns {Array<{id: string|null, kind: string|null, text: string}>} 条目
 */
function splitEntries(lines) {
  const entries = []
  let cur = null
  for (const line of lines) {
    const m = HEADER_RE.exec(line)
    if (m) {
      if (cur) entries.push(cur)
      cur = { id: m[2], kind: m[1], text: line }
    } else if (cur) {
      cur.text += `\n${line}`
    }
  }
  if (cur) entries.push(cur)
  return entries
}

/**
 * 初始化 / 写入 / 检索 / 检索套用（ec_memory 工具的能力实现）。
 * @param {{action: 'init'|'write'|'query'|'recall', projectRoot?: string, layer?: string,
 *         file?: string, content?: string, query?: string}} args 入参
 * @returns {object} Result（成功带 ok:true 与各能力字段；失败带 ok:false,error）
 */
export function memoryAction(args) {
  const action = String(args?.action ?? '')
  const projectRoot = args.projectRoot ?? process.cwd()
  const rootSafe = safePathWithin(projectRoot, projectRoot)
  if (!rootSafe) {
    return { ok: false, error: ecError('INVALID_INPUT', `projectRoot 是空标签：${projectRoot}`, { projectRoot }) }
  }
  const layer = String(args.layer ?? 'index')
  if (!LAYERS.includes(layer)) {
    return { ok: false, error: ecError('INVALID_INPUT', `非法规范层 ${layer}`, { layer }) }
  }
  const file = args.file == null ? undefined : String(args.file)

  if (action === 'init') {
    const primary = joinFor(rootSafe, MEMORY_DIR_NAME)
    let dir = primary
    let fallback = false
    if (dirAvailability(primary) === 'unavailable') {
      dir = joinFor(rootSafe, MEMORY_FALLBACK_DIR_NAME)
      fallback = true
      if (dirAvailability(dir) === 'unavailable') {
        return { ok: false, error: ecError('STORAGE_BLOCKED',
          '主记忆目录与降级目录均被占用或无所有权标记，拒绝写入', { primary, fallbackDir: dir }) }
      }
    }
    try {
      ensureOwnerDir(dir) // 新建目录第一步写标记
      for (const d of DUTY_DIRS) mkdirSync(joinFor(dir, d), { recursive: true })
      mkdirSync(joinFor(dir, TMP_DIR), { recursive: true })
      const created = []
      for (const rf of ROOT_FILES) {
        const p = joinFor(dir, rf)
        if (!existsSync(p)) { writeFileSync(p, rootFileTemplate(rf), 'utf8'); created.push(rf) }
      }
      return {
        ok: true, action, path: joinFor(dir, 'INDEX.md'), dir, fallback,
        status: 'initialized', dirs: [...DUTY_DIRS, TMP_DIR], rootFiles: [...ROOT_FILES], created,
      }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `建记忆库失败：${e?.message ?? e}`, { path: dir }) }
    }
  }

  if (action === 'write') {
    if (typeof args.content !== 'string' || !args.content.trim()) {
      return { ok: false, error: ecError('INVALID_INPUT', 'write 需要 content', { layer }) }
    }
    // 写入口统一规范化：把挤成一行的五件套拆成三行（幂等），再校验。
    const content = normalizeMemoryContent(args.content)
    const v = validateMemoryEntry(content)
    if (!v.ok) return v
    // 职责目录文件名必须是安全 basename，拒绝 ../ 与分隔符，防止越出记忆目录。
    if (!ROOT_LAYER_FILE[layer] && file && !SAFE_FILE_RE.test(file)) {
      return { ok: false, error: ecError('INVALID_INPUT', `非法职责文件名 ${file}（仅允许安全 basename）`, { file }) }
    }
    const target = memoryPathOf(rootSafe, layer, file)
    if (target.blocked) {
      return { ok: false, error: ecError('STORAGE_BLOCKED',
        '记忆目录被占用且无所有权标记，拒绝写入（改用 .project_memory_engineer/ 或先 init）',
        { dir: target.dir }) }
    }
    const safe = safePathWithin(target.path, rootSafe)
    if (!safe || !safePathWithin(safe, target.dir)) {
      return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `记忆路径越出工程记忆目录：${target.path}`, { path: target.path, dir: target.dir }) }
    }
    try {
      if (target.missing) ensureOwnerDir(target.dir)
      mkdirSync(dirnameFor(safe), { recursive: true })
      writeFileSync(safe, content.trimEnd() + '\n', 'utf8')
      return { ok: true, action, path: safe, status: 'written', fallback: target.fallback, normalized: content !== args.content }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `写规范失败：${e?.message ?? e}`, { path: safe }) }
    }
  }

  if (action === 'query') {
    const target = memoryPathOf(rootSafe, layer, file)
    if (target.blocked) {
      return { ok: false, error: ecError('STORAGE_BLOCKED', '记忆目录无所有权标记，拒绝读取', { dir: target.dir }) }
    }
    const safe = safePathWithin(target.path, rootSafe)
    if (!safe || !safePathWithin(safe, target.dir)) {
      return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `记忆路径越出工程记忆目录：${target.path}`, { path: target.path }) }
    }
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

  if (action === 'recall') {
    let dir = joinFor(rootSafe, MEMORY_DIR_NAME)
    if (dirAvailability(dir) !== 'available') dir = joinFor(rootSafe, MEMORY_FALLBACK_DIR_NAME)
    if (dirAvailability(dir) !== 'available') {
      return { ok: true, action: 'recall', hits: [], filesScanned: 0, status: 'no-memory', truncated: false }
    }
    const files = collectMemoryFiles(dir)
    const needle = String(args.query ?? '').trim()
    const hits = []
    let scanned = 0
    for (const f of files) {
      scanned += 1
      let text = ''
      try { text = readFileSync(f, 'utf8') } catch { continue }
      // 按五件套条目匹配：命中任意行即返回整条（含 id/kind），供 PLAN.constraints 使用。
      for (const entry of splitEntries(text.split('\n'))) {
        if (needle && !entry.text.includes(needle)) continue
        // 无 query 时只列 header 条目，避免把正文行当噪声返回。
        hits.push({
          file: f, id: entry.id, kind: entry.kind,
          text: entry.text.slice(0, 500),
        })
        if (hits.length >= 31) break
      }
      if (hits.length >= 31) break
    }
    return {
      ok: true, action: 'recall', hits: hits.slice(0, 30), filesScanned: scanned,
      filesDiscovered: files.length, truncated: hits.length > 30,
    }
  }

  return { ok: false, error: ecError('INVALID_INPUT', `未知 memory action ${action}`, { action }) }
}
