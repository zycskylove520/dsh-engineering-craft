/**
 * tests/memory-alignment.test.js —— 对齐 engineering-craft skill「工程记忆系统定稿」的回归测试。
 * 覆盖：6 职责目录+3 根文件+tmp（P0-1）、所有权标记与冲突降级（P0-2）、
 * 执行产物默认 tmp 落点+PROGRESS（P0-3）、五件套与四条硬约束校验（P0-4）、
 * recall 检索套用（P0-5）、state v2 schema、状态目录 .ec-state、GATE-LOG tmp 落点。
 *
 * 无旧格式/旧路径兼容测试：插件未投入使用，兼容分支与对应测试已全部移除。
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  memoryAction, memoryPathOf, validateMemoryEntry, normalizeMemoryContent,
  ROOT_FILES, DUTY_DIRS, TMP_DIR, OWNER_MARKER, MEMORY_DIR_NAME, MEMORY_FALLBACK_DIR_NAME,
} from '../memory.js'
import { artifactAction } from '../artifacts.js'
import { metricsAction, gateLogPathOf } from '../metrics.js'
import { ECO_TOOLS, ecGate } from '../tools.js'
import { STAGE_ORDER, } from '../rules.js'
import { STATE_DIR_NAME, statePathOf } from '../gate-service.js'

const madeRoots = []
const freshRoot = () => { const r = mkdtempSync(join(tmpdir(), 'ec-memory-')); madeRoots.push(r); return r }
after(() => { for (const r of madeRoots) { try { rmSync(r, { recursive: true, force: true }) } catch { /* 清理失败不影响测试结论 */ } } })
const byName = Object.fromEntries(ECO_TOOLS.map((t) => [t.name, t]))

/** 一条合规五件套记忆。 */
const GOOD_ENTRY = [
  '[RULE R-SVC-01] service 层依赖一律通过构造函数注入，不在方法内 new。',
  '  证据: src/order/order.service.ts（构造函数注入模式）',
  '  记录: 2026-11-24 · 实测',
].join('\n')

describe('P0-1 记忆目录结构 · init 建 6 职责目录 + 3 根文件 + tmp', () => {
  test('init 后全部目录/根文件齐全，且第一步写入所有权标记', () => {
    const root = freshRoot()
    const r = memoryAction({ action: 'init', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const dir = join(root, MEMORY_DIR_NAME)
    assert.ok(existsSync(join(dir, OWNER_MARKER)), '标记文件必须存在')
    for (const d of [...DUTY_DIRS, TMP_DIR]) {
      assert.ok(existsSync(join(dir, d)), `职责目录 ${d} 必须建`)
    }
    for (const f of ROOT_FILES) {
      assert.ok(existsSync(join(dir, f)), `根文件 ${f} 必须建`)
    }
    assert.equal(r.fallback, false)
    assert.deepEqual(r.dirs, [...DUTY_DIRS, TMP_DIR])
  })

  test('status.md 存在且含「最近变更」段（不写一次性插曲的提示）', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const status = readFileSync(join(root, MEMORY_DIR_NAME, 'status.md'), 'utf8')
    assert.match(status, /最近变更/)
    assert.match(status, /不写一次性排查插曲/)
  })

  test('layer 只接受新标准集：api-contracts 等职责目录可用，project 旧名被拒', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const a = memoryPathOf(root, 'api-contracts', 'rest')
    assert.equal(a.path, join(root, MEMORY_DIR_NAME, 'api-contracts', 'rest.md'))
    const bad = memoryAction({ action: 'write', projectRoot: root, layer: 'project', content: GOOD_ENTRY })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'INVALID_INPUT')
  })
})

