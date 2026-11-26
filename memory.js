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

/**
 * 免五件套强制的层：tmp + 三个根文件。
 * - tmp：临时草稿（PLAN/GATE-LOG），本就是自由文本。
 * - 根文件：INDEX 是纯导航、status 是现状快照、open-questions 是技术债清单；
 *   三者语义上都不是"规范条目文档"，强制证据行/记录行会逼 agent 塞假条目
 *   （实测 TinyTrain 会话：纯导航 INDEX.md 被拒，只好塞 [FACT IDX-01] 凑数）。
 *   写成五件套仍然可以（audit/recall/patch 照常识别），只是不再强制。
 * 职责目录（architecture/conventions/...）仍强制五件套——那才是写码要 recall 的规范层。
 */
export function isFreeFormatLayer(layer) {
  return layer === TMP_DIR || Boolean(ROOT_LAYER_FILE[layer])
}

/** 五件套识别：kind + 稳定 id（形如 [RULE R-SVC-01]）。
 *  锚行首（容错缩进 + markdown 标题 # 前缀 + 列表 - * + 前缀），要求合法 id：
 *  - FIX-ghost-entry：正文里引用的 `[RULE REF-99]` 不是新条目，不能进 splitEntries/patch。
 *  - FIX-patch-list-prefix：agent 常写 `- [OPEN Q-2]`，patch 找边界必须认这个前缀，否则吞后续条目。
 *  m 标志：validateMemoryEntry 对多行正文也能找到 header；对单行 exec 同样从行首匹配。 */
const HEADER_RE = /^\s*(?:#{1,6}\s+|[-*+]\s+)?\[(RULE|FACT|DECISION|OPEN)\s+([A-Za-z][\w-]*)\]/m
/** 仅 kind 标记（用于区分"缺 kind"与"缺 id"）。 */
const KIND_ONLY_RE = /\[(RULE|FACT|DECISION|OPEN)\b/
/** 证据行：必须在独立行行首（允许缩进）——只"包含"不算，防止五件套挤成一行。 */
const EVIDENCE_RE = /^\s*证据\s*[:：]\s*\S/m
/** 记录行：独立行 + 日期 + 事实等级。 */
const RECORD_RE = /^\s*记录\s*[:：]\s*(\d{4}-\d{2}-\d{2})\s*·\s*(实测|推断|用户约定)/m
/** 陈述条目的起始行（header）。容忍 markdown 标题前缀（## [RULE ...]）——
 *  LLM 写规范时常用 `## [KIND ID]` 分节，open-questions 里常用 `- [OPEN Q-2]` 列表项。
 *  必须与 HEADER_RE 用同一套前缀规则（缩进 + #{1,6} 或 [-*+]），否则 patch 找边界
 *  匹配不上，end 落到文件末尾把后续条目全吞掉（实测数据丢失 bug）。 */
const ENTRY_LINE_RE = /^(\s*)(?:((?:#{1,6}\s+)|(?:[-*+]\s+)))?(\[(?:RULE|FACT|DECISION|OPEN)\s+[^\]]+\])\s*(.*)$/
/** 证据/记录标记的匹配（用于把单行五件套切开）。 */
const EV_MARK_RE = /证据\s*[:：]/
const REC_MARK_RE = /记录\s*[:：]/
/** FIX-normalize-delim：单行五件套的分隔标记前必须有句子边界（空白/中文标点/斜杠）。
 *  否则正文里的"说明证据: 这个概念…"会被误当分隔符，把正文腰斩且塞进假证据（实测）。 */
const DELIM_BEFORE_RE = /[\s。？！，,;；/]/
function findDelim(s, markRe) {
  const re = new RegExp(markRe.source, 'g')
  let m
  while ((m = re.exec(s)) !== null) {
    if (m.index === 0 || DELIM_BEFORE_RE.test(s[m.index - 1])) return m.index
  }
  return -1
}
/** 禁止的本机绝对路径（盘符 + 用户目录 / skill 安装路径 / UNC）。 */
const ABS_PATH_RE = /[A-Za-z]:[\\/][Uu]sers[\\/]|[\\/]\.dsh[\\/]skills[\\/]|[A-Za-z]:[\\/]|^\\\\/
/** 事实等级与核实状态混写（等级字段里塞了状态词；"报告"不算状态词，避免误伤）。 */
const LEVEL_STATUS_MIX_RE = /(实测|推断|用户约定)\s*[（(][^）)]*(待复核|已复核|子代理|已核实)/

/* ---- 内容质量软警告正则（P0-1）：不阻断写入，只回报给调用方观察一期 ---- */
/** 清单式陈述信号：具体计数（"183 个 .py" / "三个脚本"）——违反 content-model §3「写规则不写清单」。 */
// 注意：量词后不能加 \b——CJK 之间在 JS 里没有单词边界，加了会全漏。
const COUNT_WORD_RE = /\d+\s*(个|条|项|份|处|类|种)|[一二三四五六七八九十]\s*(个|条|项|份|处|类|种)/
/** 证据只有"路径:行号"序列、没有模式描述——违反 content-model §3「证据指向模式，不指向瞬时行号」。
 *  容忍尾随 / 与中英文分号/逗号分隔（ TinyTrain 新版证据行就是「a.py:1; b.py:2 /」这种形态）。 */
const PURE_LINE_REF_RE = /^(?:[\w./\\-]+:\d+(?:-\d+)?)(?:\s*[,，;；]\s*[\w./\\-]+:\d+(?:-\d+)?)*\s*[\/。]?$/
/** 边界声明（content-model §4）：每篇开头一句「本篇管…不管…」。 */
const BOUNDARY_RE = /本篇管[^\n]*不管|本篇(?:只)?管[^\n]*(?:不管|不涉及|不管的是)/
/** 配方信号（content-model §3）：抄哪个文件→改哪几处→怎么验证。 */
const RECIPE_RE = /抄(?:哪个|这份|下列|\s)|照着|参照.*(?:文件|写法)|步骤|先[^\n]{0,40}再|→|怎么验证|验证方式|按.*顺序/
/** 把插件/工程记忆自身实现细节误写成项目约定（TinyTrain CONV-04 幻觉：".engineering-craft 标记"当成项目规则）。 */
const PLUGIN_INTERNAL_RE = /\.engineering-craft|\.project_memory|init 产物|插件 init|本 skill|工程套件/
/** 职责文件名：仅安全 basename（拒绝 / \ .. 与空）。 */
const SAFE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** 职责目录 overview 桩的边界声明（init 写入 & isInitStub 判定共用单一真相源）。 */
const DUTY_BOUNDARY = Object.freeze({
  architecture: '本篇管架构：为什么这样设计（骨架/边界/耦合/关键决策）；不管具体写法配方与 API 签名清单。',
  conventions: '本篇管写法规范：应该怎么写（RULE 配方/命名/分层）；不管为什么这样设计的取舍。',
  'api-contracts': '本篇管对外契约：公开 API / CLI / 数据协议怎么被调用；不管内部实现细节。',
  'data-model': '本篇管数据模型：数据长什么样（schema/数据格式/状态结构）；不管数据怎么流转。',
  testing: '本篇管测试：怎么测（测试固件/mock 边界/覆盖率约定）；不管业务实现。',
  build: '本篇管构建：怎么构建发布（依赖图/打包/安装方式）；不管运行时架构。',
})
/** recall 整句回退时要忽略的高频虚词片段（避免"一个/这个"把无关条目全拉进来）。 */
const RECALL_STOP_GRAMS = new Set(['一个', '这个', '那个', '怎么', '什么', '可以', '需要', '是否', '进行', '使用', '通过', '以及', '或者', '我们', '你们', '他们', '对于', '关于', '如何', '怎样', '请问', '帮我', '如何', '新增一个'])
/** recall 查询切词分隔符（空白与中英文标点）。 */
const RECALL_SPLIT_RE = /[\s,，。、;；:：!！?？/\\（）()《》「」【】\[\]{}<>~·\-—_]+/

/**
 * 把整句查询切成检索词：先按标点/空白切，再对长 CJK 串补二元组（无空格中文整句也能召回）。
 * 只在"字面整句零命中"时作为回退使用；单字 CJK 与虚词丢弃，避免把无关条目全拉进来。
 * @param {string} needle 原始查询
 * @returns {{words: string[], bigrams: string[]}}
 */
function recallQueryTokens(needle) {
  const parts = String(needle ?? '').split(RECALL_SPLIT_RE).map((s) => s.trim()).filter(Boolean)
  const words = []
  const bigrams = []
  const seenWords = new Set()
  const seenBigrams = new Set()
  for (const raw of parts) {
    if (!RECALL_STOP_GRAMS.has(raw) && !seenWords.has(raw)) {
      // 单字中文区分度太低；ASCII 单字符（如 "C"）也易误命中，统一要求长度≥2 或全为 ASCII 单词。
      if (/^[\u4e00-\u9fa5]$/.test(raw)) continue
      seenWords.add(raw); words.push(raw)
    }
    // 无空格的中文整句（≥4 字）补二元组，命中≥2 个才算相关。
    if (/^[\u4e00-\u9fa5]{4,}$/.test(raw)) {
      for (let i = 0; i + 2 <= raw.length; i += 1) {
        const bg = raw.slice(i, i + 2)
        if (!RECALL_STOP_GRAMS.has(bg) && !seenBigrams.has(bg)) {
          seenBigrams.add(bg); bigrams.push(bg)
        }
      }
    }
  }
  return { words, bigrams }
}
/** 分篇阈值：职责目录条目数达到这个量级还没有 ≥2 个主题文件，就算「一篇塞满」。 */
const TOPIC_SPLIT_MIN_ENTRIES = 8
/** overview.md 写前提示阈值：已有正文超过此字节数就提醒改用主题文件。 */
const OVERVIEW_WARN_BYTES = 2000

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
 * 判断一个 md 文件是否仍是 init 生成的原始桩（内容等于模板，未被 agent 改写）。
 * audit 用它豁免 no-five-part-entries：init 自己造的空桩不该扣自己的分，
 * 但 agent 写进 overview.md / 根文件的散文（内容已变）仍须报——堵住 S2 假阴性。
 * @param {string} rel 相对记忆目录路径（如 'INDEX.md' / 'conventions/overview.md'）
 * @param {string} text 文件正文
 * @returns {boolean}
 */
function isInitStub(rel, text) {
  if (rel === 'INDEX.md' || rel === 'status.md' || rel === 'open-questions.md') {
    return text.trim() === rootFileTemplate(rel).trim()
  }
  const m = /(?:^|\/)(overview)\.md$/.exec(rel)
  if (m) {
    // 职责目录 overview 桩：标题 + 边界声明引用行，无其它正文。
    const d = rel.split('/')[0]
    const boundary = DUTY_BOUNDARY[d]
    if (!boundary) return false
    return text.trim() === `# ${d} 总览\n\n> ${boundary}`.trim()
  }
  return false
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
  // 软警告（P0-1）：硬错误不变、向后兼容；观察一期再决定升级为硬拒。
  const warnings = contentQualityWarnings(content)
  return { ok: true, warnings }
}

/**
 * 内容质量软警告（P0-1）：把 skill 里"写了但插件没拦"的三条纪律变成可见回报。
 * - 清单式陈述（计数词）→ content-model §3「写规则不写清单」
 * - 纯行号证据（无模式描述）→ content-model §3「证据指向模式，不指向瞬时行号」
 * 边界声明缺失按"篇"检查，在 audit 里做（单条 write 不要求，tmp 草稿更不要求）。
 * @param {string} content 已规范化的正文
 * @returns {Array<{id: string|null, rule: string, hint: string}>} 警告列表
 */
export function contentQualityWarnings(content) {
  const warnings = []
  if (typeof content !== 'string') return warnings
  for (const entry of splitEntries(content.split('\n'))) {
    if (!entry.id) continue
    if (COUNT_WORD_RE.test(entry.text)) {
      warnings.push({
        id: entry.id, rule: 'list-not-rule',
        hint: '陈述含具体计数/可枚举清单，下个月即过期；改写成可套用的规则（content-model §3）',
      })
    }
    const ev = entry.text.match(/^\s*证据\s*[:：]\s*(.+)$/m)?.[1]?.trim() ?? ''
    if (ev && PURE_LINE_REF_RE.test(ev)) {
      warnings.push({
        id: entry.id, rule: 'evidence-no-pattern',
        hint: '证据只有路径+行号；补上模式描述，行号降为括号辅助（content-model §3）',
      })
    }
    // 把插件/记忆库自身实现（.engineering-craft 标记、init 产物…）当成项目约定写进规范层，
    // 是典型的"从工具脑补项目事实"幻觉。项目记忆只描述项目本身，不描述记忆工具。
    if (PLUGIN_INTERNAL_RE.test(entry.text)) {
      warnings.push({
        id: entry.id, rule: 'plugin-internal-as-project-fact',
        hint: '陈述引用了工程套件/记忆库自身实现；那不是项目约定，删掉或改成真实源码事实',
      })
    }
  }
  return warnings
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
    const [, indent, heading, header, rest] = m
    // 保留 markdown 标题前缀（## [RULE ...]）；无前缀时 heading 为 undefined。
    const headerWithHeading = `${heading ?? ''}${header}`
    // FIX-normalize-delim：用带句子边界的标记搜索，避免正文里的"证据:"/"记录:"字样被误当分隔符。
    const iEv = findDelim(rest, EV_MARK_RE)
    if (iEv < 0) { out.push(line); continue }
    const iRecRel = findDelim(rest.slice(iEv), REC_MARK_RE)
    if (iRecRel < 0) { out.push(line); continue }
    const recAbs = iEv + iRecRel
    // 去掉正文/证据段尾部用作三段分隔符的「。」或「/」（LLM 常写
    // 「正文 / 证据: X / 记录: Y」，若不剥会留下尾随斜杠污染证据路径）。
    const stripSep = (s) => s.trim().replace(/[。\/]\s*$/, '').trim()
    const body = stripSep(rest.slice(0, iEv))
    const evidence = stripSep(rest.slice(iEv, recAbs).replace(EV_MARK_RE, ''))
    const record = rest.slice(recAbs).replace(REC_MARK_RE, '').trim()
    out.push(`${indent}${headerWithHeading} ${body}`.trimEnd())
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
      // P1-2：职责目录的 overview 桩带边界声明（content-model §4），避免每篇 0 声明。
      // DUTY_BOUNDARY 已在模块顶部定义，isInitStub 共用，避免两处漂移。
      for (const d of DUTY_DIRS) {
        const p = joinFor(dir, d, 'overview.md')
        if (!existsSync(p)) {
          writeFileSync(p, `# ${d} 总览\n\n> ${DUTY_BOUNDARY[d]}\n\n`, 'utf8')
          created.push(`${d}/overview.md`)
        }
      }
      for (const rf of ROOT_FILES) {
        const p = joinFor(dir, rf)
        if (!existsSync(p)) { writeFileSync(p, rootFileTemplate(rf), 'utf8'); created.push(rf) }
      }
      return {
        ok: true, action, path: joinFor(dir, 'INDEX.md'), dir, fallback,
        status: 'initialized', dirs: [...DUTY_DIRS, TMP_DIR], rootFiles: [...ROOT_FILES], created,
        // BUG-fix(lazy-init)：init 只建了空骨架，规范层还没有任何条目——必须当场把后续建库步骤
        // 回给 agent，否则骨架建完 agent 就当"建库完成"收工（promptSection 建库分支靠条目数判断，
        // 但 agent 看不到那行提示时会自己宣布完工）。
        nextSteps: [
          'init 只建了空骨架（目录+根文件模板桩），规范层还没有任何 [KIND ID] 条目，建库未完成。',
          '①按顶层目录分批通读源码（不读透不进下一步），至少记录六类信息：设计风格与分层架构（→ architecture/）、代码编写风格与命名习惯（→ conventions/style.md）、注释习惯（→ conventions/comments.md）、错误处理与日志模式（→ conventions/erroring.md）、对外接口契约（→ api-contracts/）、数据结构约定（→ data-model/）。',
          '②在 tmp/ 层写 PLAN.md：逻辑文档树+覆盖映射（源码目录→归属文档）。',
          '③按五件套把条目落盘到 6 职责目录+3 根文件（职责目录按主题分篇，overview.md 只留总览；ec_memory write 用 file 参数指定主题文件名）；规范条目总数须≥12。',
          '④跑 ec_memory audit，qualityScore≥60 且贴出报告才算过自检。',
        ],
      }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `建记忆库失败：${e?.message ?? e}`, { path: dir }) }
    }
  }

  if (action === 'write') {
    if (typeof args.content !== 'string' || !args.content.trim()) {
      return { ok: false, error: ecError('INVALID_INPUT', 'write 需要 content', { layer }) }
    }
    // tmp 是临时草稿区（document-tree.md §7：不进规范层）；三个根文件是导航/快照/清单，
    // 二者都放行自由文本（isFreeFormatLayer）。职责目录（真正要 recall 的规范层）仍强制五件套
    // + 规范化。此前 tmp 被五件套拦死 PLAN.md 落不了盘；根文件被拦则逼 agent 塞假条目凑数。
    const isFree = isFreeFormatLayer(layer)
    const content = isFree ? args.content : normalizeMemoryContent(args.content)
    let resultWarnings = []
    if (!isFree) {
      const v = validateMemoryEntry(content)
      if (!v.ok) return v
      // 内容质量软警告透传给调用方（不阻断写入）。
      if (v.warnings?.length) resultWarnings = v.warnings
    }
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
      // 分篇反馈：往已长大的 overview.md 继续堆内容时提醒拆主题文件（不拦截，避免破坏正常单条 write）。
      const wroteOverview = /(?:\\|\/)overview\.md$/.test(safe)
      if (wroteOverview && !isFree && statSync(safe).size > OVERVIEW_WARN_BYTES) {
        resultWarnings.push({
          rule: 'overview-too-large',
          hint: `overview.md 已超过 ${OVERVIEW_WARN_BYTES} 字节；请按主题拆分到同目录的 <topic>.md（如 core.md / model.md / data.md），overview 只留总览与指针`,
        })
      }
      return {
        ok: true, action, path: safe, status: 'written', fallback: target.fallback,
        normalized: !isFree && content !== args.content,
        warnings: resultWarnings, layer,
      }
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
    const kindFilter = String(args.kind ?? '').trim().toUpperCase()
    const layerFilter = String(args.layer ?? '').trim()
    // 先收集全部候选条目（一次读盘），再做「字面整句 → 分词/二元组」两轮匹配。
    // 实测 TinyTrain：agent 用整句"新增算子 注册 配方"能命中，但更长整句零命中就误以为库里没有；
    // 分词回退让无空格中文整句/带标点整句也能召回，而精确命中仍是第一优先（打分更高）。
    const candidates = []
    let scanned = 0
    for (const f of files) {
      scanned += 1
      // layer 过滤：按文件相对记忆目录的首段判断（职责目录名或根文件名）。
      if (layerFilter) {
        const rel = f.slice(dir.length + 1).replace(/\\/g, '/')
        const first = rel.split('/')[0]
        // FIX-recall-index-layer：INDEX.md 大写文件名 slice 后是 'INDEX'，schema 合法值是 'index'；
        // 统一小写才能命中（status.md / open-questions.md 本就小写，不受影响）。
        const layerOf = (first.endsWith('.md') ? first.slice(0, -3) : first).toLowerCase()
        if (layerOf !== layerFilter.toLowerCase()) continue
      }
      let text = ''
      try { text = readFileSync(f, 'utf8') } catch { continue }
      for (const entry of splitEntries(text.split('\n'))) {
        if (kindFilter && entry.kind !== kindFilter) continue
        const headerLine = (entry.text.split('\n')[0] ?? '')
        candidates.push({ f, entry, headerLine })
      }
    }
    const { words, bigrams } = recallQueryTokens(needle)
    const hits = []
    let totalMatched = 0
    const exact = Boolean(needle)
    for (const { f, entry, headerLine } of candidates) {
      let score = 0
      let matched = false
      if (exact) {
        // 第一轮：字面整句命中（保持原语义，优先级最高）。
        if (entry.text.includes(needle)) {
          matched = true
          const inHeader = headerLine.includes(needle)
          const inBody = entry.text.slice(headerLine.length).includes(needle)
          if (inHeader) score += 4
          if (inBody) score += 2
          if (inHeader && inBody) score += 6
          score += 8 // 精确命中比分词回退稳定高出一档，排序时永远在前
        }
      } else {
        // 无查询词：保持旧行为——返回全部条目、score=0（供列举/全量浏览）。
        matched = true
      }
      if (!matched) continue
      if (entry.kind === 'RULE') score += 1
      if (needle && f.toLowerCase().includes(needle.toLowerCase())) score += 1
      totalMatched += 1
      hits.push({ file: f, id: entry.id, kind: entry.kind, score, text: entry.text.slice(0, 500) })
    }
    // 整句零命中 → 分词回退：词命中或 ≥2 个二元组命中才算相关，按命中数打分。
    // 只在 exact 命中为 0 时启用，保证精确查询的行为完全不变。
    if (exact && hits.length === 0 && (words.length || bigrams.length)) {
      for (const { f, entry, headerLine } of candidates) {
        const body = entry.text.slice(headerLine.length)
        let wordHits = 0
        let bigramHits = 0
        let headerHit = 0
        for (const w of words) {
          if (headerLine.includes(w)) { headerHit += 1; wordHits += 1 }
          else if (body.includes(w)) wordHits += 1
        }
        for (const bg of bigrams) {
          if (entry.text.includes(bg)) bigramHits += 1
        }
        if (wordHits === 0 && bigramHits < 2) continue
        // 打分：词命中 > 二元组；命中 2 个以上二元组才够格，避免"一个/注册"类泛词拉一堆。
        let score = headerHit * 3 + wordHits * 2 + bigramHits
        if (entry.kind === 'RULE') score += 1
        totalMatched += 1
        hits.push({ file: f, id: entry.id, kind: entry.kind, score, text: entry.text.slice(0, 500), via: 'tokens' })
      }
    }
    // 排序：分数降序；同分按 id 稳定排序，保证结果可复现（测试可断言）。
    hits.sort((a, b) => b.score - a.score || String(a.id ?? '').localeCompare(String(b.id ?? '')))
    return {
      ok: true, action: 'recall', hits: hits.slice(0, 30), filesScanned: scanned,
      filesDiscovered: files.length,
      totalMatched, truncated: totalMatched > 30,
      matchMode: hits.length && hits[0].via === 'tokens' ? 'tokens' : 'exact',
    }
  }

  if (action === 'audit') {
    // 建库自检的机械化版（init-project-memory.md 步 4）：结论附具体证据，不靠 agent 自述。
    let dir = joinFor(rootSafe, MEMORY_DIR_NAME)
    let fallback = false
    if (dirAvailability(dir) !== 'available') {
      dir = joinFor(rootSafe, MEMORY_FALLBACK_DIR_NAME)
      fallback = true
    }
    if (dirAvailability(dir) !== 'available') {
      return { ok: true, action: 'audit', status: 'no-memory', missingDirs: [...DUTY_DIRS, ...ROOT_FILES], warnings: [], stats: {} }
    }
    const files = collectMemoryFiles(dir)
    const missingDirs = [...DUTY_DIRS, ...ROOT_FILES].filter((name) => {
      const p = name.endsWith('.md') ? joinFor(dir, name) : joinFor(dir, name)
      return !existsSync(p)
    })
    const warnings = []
    let entriesScanned = 0
    let pureLineEvidence = 0
    let listStyle = 0
    let pluginInternal = 0
    const kinds = { RULE: 0, FACT: 0, DECISION: 0, OPEN: 0 }
    let recipes = 0
    let recipesWithVerify = 0
    // 分篇检查（FIX-topic-split）：每个职责目录按条目数决定是否必须拆成 ≥2 个主题文件。
    // 只写 overview.md 且条目堆到阈值 → 记 single-file-dump，拉低质量分。
    const dutyEntries = Object.fromEntries(DUTY_DIRS.map((d) => [d, 0]))
    const dutyFiles = Object.fromEntries(DUTY_DIRS.map((d) => [d, new Set()]))
    for (const f of files) {
      let text = ''
      try { text = readFileSync(f, 'utf8') } catch { continue }
      const rel = f.slice(dir.length + 1).replace(/\\/g, '/')
      // 分篇统计：职责目录内的文件按目录归类并计条目数。
      const dutyName = rel.split('/')[0]
      if (Object.hasOwn(dutyEntries, dutyName)) {
        dutyFiles[dutyName].add(rel)
        for (const e of splitEntries(text.split('\n'))) if (e.id) dutyEntries[dutyName] += 1
      }
      // 边界声明：规范层文件（职责目录内的 .md）每篇开头要有「本篇管…不管…」。
      if (rel.includes('/') && !BOUNDARY_RE.test(text)) {
        warnings.push({ file: rel, rule: 'missing-boundary', hint: '每篇开头写「本篇管…不管…」（content-model §4）' })
      }
      // 规范层文件若一个五件套 header 都没有（如把 OPEN 写成 **BUG-01** 散文列表），
      // 它就不进 recall、不进五件套校验、也不进统计——这是 audit 曾经的假阴性来源。
      // 例外一：3 个根文件（INDEX/status/open-questions）按设计是自由格式（导航/快照/清单），
      //   write 层已免五件套（isFreeFormatLayer），audit 必须同口径——否则 agent 按文档写好的
      //   根文件被 audit 误报 no-five-part-entries 每条扣 8 分（实测 snake 会话质量分被压 82→84）。
      //   无兼容：根文件无条件豁免，不再看 isInitStub（旧逻辑只豁免"内容=初始模板"的桩）。
      // 例外二：init 生成的职责目录 overview.md 原始桩按设计不放条目，isInitStub 严格比对模板全文；
      //   agent 写进 overview.md 的散文（内容已变）仍照常报——堵住 S2 假阴性。
      const entriesInFile = splitEntries(text.split('\n')).filter((e) => e.id)
      if (!rel.startsWith('tmp/') && !ROOT_FILES.includes(rel) && !isInitStub(rel, text)
          && entriesInFile.length === 0 && /^\s*#\s/m.test(text)) {
        warnings.push({ file: rel, rule: 'no-five-part-entries', hint: '全文无 [KIND ID] 条目：无法被 recall 检索、也不受五件套校验，改用规范格式' })
      }
      for (const entry of splitEntries(text.split('\n'))) {
        if (!entry.id) continue
        entriesScanned += 1
        if (entry.kind && Object.hasOwn(kinds, entry.kind)) kinds[entry.kind] += 1
        // 配方覆盖（content-model §3）：RULE 里有"抄哪个文件/改哪几处/怎么验证"才算配方。
        if (entry.kind === 'RULE' && RECIPE_RE.test(entry.text)) {
          recipes += 1
          if (/验证|怎么验证|验证方式|自测/.test(entry.text)) recipesWithVerify += 1
        }
        for (const w of contentQualityWarnings(entry.text)) {
          warnings.push({ file: rel, ...w })
          if (w.rule === 'list-not-rule') listStyle += 1
          if (w.rule === 'evidence-no-pattern') pureLineEvidence += 1
          if (w.rule === 'plugin-internal-as-project-fact') pluginInternal += 1
        }
      }
    }
    // 质量结论：不是只看"有没有文件"，而是看记忆能不能真的指导写代码。
    // RULE 占比低 = 记的是照片不是配方；配方少 = agent 写码时还得回头通读源码。
    const ruleRatio = entriesScanned ? kinds.RULE / entriesScanned : 0
    const quality = []
    if (entriesScanned && ruleRatio < 0.35) {
      quality.push({
        rule: 'low-rule-ratio',
        hint: `RULE 仅 ${kinds.RULE}/${entriesScanned}（${(ruleRatio * 100).toFixed(1)}%）：FACT 堆成项目照片，缺可套用配方；高频动作要写成「抄哪个文件→改哪几处→怎么验证」`,
      })
    }
    if (entriesScanned && recipes < 3) {
      quality.push({
        rule: 'few-recipes',
        hint: `带步骤的配方仅 ${recipes} 条：新增算子/引擎/loss/数据集/backend 等高频动作应有配方规则`,
      })
    }
    if (recipes > 0 && recipesWithVerify === 0) {
      quality.push({
        rule: 'recipe-no-verify',
        hint: '配方只说怎么改、没说怎么验证；每条配方都要带自检/验证步骤',
      })
    }
    if (quality.length) warnings.push({ file: '(全库)', rule: 'quality-verdict', quality, hint: '内容质量未达标：见 quality 明细' })
    // 分篇 verdict：一个职责目录塞了 ≥8 条却只有 overview.md 一篇 → 无法按主题检索/维护。
    let singleFileDumps = 0
    for (const d of DUTY_DIRS) {
      if (dutyEntries[d] >= TOPIC_SPLIT_MIN_ENTRIES && dutyFiles[d].size < 2) {
        singleFileDumps += 1
        warnings.push({
          file: `${d}/overview.md`, rule: 'single-file-dump',
          hint: `${d} 有 ${dutyEntries[d]} 条却全塞在 overview.md 一篇；按主题拆到 <topic>.md（如 core.md / model.md / data.md），overview 只留总览与指针`,
        })
      }
    }
    // tmp/PLAN.md 覆盖映射：建库规划产物是否存在（P0-2 放行自由文本后才能落盘）。
    const planPath = joinFor(dir, TMP_DIR, 'PLAN.md')
    const hasPlan = existsSync(planPath)
    const planText = hasPlan ? readFileSync(planPath, 'utf8') : ''
    if (!hasPlan) {
      warnings.push({ file: 'tmp/PLAN.md', rule: 'missing-plan', hint: '建库须在 tmp/ 落 PLAN.md（逻辑文档树+覆盖映射）' })
    } else if (!/覆盖|归属|映射/.test(planText)) {
      warnings.push({ file: 'tmp/PLAN.md', rule: 'plan-no-coverage-map', hint: 'PLAN.md 缺覆盖映射表（源码目录→归属文档）' })
    }
    // 质量分（0-100）：给 agent 一个可追的硬指标，而不是只说"过得去"。
    // FIX-missing-boundary-score：边界声明是 content-model §4 纪律，缺了却只记 warning、不扣分，
    // 导致 7 篇缺边界仍 score 72 / passed=true——纪律没落地审计却"通过"。这里纳入扣分（有上限）。
    const missingBoundaryCount = warnings.filter((w) => w.rule === 'missing-boundary').length
    const score = Math.max(0, 100
      - quality.length * 12
      - Math.min(20, listStyle * 2)
      - Math.min(20, Math.floor(pureLineEvidence / 2))
      - pluginInternal * 5
      - singleFileDumps * 5
      - Math.min(20, missingBoundaryCount * 3)
      - warnings.filter((w) => w.rule === 'no-five-part-entries').length * 8
      - (hasPlan ? 0 : 10))
    return {
      ok: true, action: 'audit', status: 'audited', fallback,
      missingDirs, filesScanned: files.length, entriesScanned,
      stats: { listStyle, pureLineEvidence, hasPlan, pluginInternal, kinds, ruleRatio: Number(ruleRatio.toFixed(3)), recipes, recipesWithVerify, singleFileDumps, missingBoundary: missingBoundaryCount },
      qualityScore: score,
      warnings,
      passed: missingDirs.length === 0 && warnings.filter((w) => w.rule === 'missing-plan').length === 0 && score >= 60,
    }
  }

  if (action === 'patch') {
    // 条目级更新（P2-1）：open-questions 的「随修复递减」靠整文件覆盖极容易丢条目，
    // 这里按 id 只替换/标注一条，其余字节原样保留。
    const id = String(args.id ?? '').trim()
    if (!id) return { ok: false, error: ecError('INVALID_INPUT', 'patch 需要 id', { action }) }
    const hasContent = typeof args.content === 'string' && args.content.trim()
    const hasStatus = typeof args.status === 'string' && args.status.trim()
    if (!hasContent && !hasStatus) {
      return { ok: false, error: ecError('INVALID_INPUT', 'patch 需要 content 或 status', { action, id }) }
    }
    if (!ROOT_LAYER_FILE[layer] && file && !SAFE_FILE_RE.test(file)) {
      return { ok: false, error: ecError('INVALID_INPUT', `非法职责文件名 ${file}`, { file }) }
    }
    const target = memoryPathOf(rootSafe, layer, file)
    if (target.blocked) {
      return { ok: false, error: ecError('STORAGE_BLOCKED', '记忆目录无所有权标记，拒绝写入', { dir: target.dir }) }
    }
    const safe = safePathWithin(target.path, rootSafe)
    if (!safe || !safePathWithin(safe, target.dir)) {
      return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `记忆路径越出工程记忆目录：${target.path}`, { path: target.path }) }
    }
    if (!existsSync(safe)) {
      return { ok: false, error: ecError('INVALID_MEMORY_ENTRY', `patch 目标文件不存在：${target.path}`, { path: target.path }) }
    }
    let oldText
    try { oldText = readFileSync(safe, 'utf8') } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `读规范失败：${e?.message ?? e}`, { path: safe }) }
    }
    const lines = oldText.split('\n')
    const headerIdx = []
    lines.forEach((line, i) => {
      const m = HEADER_RE.exec(line)
      if (m && m[2] === id) headerIdx.push(i)
    })
    if (headerIdx.length !== 1) {
      return { ok: false, error: ecError('INVALID_MEMORY_ENTRY', `id=${id} 命中 ${headerIdx.length} 条（须恰好 1 条）`, { id, matches: headerIdx.length }) }
    }
    const start = headerIdx[0]
    let end = lines.length
    for (let i = start + 1; i < lines.length; i += 1) {
      if (ENTRY_LINE_RE.test(lines[i])) { end = i; break }
    }
    let block
    if (hasContent) {
      block = normalizeMemoryContent(String(args.content)).trimEnd().split('\n')
      const v = validateMemoryEntry(block.join('\n'))
      if (!v.ok) return v
      // 保持原条目的前缀风格（## [RULE ...] / - [OPEN ...] vs [RULE ...]）：
      // LLM patch 常只传正文，若丢掉原前缀，视觉分节/列表结构就突变。
      // FIX-patch-list-prefix：列表前缀也须保留，与 ENTRY_LINE_RE/HEADER_RE 的前缀集一致。
      const origHeading = /^(\s*)((?:#{1,6}\s+)|(?:[-*+]\s+))?\[/.exec(lines[start])
      const origPrefix = origHeading?.[2]
      // 仅当新块首行还没带任何前缀时补上原前缀
      if (origPrefix && block[0] && !/^(?:#{1,6}\s+|[-*+]\s+)\[/.test(block[0].replace(/^\s*/, ''))) {
        block[0] = `${origPrefix}${block[0]}`
      }
    } else {
      block = lines.slice(start, end)
      // 移除旧的「状态: 」行（可能有多条），再追加新状态，保持等级/状态正交。
      block = block.filter((l) => !/^\s*状态\s*[:：]/.test(l))
      block.push(`  状态: ${String(args.status).trim()}`)
    }
    const next = [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n')
    try {
      writeFileSync(safe, next.trimEnd() + '\n', 'utf8')
      return { ok: true, action: 'patch', path: safe, id, status: 'patched', fields: hasContent ? ['content'] : ['status'] }
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `patch 写回失败：${e?.message ?? e}`, { path: safe }) }
    }
  }

  return { ok: false, error: ecError('INVALID_INPUT', `未知 memory action ${action}`, { action }) }
}