describe('P0-2 所有权标记 · 无标记目录拒写 + 冲突降级', () => {
  test('已存在无标记 .project_memory 目录：write 降级到 .project_memory_engineer，绝不写进别人目录', () => {
    const root = freshRoot()
    const dir = join(root, MEMORY_DIR_NAME)
    mkdirSync(dir)
    writeFileSync(join(dir, '别人放的.md'), 'keep', 'utf8')
    const r = memoryAction({ action: 'write', projectRoot: root, layer: 'index', content: GOOD_ENTRY })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.fallback, true)
    assert.ok(r.path.includes(MEMORY_FALLBACK_DIR_NAME))
    assert.ok(existsSync(join(dir, '别人放的.md')))
    assert.ok(!existsSync(join(dir, OWNER_MARKER)), '不得擅自给别人的目录打标记')
    assert.ok(existsSync(join(root, MEMORY_FALLBACK_DIR_NAME, OWNER_MARKER)), '降级目录必须打标记')
  })

  test('主目录与降级目录都无标记占用：STORAGE_BLOCKED 拒绝', () => {
    const root = freshRoot()
    mkdirSync(join(root, MEMORY_DIR_NAME))
    mkdirSync(join(root, MEMORY_FALLBACK_DIR_NAME))
    const r = memoryAction({ action: 'write', projectRoot: root, layer: 'index', content: GOOD_ENTRY })
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'STORAGE_BLOCKED')
  })

  test('主目录被普通文件占用：init 降级到 .project_memory_engineer 并打标记', () => {
    const root = freshRoot()
    writeFileSync(join(root, MEMORY_DIR_NAME), '占坑', 'utf8')
    const r = memoryAction({ action: 'init', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.fallback, true)
    assert.ok(existsSync(join(root, MEMORY_FALLBACK_DIR_NAME, OWNER_MARKER)))
  })

  test('write 目标目录缺失时自动建目录并打标记', () => {
    const root = freshRoot()
    const r = memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'naming', content: GOOD_ENTRY,
    })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(existsSync(join(root, MEMORY_DIR_NAME, OWNER_MARKER)))
    assert.ok(existsSync(r.path))
  })
})

describe('P0-4 内容规格 · 五件套 + 四条硬约束', () => {
  test('合规五件套通过', () => {
    assert.equal(validateMemoryEntry(GOOD_ENTRY).ok, true)
  })

  test('缺 kind、缺 id 分别被识别（弱断言加固）', () => {
    const tail = '\n  证据: a.ts（模式）\n  记录: 2026-11-24 · 实测'
    const noKind = validateMemoryEntry('service 依赖注入。' + tail)
    assert.equal(noKind.ok, false)
    assert.ok(noKind.error.details.missing.some((m) => m.includes('kind')), '应报缺 kind')
    const noId = validateMemoryEntry('[RULE] service 依赖注入。' + tail)
    assert.equal(noId.ok, false)
    assert.ok(noId.error.details.missing.some((m) => m.includes('id')), '应报缺稳定 id')
    assert.ok(!noId.error.details.missing.some((m) => m.includes('kind')), '有 kind 时不应再报缺 kind')
  })

  test('本机绝对路径被拒绝', () => {
    const bad = GOOD_ENTRY.replace('src/order/order.service.ts', 'C:/Users/alice/.dsh/skills/engineering-craft/SKILL.md')
    const r = validateMemoryEntry(bad)
    assert.equal(r.ok, false)
    assert.equal(r.error.details.rule, 'no-absolute-path')
  })

  test('事实等级与核实状态混写被拒绝', () => {
    const bad = GOOD_ENTRY.replace('· 实测', '· 推断（子代理报告，待复核）')
    const r = validateMemoryEntry(bad)
    assert.equal(r.ok, false)
    assert.equal(r.error.details.rule, 'level-status-separate')
  })

  test('write 始终强制五件套；旧「来源+日期」正文被拒', () => {
    const root = freshRoot()
    const legacy = '来源: 用户口述\n2026-11-24 约定：命名用 kebab-case'
    const r = memoryAction({ action: 'write', projectRoot: root, layer: 'index', content: legacy })
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'INVALID_MEMORY_ENTRY')
  })

  // 回归：LLM 常把五件套挤成一行（TinyTrain 150 条全如此），写入口必须自动拆条
  test('normalizeMemoryContent 把单行五件套拆成三行', () => {
    const oneLine = '[FACT ARCH-001] TTBaseCore 是核心门面类，依次创建各管理器。证据: tinytrain/engine/core.py:66-96。记录: 2026-11-24 · 实测'
    const out = normalizeMemoryContent(oneLine)
    const lines = out.split('\n')
    assert.equal(lines.length, 3)
    assert.equal(lines[0], '[FACT ARCH-001] TTBaseCore 是核心门面类，依次创建各管理器')
    assert.equal(lines[1], '  证据: tinytrain/engine/core.py:66-96')
    assert.equal(lines[2], '  记录: 2026-11-24 · 实测')
    assert.equal(validateMemoryEntry(out).ok, true, '规范化后应通过严格校验')
  })

  test('normalizeMemoryContent 幂等：已是多行的原样不动', () => {
    assert.equal(normalizeMemoryContent(GOOD_ENTRY), GOOD_ENTRY)
  })

  test('normalizeMemoryContent 正文以问号结尾（OPEN 条目）也能拆', () => {
    const oneLine = '[OPEN Q-3] 标注工具是否需改写？证据: tinytrain/labeling/info_bar.py:40。记录: 2026-11-24 · 推断'
    const lines = normalizeMemoryContent(oneLine).split('\n')
    assert.equal(lines.length, 3)
    assert.match(lines[0], /是否需改写\？$/)
  })

  test('ec_memory write 单行输入落盘为分条，且返回 normalized=true', () => {
    const root = freshRoot()
    const oneLine = '[RULE R-E2E-01] 依赖注入走构造函数。证据: src/a.ts（注入模式）。记录: 2026-11-24 · 实测'
    const r = memoryAction({ action: 'write', projectRoot: root, layer: 'conventions', file: 'di', content: oneLine })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.normalized, true)
    const disk = readFileSync(r.path, 'utf8')
    assert.ok(disk.includes('\n  证据:'), '落盘必须有独立证据行')
    assert.ok(disk.includes('\n  记录:'), '落盘必须有独立记录行')
  })

  test('多文档混合：标题/引用等非陈述行不被破坏', () => {
    const doc = '# 标题\n\n> 引用说明\n\n[OPEN Q-1] 要不要修？证据: a.py:1。记录: 2026-11-24 · 推断\n状态: 待复核\n'
    const out = normalizeMemoryContent(doc)
    assert.ok(out.startsWith('# 标题\n\n> 引用说明'))
    assert.ok(out.includes('状态: 待复核'))
    assert.equal(out.split('\n').filter((l) => l.startsWith('[OPEN')).length, 1)
  })
})

describe('P0-5 recall 检索套用', () => {
  test('recall 返回结构化 id/kind/file，供 PLAN.constraints 使用', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'service', content: GOOD_ENTRY,
    })
    const r = memoryAction({ action: 'recall', projectRoot: root, query: '构造函数注入' })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(r.hits.length >= 1)
    const hit = r.hits.find((h) => h.id === 'R-SVC-01')
    assert.ok(hit, '应命中五件套里的稳定 id')
    assert.equal(hit.kind, 'RULE')
    assert.ok(hit.file.includes('conventions'))
  })

  test('ec_memory 工具 schema 暴露 recall 与新 layer，且不再有 strict', async () => {
    const spec = byName.ec_memory
    assert.ok(spec.parameters.properties.action.enum.includes('recall'))
    assert.ok(spec.parameters.properties.layer.enum.includes('api-contracts'))
    assert.ok(spec.parameters.properties.layer.enum.includes('tmp'))
    assert.equal(spec.parameters.properties.strict, undefined)
    const r = await spec.execute({ action: 'recall', projectRoot: freshRoot() })
    assert.equal(r.ok, true)
    assert.deepEqual(r.hits, [])
  })

  test('promptSection 注入检索套用纪律', () => {
    const root = freshRoot()
    const prompt = ecGate.promptSection(root)
    assert.match(prompt, /ec_memory recall/)
    assert.match(prompt, /constraints/)
  })
})

describe('P0-3 执行产物 · 默认 tmp 落点 + PROGRESS + PLAN.constraints', () => {
  test('ec_artifact create 不传 path → 落 .project_memory/tmp/', () => {
    const root = freshRoot()
    const r = artifactAction({ action: 'create', kind: 'plan', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(r.path.includes('.project_memory') && r.path.includes('tmp') && r.path.endsWith('PLAN.md'), r.path)
    assert.ok(existsSync(r.path))
  })

  test('PROGRESS 交接物类型可用且含五节', () => {
    const root = freshRoot()
    const r = artifactAction({ action: 'create', kind: 'progress', projectRoot: root })
    assert.equal(r.ok, true)
    const v = artifactAction({ action: 'validate', kind: 'progress', projectRoot: root, path: r.path })
    assert.equal(v.status, 'valid', JSON.stringify(v))
  })

  test('PLAN 单元 constraints 可经 state.update 持久化', () => {
    const root = freshRoot()
    ecGate.write({ ...ecGate.read(root), plan: [{ id: 'P1', target: 'x', ownerFiles: ['a.js'], acceptance: 'ok', status: 'todo', constraints: [] }], projectRoot: root })
    const u = ecGate.update(root, { planId: 'P1', constraints: ['R-SVC-01', 'F-DATA-02'] })
    assert.equal(u.ok, true, JSON.stringify(u.error))
    assert.deepEqual(ecGate.read(root).plan[0].constraints, ['R-SVC-01', 'F-DATA-02'])
  })
})

describe('state v2 与 GATE-LOG 六字段（无兼容）', () => {
  test('initialState version=2、artifacts 含 progress、releaseDecision=null', () => {
    const s = ecGate.read(freshRoot())
    assert.equal(s.version, 2)
    assert.equal(s.artifacts.progress, null)
    assert.equal(s.releaseDecision, null)
  })

  test('错误版本 state 被拒绝（不迁移）', () => {
    const root = freshRoot()
    mkdirSync(join(root, STATE_DIR_NAME))
    writeFileSync(statePathOf(root), JSON.stringify({ version: 1, gates: {}, artifacts: {}, plan: [] }), 'utf8')
    assert.throws(() => ecGate.read(root), (e) => e.code === 'STORAGE_UNAVAILABLE' && /期望 2/.test(e.message))
  })

  test('STAGE_ORDER 是 rules.js 的单一导出源', () => {
    assert.deepEqual(STAGE_ORDER, ['requirements', 'design', 'coding', 'testing', 'review', 'delivery', 'release'])
  })

  test('GATE-LOG 落 .project_memory/tmp/GATE-LOG.md，六字段齐全；只认中文结果值', () => {
    const root = freshRoot()
    const r = metricsAction({
      action: 'record', projectRoot: root, gate: 'G1', outcome: '拦住', stage: '产品',
      missing: '缺 PRD', disposition: '补齐 PRD 后放行',
    })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const p = gateLogPathOf(root)
    assert.ok(p.endsWith('GATE-LOG.md'), p)
    assert.ok(existsSync(p), 'GATE-LOG 应在 .project_memory/tmp/')
    const rec = JSON.parse(readFileSync(p, 'utf8').trim())
    assert.deepEqual(Object.keys(rec).sort(), ['date', 'disposition', 'gate', 'missing', 'outcome', 'stage'])
    assert.equal(rec.result, undefined, '不应保留旧 result 字段')
    assert.equal(rec.reason, undefined, '不应保留旧 reason 字段')
    const listed = metricsAction({ action: 'list', projectRoot: root })
    assert.equal(listed.ok, true)
    assert.equal(listed.records.length, 1)
  })

  test('outcome 中文三值 拦住/通过/绕过 全部接受', () => {
    for (const outcome of ['拦住', '通过', '绕过']) {
      const root = freshRoot()
      const r = metricsAction({ action: 'record', projectRoot: root, gate: 'G1', outcome })
      assert.equal(r.ok, true, `${outcome}: ${JSON.stringify(r.error)}`)
    }
  })

  test('旧 outcome 值 blocked 被拒绝', () => {
    const root = freshRoot()
    const r = metricsAction({ action: 'record', projectRoot: root, gate: 'G1', outcome: 'blocked' })
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'INVALID_INPUT')
  })

  test('GATE-LOG bounded：list limit 截断时 truncated=true（多行 JSON）', () => {
    const root = freshRoot()
    for (let i = 0; i < 5; i += 1) {
      metricsAction({ action: 'record', projectRoot: root, gate: 'G1', outcome: '拦住', stage: '产品', missing: `第${i}条` })
    }
    const all = metricsAction({ action: 'list', projectRoot: root, limit: 100 })
    assert.equal(all.records.length, 5, '全部 5 条可列出')
    assert.equal(all.truncated, false)
    const limited = metricsAction({ action: 'list', projectRoot: root, limit: 2 })
    assert.equal(limited.records.length, 2, 'limit 生效')
    assert.equal(limited.truncated, true, '有更多时标记截断')
  })

  test('recall bounded：超过 30 条命中时 hits≤30 且 truncated=true', () => {
    const root = freshRoot()
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'bulk',
      content: Array.from({ length: 35 }, (_, i) => `[RULE R-BULK-${String(i).padStart(2, '0')}] 命中词测试条目${i}。\n  证据: src/x.ts（模式）\n  记录: 2026-11-24 · 实测`).join('\n'),
    })
    const r = memoryAction({ action: 'recall', projectRoot: root, query: '命中词' })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(r.hits.length <= 30, 'hits 不超过 30')
    assert.equal(r.truncated, true, '命中超限标记截断')
  })

  test('.engineering-craft 只作记忆目录 marker；状态目录不再用此名', () => {
    const root = freshRoot()
    assert.equal(STATE_DIR_NAME, '.ec-state')
    memoryAction({ action: 'init', projectRoot: root })
    assert.ok(existsSync(join(root, MEMORY_DIR_NAME, '.engineering-craft')), 'marker 在记忆目录内')
    assert.ok(!existsSync(join(root, '.engineering-craft', 'state.json')), '项目根同名目录不应再有 state')
  })
})
