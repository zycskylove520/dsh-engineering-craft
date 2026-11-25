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
import { STAGE_ORDER, checkGate, nextRole as nextRolePure } from '../rules.js'
import EcGate, { STATE_DIR_NAME, statePathOf, DEFAULT_GATES } from '../gate-service.js'
import { readActiveRoot, writeActiveRoot, clearActiveRoot } from '../active-root.js'
import { runEcCommand } from '../command.js'

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

  test('init 返回 nextSteps：空骨架不算建库完成，须带通读风格维度与达标条件', () => {
    const root = freshRoot()
    const r = memoryAction({ action: 'init', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(Array.isArray(r.nextSteps) && r.nextSteps.length >= 4, JSON.stringify(r.nextSteps))
    assert.ok(r.nextSteps.some((s) => s.includes('建库未完成')), JSON.stringify(r.nextSteps))
    assert.ok(r.nextSteps.some((s) => s.includes('六类信息')), 'nextSteps 须含六类风格信息通读要求')
    assert.ok(r.nextSteps.some((s) => s.includes('conventions/style.md')), 'nextSteps 须指明风格篇落点')
    assert.ok(r.nextSteps.some((s) => s.includes('≥12')), 'nextSteps 须写明条目达标线')
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

  test('write 职责目录强制五件套；旧「来源+日期」正文被拒', () => {
    const root = freshRoot()
    const legacy = '来源: 用户口述\n2026-11-24 约定：命名用 kebab-case'
    const r = memoryAction({ action: 'write', projectRoot: root, layer: 'conventions', file: 'naming', content: legacy })
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'INVALID_MEMORY_ENTRY')
  })

  test('根文件 index/status/open-questions 免五件套：纯导航正文也能落盘（不塞假条目）', () => {
    const root = freshRoot()
    const nav = '# 工程记忆 INDEX\n\n> 短导航，不放内容。\n\n- 架构：architecture/\n- 约定：conventions/\n'
    for (const layer of ['index', 'status', 'open-questions']) {
      const r = memoryAction({ action: 'write', projectRoot: root, layer, content: nav })
      assert.equal(r.ok, true, `${layer} 应放行自由文本：${JSON.stringify(r.error)}`)
      assert.equal(r.normalized, false)
      const disk = readFileSync(r.path, 'utf8')
      assert.ok(disk.includes('短导航'), `${layer} 正文须原样落盘`)
      assert.ok(!disk.includes('[FACT'), `${layer} 不该被塞假五件套条目`)
    }
    // 职责目录仍强制
    const bad = memoryAction({ action: 'write', projectRoot: root, layer: 'architecture', content: '随便写点' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'INVALID_MEMORY_ENTRY')
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

  test('promptSection：建库未完成持续注入建库指令（init 空骨架不切分支）；达标后切检索纪律', () => {
    const root = freshRoot()
    const before = ecGate.promptSection(root)
    assert.match(before, /ec_memory audit/)
    assert.match(before, /tmp\/PLAN\.md/)
    assert.ok(!before.includes('ec_memory recall'), '未建库时不该塞检索噪音')
    // BUG-fix(lazy-init)：init 只建空骨架（0 条目、无 PLAN），prompt 必须继续注入建库指令并报进度，
    // 不得因为目录存在就切到检索分支——此前 agent init 后建库指令消失，通读/落盘全靠自觉而偷懒。
    memoryAction({ action: 'init', projectRoot: root })
    const afterInit = ecGate.promptSection(root)
    assert.match(afterInit, /建库未完成/)
    assert.match(afterInit, /0\/12/)
    assert.ok(!afterInit.includes('ec_memory recall'), '空骨架仍不该塞检索噪音')
    assert.match(afterInit, /六类信息/, '通读指令须显式列出风格维度')
    assert.match(afterInit, /conventions\/style\.md/, '风格维度须指明落篇位置')
    // 写满 12 条五件套 + 落 tmp/PLAN.md → 达标，才切检索套用纪律。
    const item = (n) => `[RULE B-${String(n).padStart(2, '0')}] 依赖注入走构造函数。\n  证据: a.py（注入模式）\n  记录: 2026-11-24 · 实测`
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'style',
      content: [1, 2, 3, 4, 5, 6].map(item).join('\n'),
    })
    memoryAction({
      action: 'write', projectRoot: root, layer: 'architecture', file: 'engine',
      content: [7, 8, 9, 10, 11, 12].map(item).join('\n'),
    })
    memoryAction({ action: 'write', projectRoot: root, layer: 'tmp', file: 'PLAN', content: '# PLAN\n\n## 覆盖映射\n\n| src | conventions/style.md |\n' })
    const after = ecGate.promptSection(root)
    assert.match(after, /ec_memory recall/)
    assert.match(after, /constraints/)
    // 未确认项目根时只输出红线，不输出阶段数字（P0-3）。
    const noRoot = ecGate.promptSection(null)
    assert.match(noRoot, /尚未确认项目根/)
    assert.ok(!noRoot.includes('阶段='), '无项目根时不得输出阶段/门数字')
  })

  test('promptSection：有 PLAN 但条目不足 12 仍视为建库未完成', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    memoryAction({ action: 'write', projectRoot: root, layer: 'tmp', file: 'PLAN', content: '# PLAN\n\n## 覆盖映射\n' })
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'style',
      content: '[RULE B-01] 依赖注入走构造函数。\n  证据: a.py（注入模式）\n  记录: 2026-11-24 · 实测',
    })
    const prompt = ecGate.promptSection(root)
    assert.match(prompt, /建库未完成/)
    assert.match(prompt, /1\/12/)
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

  // FIX-recall-token-fallback：整句字面零命中时回退到分词/二元组，避免 agent 误以为库里没有。
  test('recall 整句零命中时分词回退仍能召回（含无空格中文整句）', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'recipes',
      content: '[RULE R-OP-01] 新增算子的注册配方：照着 conv.py 写 nn.Module 子类，加 @TTModuleRegistry.register 别名，清 registry_snapshot.py 后重新 import 验证能 get 回类。\n  证据: tinytrain/cfg/register.py（注册与快照模式）\n  记录: 2026-11-25 · 实测',
    })
    // 字面整句在库里并不连续出现 → 精确零命中；分词回退应靠"新增算子/注册/配方"召回。
    const r = memoryAction({ action: 'recall', projectRoot: root, query: '如何新增一个算子并完成注册配方' })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.matchMode, 'tokens', JSON.stringify(r))
    const hit = r.hits.find((h) => h.id === 'R-OP-01')
    assert.ok(hit, `分词回退应命中 R-OP-01：${JSON.stringify(r.hits.map((h) => h.id))}`)
    // 精确命中仍优先：用库里连续出现的词，matchMode=exact 且分数更高
    const r2 = memoryAction({ action: 'recall', projectRoot: root, query: 'registry_snapshot' })
    assert.equal(r2.matchMode, 'exact', JSON.stringify(r2))
    assert.ok(r2.hits.find((h) => h.id === 'R-OP-01'))
    assert.ok(r2.hits[0].score >= hit.score, '精确命中分数不应低于回退命中')
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

// ========== 修复方案新增回归（P0-1 / P0-2 / P1-1 / P1-2 / P2-1） ==========

describe('FIX-P0-1 内容质量软警告', () => {
  test('清单式计数陈述被标 list-not-rule（不阻断写入）', () => {
    const r = validateMemoryEntry('[FACT N-01] 项目共 183 个源码文件。\n  证据: tinytrain/（目录扫描）\n  记录: 2026-11-24 · 实测')
    assert.equal(r.ok, true, '软警告不得阻断写入')
    assert.ok(r.warnings.some((w) => w.id === 'N-01' && w.rule === 'list-not-rule'), JSON.stringify(r.warnings))
  })
  test('纯行号证据被标 evidence-no-pattern', () => {
    const r = validateMemoryEntry('[FACT E-01] 配置按 link 加载。\n  证据: tinytrain/cfg/config_manager.py:51-97\n  记录: 2026-11-24 · 实测')
    assert.equal(r.ok, true)
    assert.ok(r.warnings.some((w) => w.rule === 'evidence-no-pattern'), JSON.stringify(r.warnings))
  })
  test('带模式描述的证据不报警告', () => {
    const r = validateMemoryEntry('[FACT E-02] 配置按 link 加载。\n  证据: tinytrain/cfg/config_manager.py（link 解析：校验路径→后缀分派；当时位于 :51-97）\n  记录: 2026-11-24 · 实测')
    assert.equal(r.ok, true)
    assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings))
  })
})

describe('FIX-P0-2 tmp 自由文本 + PLAN 覆盖映射', () => {
  test('tmp 层写入自由文本成功，规范层仍强制五件套', () => {
    const root = freshRoot()
    const plan = '# PLAN\n\n## 目标\n\n建库\n\n## 覆盖映射\n\n| tinytrain/engine | architecture/training-engine.md |\n'
    const ok = memoryAction({ action: 'write', projectRoot: root, layer: 'tmp', file: 'PLAN', content: plan })
    assert.equal(ok.ok, true, JSON.stringify(ok.error))
    assert.equal(ok.layer, 'tmp')
    const bad = memoryAction({ action: 'write', projectRoot: root, layer: 'architecture', content: '随便写点' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'INVALID_MEMORY_ENTRY')
  })
  test('ec_artifact plan 模板含覆盖映射段，validate 通过', () => {
    const root = freshRoot()
    const c = artifactAction({ action: 'create', kind: 'plan', projectRoot: root })
    assert.equal(c.ok, true)
    const v = artifactAction({ action: 'validate', kind: 'plan', projectRoot: root, path: c.path })
    assert.equal(v.status, 'valid', JSON.stringify(v.missingFields))
  })
})

describe('FIX-P1-1 recall 相关性排序 + 过滤', () => {
  test('更相关的 RULE 即使在最后被扫描的文件也排第一', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    // 先写一个弱命中（在先扫描的 architecture 目录）
    memoryAction({
      action: 'write', projectRoot: root, layer: 'architecture', file: 'a',
      content: '[FACT A-01] 架构里提到一点依赖注入的往事。\n  证据: a.py（模式）\n  记录: 2026-11-24 · 实测',
    })
    // 再写一个强命中（header 里含查询词，且 kind=RULE）
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'z',
      content: '[RULE R-DI-01] 依赖注入一律走构造函数。\n  证据: z.py（构造函数注入）\n  记录: 2026-11-24 · 实测',
    })
    const r = memoryAction({ action: 'recall', projectRoot: root, query: '依赖注入' })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.hits[0].id, 'R-DI-01', JSON.stringify(r.hits.map((h) => [h.id, h.score])))
    assert.ok(r.hits[0].score > r.hits[1].score)
    assert.equal(r.truncated, false)
  })
  test('kind 与 layer 过滤生效', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'f',
      content: '[RULE R-F-01] 依赖注入走构造函数。\n  证据: f.py（模式）\n  记录: 2026-11-24 · 实测',
    })
    memoryAction({
      action: 'write', projectRoot: root, layer: 'architecture', file: 'f',
      content: '[FACT A-F-01] 依赖注入被用过。\n  证据: g.py（模式）\n  记录: 2026-11-24 · 实测',
    })
    const byKind = memoryAction({ action: 'recall', projectRoot: root, query: '依赖注入', kind: 'RULE' })
    assert.deepEqual(byKind.hits.map((h) => h.id), ['R-F-01'])
    const byLayer = memoryAction({ action: 'recall', projectRoot: root, query: '依赖注入', layer: 'architecture' })
    assert.deepEqual(byLayer.hits.map((h) => h.id), ['A-F-01'])
  })
  test('truncated 反映真实总命中数（不再扫到 31 条就停）', () => {
    const root = freshRoot()
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'bulk',
      content: Array.from({ length: 35 }, (_, i) => `[RULE R-M-${String(i).padStart(2, '0')}] 命中词${i}。\n  证据: x.ts（模式）\n  记录: 2026-11-24 · 实测`).join('\n'),
    })
    const r = memoryAction({ action: 'recall', projectRoot: root, query: '命中词' })
    assert.equal(r.hits.length, 30)
    assert.equal(r.totalMatched, 35)
    assert.equal(r.truncated, true)
  })
})

describe('FIX-P0-3 /ec use 项目根持久化', () => {
  test('use 落盘后 which 读回；clear 清除', () => {
    const cwd = freshRoot()
    const w = writeActiveRoot('D:/tmp/my-project', cwd)
    assert.equal(w.ok, true, JSON.stringify(w.error))
    assert.ok(['D:/tmp/my-project', 'D:\\tmp\\my-project'].includes(readActiveRoot(cwd)), JSON.stringify(readActiveRoot(cwd)))
    assert.equal(clearActiveRoot(cwd).ok, true)
    assert.equal(readActiveRoot(cwd), null)
  })
  test('/ec use 命令走同一路径', () => {
    const cwd = freshRoot()
    // runEcCommand 用进程 cwd 读写 active-root，这里只验证命令解析分支返回结构。
    const r = runEcCommand('/ec use clear', cwd)
    assert.equal(r.ok, true)
    assert.equal(r.command, 'use')
    assert.equal(r.root, null)
  })
})

describe('FIX-P1-2 audit 建库自检', () => {
  test('audit 报告缺边界声明、纯行号证据、缺 PLAN', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    // init 已生成带边界声明的 overview 桩，删掉一个制造缺失
    const target = join(root, MEMORY_DIR_NAME, 'architecture', 'overview.md')
    const txt = readFileSync(target, 'utf8').replace(/^> .*\n/m, '')
    writeFileSync(target, txt, 'utf8')
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'x',
      content: '[FACT X-01] 项目 3 个脚本。\n  证据: tinytrain/test/a.py:1\n  记录: 2026-11-24 · 实测',
    })
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(r.warnings.some((w) => w.rule === 'missing-boundary'), JSON.stringify(r.warnings))
    assert.ok(r.warnings.some((w) => w.rule === 'list-not-rule'))
    assert.ok(r.warnings.some((w) => w.rule === 'evidence-no-pattern'))
    assert.ok(r.warnings.some((w) => w.rule === 'missing-plan'))
    assert.equal(r.stats.hasPlan, false)
  })
})

describe('FIX-P2-1 patch 条目级更新', () => {
  test('按 id 只改一条状态，其他条目字节不变', () => {
    const root = freshRoot()
    const content = [
      '[OPEN Q-1] 问题一？',
      '  证据: a.py（模式）',
      '  记录: 2026-11-24 · 推断',
      '',
      '[OPEN Q-2] 问题二？',
      '  证据: b.py（模式）',
      '  记录: 2026-11-24 · 推断',
    ].join('\n')
    memoryAction({ action: 'write', projectRoot: root, layer: 'open-questions', content })
    const r = memoryAction({ action: 'patch', projectRoot: root, layer: 'open-questions', id: 'Q-1', status: '已复核' })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const disk = readFileSync(join(root, MEMORY_DIR_NAME, 'open-questions.md'), 'utf8')
    assert.match(disk, /\[OPEN Q-1\]/)
    assert.match(disk, /状态: 已复核/)
    assert.ok(disk.includes('[OPEN Q-2] 问题二？\n  证据: b.py（模式）'), '其他条目未被改写')
  })
  test('id 不存在或重复命中被拒', () => {
    const root = freshRoot()
    memoryAction({ action: 'write', projectRoot: root, layer: 'open-questions', content: '[OPEN Q-1] x？\n  证据: a.py（模式）\n  记录: 2026-11-24 · 推断' })
    const miss = memoryAction({ action: 'patch', projectRoot: root, layer: 'open-questions', id: 'Q-9', status: '已复核' })
    assert.equal(miss.ok, false)
    assert.match(miss.error.message, /命中 0 条/)
  })

  // FIX-patch-data-loss：LLM 写的规范层条目常带 markdown 标题前缀（## [RULE ...]）。
  // 旧 ENTRY_LINE_RE 不认该前缀 → patch 找不到下一条边界 → end=lines.length → 后续条目全被吞掉。
  // 实测 TinyTrain 建库会话：patch R-CMT-001 后 comments.md 的 002/003/004 全消失（entries 41→38）。
  test('patch markdown 标题条目：只改一条，后续条目不丢（数据丢失回归）', () => {
    const root = freshRoot()
    const item = (n, desc) => `## [RULE R-CMT-00${n}] ${desc}\n  证据: a.py（模式${n}）\n  记录: 2026-11-25 · 实测`
    const content = [item(1, '许可头'), item(2, 'docstring'), item(3, '行内注释'), item(4, '分节注释')].join('\n')
    memoryAction({ action: 'write', projectRoot: root, layer: 'conventions', file: 'comments', content })
    const r = memoryAction({
      action: 'patch', projectRoot: root, layer: 'conventions', file: 'comments',
      id: 'R-CMT-001', content: '[RULE R-CMT-001] 改写后的许可头规则。\n  证据: a.py（模式1）\n  记录: 2026-11-25 · 实测',
    })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const disk = readFileSync(join(root, MEMORY_DIR_NAME, 'conventions', 'comments.md'), 'utf8')
    for (const n of [1, 2, 3, 4]) assert.ok(disk.includes(`R-CMT-00${n}`), `条目 ${n} 不得丢失：\n${disk}`)
    assert.match(disk, /## \[RULE R-CMT-001\]/, '原条目标题风格（##）须保留')
    // 后续条目的正文也要逐字保留
    assert.ok(disk.includes('  证据: a.py（模式3）'), '后续条目证据行须原样保留')
  })
})

describe('FIX-2 归一化分隔符 + audit 假阴性堵漏', () => {
  test('normalizeMemoryContent 剥掉「/」三段分隔符，不污染证据', () => {
    const oneLine = '[FACT ARCH-01] 项目是配置驱动框架 / 证据: tinytrain/engine/core.py:48-96 / 记录: 2026-11-25 · 实测'
    const out = normalizeMemoryContent(oneLine)
    assert.equal(out.split('\n')[0], '[FACT ARCH-01] 项目是配置驱动框架')
    assert.equal(out.split('\n')[1], '  证据: tinytrain/engine/core.py:48-96')
    assert.ok(!out.includes(' /'), out)
  })
  test('纯行号证据的多路径+尾随 / 形态被识别', () => {
    const r = validateMemoryEntry('[FACT E-03] 注册表分两类。\n  证据: a.py:1; b.py:2 / \n  记录: 2026-11-25 · 实测')
    assert.ok(r.warnings.some((w) => w.rule === 'evidence-no-pattern'), JSON.stringify(r.warnings))
  })
  test('audit 报告全文无五件套 header 的规范文件', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    // 用 tmp 自由文本直接落一篇散文式 open-questions（模拟 agent 跳过五件套）
    const prose = '# 未决问题\n\n- **BUG-01** x · 实测 · 待复核\n  - 位置 a.py:1\n'
    writeFileSync(join(root, MEMORY_DIR_NAME, 'open-questions.md'), prose, 'utf8')
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.ok(r.warnings.some((w) => w.file === 'open-questions.md' && w.rule === 'no-five-part-entries'), JSON.stringify(r.warnings))
  })

  // FIX-audit-stub-exempt：init 的 6 个 overview 桩只有边界声明、无 [KIND ID]，
  // 旧 audit 对每个报 no-five-part-entries 扣 8 分 → 6×8=48，全新建库首轮必挂 20 分
  // （实测 TinyTrain session-8d839edc），弱模型会误判成建库失败而收工。
  test('audit 豁免 init 生成的职责目录 overview 桩，不再因空桩扣 48 分', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const stubWarnings = r.warnings.filter((w) => w.rule === 'no-five-part-entries' && /overview\.md$/.test(w.file))
    assert.equal(stubWarnings.length, 0, `overview 桩不该报 no-five-part-entries：${JSON.stringify(stubWarnings)}`)
  })

  test('audit 仍对真正主题文件的散文（无条目）报 no-five-part-entries', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    writeFileSync(join(root, MEMORY_DIR_NAME, 'conventions', 'style.md'), '# 风格\n\n- 命名用 TT 前缀\n- 注释用中文\n', 'utf8')
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.ok(r.warnings.some((w) => w.file === 'conventions/style.md' && w.rule === 'no-five-part-entries'), JSON.stringify(r.warnings))
  })
})

describe('FIX-3 建库质量闸：配方覆盖 / RULE 占比 / 幻觉条目', () => {
  test('插件实现细节被写成项目约定 → plugin-internal-as-project-fact 警告', () => {
    const r = validateMemoryEntry('[RULE C-X-01] 目录所有权用 .engineering-craft 空文件标记，init 自动建，手工建目录别漏。\n  证据: .project_memory/.engineering-craft（init 产物）\n  记录: 2026-11-25 · 实测')
    assert.equal(r.ok, true)
    assert.ok(r.warnings.some((w) => w.rule === 'plugin-internal-as-project-fact'), JSON.stringify(r.warnings))
  })

  test('audit：低 RULE 占比 + 配方不足 → quality-verdict 拉低 qualityScore', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    // 全是 FACT 清单，没有 RULE 配方
    memoryAction({
      action: 'write', projectRoot: root, layer: 'architecture', file: 'photo',
      content: [
        '[FACT P-01] 项目有 183 个 py 文件。\n  证据: tinytrain/（目录扫描）\n  记录: 2026-11-25 · 实测',
        '[FACT P-02] 引擎分七类。\n  证据: tinytrain/engine/（目录）\n  记录: 2026-11-25 · 实测',
      ].join('\n'),
    })
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const verdict = r.warnings.find((w) => w.rule === 'quality-verdict')
    assert.ok(verdict, JSON.stringify(r.warnings))
    assert.ok(verdict.quality.some((q) => q.rule === 'low-rule-ratio'), JSON.stringify(verdict.quality))
    assert.ok(verdict.quality.some((q) => q.rule === 'few-recipes'), JSON.stringify(verdict.quality))
    assert.ok(r.qualityScore < 100, '质量分应被扣')
    assert.ok(r.stats.ruleRatio < 0.35)
  })

  test('audit：合格配方库（RULE 占比高 + 带验证步骤）不给低分警告', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const recipe = (n, extra) => `[RULE R-${n}] 新增${extra}：抄 a.py 的写法 → 改 register_components 注册 → 跑自检脚本验证。\n  证据: a.py（注册模式）\n  记录: 2026-11-25 · 实测`
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'recipes',
      content: [1, 2, 3, 4].map((n) => recipe(n, ['算子', '引擎', 'loss', '数据集'][n - 1])).join('\n'),
    })
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.equal(r.stats.recipes >= 3, true, JSON.stringify(r.stats))
    assert.equal(r.stats.recipesWithVerify >= 1, true, JSON.stringify(r.stats))
    const verdict = r.warnings.find((w) => w.rule === 'quality-verdict')
    if (verdict) {
      assert.ok(!verdict.quality.some((q) => q.rule === 'low-rule-ratio' || q.rule === 'few-recipes'), JSON.stringify(verdict.quality))
    }
  })

  test('promptSection 建库提示含配方/OPEN 五件套/证据模式硬要求', () => {
    const root = freshRoot()
    const prompt = ecGate.promptSection(root)
    assert.match(prompt, /RULE 占比/)
    assert.match(prompt, /OPEN BUG-NN/)
    assert.match(prompt, /抄哪个文件/)
    assert.match(prompt, /模式描述/)
    assert.match(prompt, /qualityScore/)
    assert.match(prompt, /按主题分篇/)
    assert.match(prompt, /single-file-dump/)
  })

  test('audit：职责目录条目堆满 overview.md 一篇 → single-file-dump 扣分', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const item = (n) => `[RULE X-${n}] 新增算子${n}：抄 a.py 的注册写法 → 改 model.toml 的 module 别名 → 跑自检脚本验证。\n  证据: a.py（注册模式）\n  记录: 2026-11-25 · 实测`
    // 8 条全塞 overview.md（不传 file）
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions',
      content: [1, 2, 3, 4, 5, 6, 7, 8].map(item).join('\n'),
    })
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(r.warnings.some((w) => w.rule === 'single-file-dump'), JSON.stringify(r.warnings))
    assert.ok(r.stats.singleFileDumps >= 1, JSON.stringify(r.stats))
  })

  test('audit：按主题分篇的目录不报 single-file-dump', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const item = (n) => `[RULE X-${n}] 新增算子${n}：抄 a.py 的注册写法 → 改 model.toml 的 module 别名 → 跑自检脚本验证。\n  证据: a.py（注册模式）\n  记录: 2026-11-25 · 实测`
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'config',
      content: [1, 2, 3, 4].map(item).join('\n'),
    })
    memoryAction({
      action: 'write', projectRoot: root, layer: 'conventions', file: 'model',
      content: [5, 6, 7, 8].map(item).join('\n'),
    })
    const r = memoryAction({ action: 'audit', projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(!r.warnings.some((w) => w.rule === 'single-file-dump'), JSON.stringify(r.warnings))
    assert.equal(r.stats.singleFileDumps, 0, JSON.stringify(r.stats))
  })

  test('write：单个 overview.md 写入大段内容 → overview-too-large 软警告；主题文件不警告', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const big = `# conventions 总览\n\n> 本篇管写法规范：应该怎么写；不管架构为什么这样设计。\n\n${'[FACT X-00] 已有大量内容占位说明。\n  证据: a.py（模式）\n  记录: 2026-11-25 · 实测\n'.repeat(30)}`
    // write 是整文件覆盖；大段内容一次性写进 overview → 当场警告
    const r = memoryAction({ action: 'write', projectRoot: root, layer: 'conventions', content: big })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(r.warnings.some((w) => w.rule === 'overview-too-large'), JSON.stringify(r.warnings))
    // 同样的内容写进主题文件 → 不警告
    const r2 = memoryAction({ action: 'write', projectRoot: root, layer: 'conventions', file: 'model', content: big })
    assert.equal(r2.ok, true, JSON.stringify(r2.error))
    assert.ok(!r2.warnings.some((w) => w.rule === 'overview-too-large'), JSON.stringify(r2.warnings))
  })
})

// ========== 全库审计修复回归（S1/S2/M1/M2/M3/M4/A1/A2/A3/A4/C1/L1） ==========
describe('AUDIT-FIX 模块接缝与边界条件回归', () => {
  // S1/M5：patch 边界认列表前缀，后续条目不丢，状态挂对条目
  test('patch 列表前缀 "- [OPEN]"：后续条目保留、原前缀保留、状态挂目标条目', () => {
    const root = freshRoot()
    const content = [
      '[OPEN Q-1] 问题一？', '  证据: a.py（模式）', '  记录: 2026-11-24 · 推断', '',
      '- [OPEN Q-2] 问题二？', '  证据: b.py（模式）', '  记录: 2026-11-24 · 推断',
    ].join('\n')
    memoryAction({ action: 'write', projectRoot: root, layer: 'open-questions', content })
    const p = memoryAction({ action: 'patch', projectRoot: root, layer: 'open-questions', id: 'Q-1',
      content: '[OPEN Q-1] 改后？\n  证据: a.py（模式）\n  记录: 2026-11-25 · 推断' })
    assert.equal(p.ok, true, JSON.stringify(p.error))
    const disk = readFileSync(join(root, MEMORY_DIR_NAME, 'open-questions.md'), 'utf8')
    assert.ok(disk.includes('- [OPEN Q-2]'), '列表前缀条目不得丢失')
    assert.ok(disk.includes('b.py'), '后续条目证据不得丢失')
    const p2 = memoryAction({ action: 'patch', projectRoot: root, layer: 'open-questions', id: 'Q-1', status: '已复核' })
    assert.equal(p2.ok, true, JSON.stringify(p2.error))
    const disk2 = readFileSync(join(root, MEMORY_DIR_NAME, 'open-questions.md'), 'utf8')
    assert.ok(disk2.indexOf('状态: 已复核') < disk2.indexOf('Q-2'), '状态须挂在 Q-1 而非文件末尾')
  })

  // M3：正文引用 [RULE REF-99] 不是幽灵条目
  test('HEADER_RE 锚行首+合法 id：正文引用的 id 不进 recall、不能 patch', () => {
    const root = freshRoot()
    memoryAction({ action: 'write', projectRoot: root, layer: 'open-questions',
      content: '[OPEN Q-1] 一？\n  证据: 见 [RULE REF-99] 的定义，a.py（模式）\n  记录: 2026-11-24 · 推断' })
    const r = memoryAction({ action: 'recall', projectRoot: root, query: 'REF-99' })
    assert.ok(!r.hits.some((h) => h.id === 'REF-99'), '正文引用不得成幽灵条目')
    const p = memoryAction({ action: 'patch', projectRoot: root, layer: 'open-questions', id: 'REF-99', status: '已复核' })
    assert.equal(p.ok, false, '幽灵 id 不该能 patch')
  })

  // M1/S2：init 桩全豁免，但写进桩的散文照常报
  test('audit：init 的 3 根文件+6 overview 桩零扣分；桩里写散文仍报 no-five-part-entries', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    const a = memoryAction({ action: 'audit', projectRoot: root })
    assert.equal(a.warnings.filter((w) => w.rule === 'no-five-part-entries').length, 0, JSON.stringify(a.warnings))
    writeFileSync(join(root, MEMORY_DIR_NAME, 'conventions', 'overview.md'), '# 风格\n\n- 命名用 TT 前缀\n', 'utf8')
    const a2 = memoryAction({ action: 'audit', projectRoot: root })
    assert.ok(a2.warnings.some((w) => w.file === 'conventions/overview.md' && w.rule === 'no-five-part-entries'), JSON.stringify(a2.warnings))
  })

  // M2：recall layer:'index' 命中 INDEX.md
  test('recall layer=index 命中 INDEX.md（层名大小写映射）', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    memoryAction({ action: 'write', projectRoot: root, layer: 'index',
      content: '[RULE R-IDX-01] 索引条目讲依赖注入。\n  证据: a.py（模式）\n  记录: 2026-11-25 · 实测' })
    const r = memoryAction({ action: 'recall', projectRoot: root, query: '依赖注入', layer: 'index' })
    assert.ok(r.hits.some((h) => h.id === 'R-IDX-01'), JSON.stringify(r.hits.map((h) => h.id)))
  })

  // M4：missing-boundary 纳入扣分
  test('audit：缺边界声明拉低 qualityScore 并使 passed=false', () => {
    const root = freshRoot()
    memoryAction({ action: 'init', projectRoot: root })
    memoryAction({ action: 'write', projectRoot: root, layer: 'tmp', file: 'PLAN', content: '# PLAN\n覆盖映射\n' })
    memoryAction({ action: 'write', projectRoot: root, layer: 'conventions', file: 'style',
      content: '[RULE R-S-01] 命名用 TT。\n  证据: a.py（模式）\n  记录: 2026-11-25 · 实测' })
    for (const d of DUTY_DIRS) {
      const p = join(root, MEMORY_DIR_NAME, d, 'overview.md')
      writeFileSync(p, readFileSync(p, 'utf8').replace(/^> .*\n/m, ''), 'utf8')
    }
    const a = memoryAction({ action: 'audit', projectRoot: root })
    assert.ok(a.stats.missingBoundary >= 6, JSON.stringify(a.stats))
    assert.ok(a.qualityScore < 60, `qualityScore=${a.qualityScore} 应被边界扣分拉低`)
    assert.equal(a.passed, false)
  })

  // L1：normalizeMemoryContent 不误切正文里的"证据:"
  test('normalize：正文"说明证据: 这个概念"不被当分隔符腰斩', () => {
    const out = normalizeMemoryContent('[RULE R-X] 说明证据: 这个概念要用模式 / 证据: a.py（模式） / 记录: 2026-11-25 · 实测')
    assert.equal(out.split('\n')[1], '  证据: a.py（模式）', JSON.stringify(out))
    assert.ok(out.includes('说明证据: 这个概念要用模式'), JSON.stringify(out))
  })

  // A1：memoryBootstrapped 垃圾 header 不计数
  test('memoryBootstrapped：散文里的垃圾 header 不算建库条目', () => {
    const root = freshRoot()
    const mem = join(root, MEMORY_DIR_NAME)
    mkdirSync(join(mem, 'tmp'), { recursive: true })
    mkdirSync(join(mem, 'conventions'), { recursive: true })
    writeFileSync(join(mem, 'tmp', 'PLAN.md'), '# PLAN\n覆盖映射\n', 'utf8')
    const garbage = Array.from({ length: 12 }, (_, i) => `散文 [FACT   ] [OPEN bad id] 第${i}行`).join('\n')
    writeFileSync(join(mem, 'conventions', 'x.md'), garbage, 'utf8')
    const r = new EcGate().memoryBootstrapped(mem)
    assert.equal(r.entries, 0, JSON.stringify(r))
    assert.equal(r.done, false)
  })

  // A3：构造函数门规则深合并
  test('EcGate 构造函数逐门深合并，不丢 requiredArtifacts/requireUserConfirm', () => {
    const g = new EcGate({ gates: { G1: { requireEvidence: true } } })
    assert.deepEqual(g.gates.G1.requiredArtifacts, DEFAULT_GATES.G1.requiredArtifacts)
    assert.equal(g.gates.G1.requireUserConfirm, DEFAULT_GATES.G1.requireUserConfirm)
    assert.equal(g.gates.G1.requireEvidence, true)
  })

  // A2：state v2 残缺字段自愈（不抛裸 TypeError），非法 stage 被拒
  test('state v2 缺 metrics/pipeline → read 自愈；stage=bogus → 领域错误', () => {
    const root = freshRoot()
    const g = new EcGate()
    const state = g.read(root)
    const broken = { ...state }
    delete broken.metrics
    delete broken.pipeline
    const dir = join(root, STATE_DIR_NAME)
    mkdirSync(dir, { recursive: true })
    writeFileSync(statePathOf(root), JSON.stringify(broken), 'utf8')
    const healed = g.read(root)
    assert.ok(healed.metrics && healed.pipeline, '缺字段应内存自愈，不崩')
    // confirmGate 不再抛裸 TypeError
    writeFileSync(statePathOf(root), JSON.stringify({ ...broken, artifacts: { ...broken.artifacts, prd: '/p' } }), 'utf8')
    const r = g.confirmGate(root, 'G1', {})
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const bogus = { ...state, stage: 'bogus' }
    writeFileSync(statePathOf(root), JSON.stringify(bogus), 'utf8')
    assert.throws(() => g.read(root), (e) => e.code === 'STORAGE_UNAVAILABLE' && /stage/.test(e.message))
  })

  // A4：形状门折叠尾部斜杠（纯函数直测，避开门/阶段脚手架）
  test('研发岗形状门：src/a.js 与 src/a.js/ 视为同一文件，拒绝并行', () => {
    const DEV_ARTIFACTS = { prd: 'p', adr: 'a', contract: 'c', plan: null,
      brief: null, release: null, testReport: null, findings: null }
    const state = { artifacts: DEV_ARTIFACTS, plan: [
      { id: 'U1', target: 'x', ownerFiles: ['src/a.js'], status: 'todo', constraints: [] },
      { id: 'U2', target: 'y', ownerFiles: ['src/a.js/'], status: 'todo', constraints: [] },
    ] }
    const b = nextRolePure(state, undefined, { capabilities: { subagent: true }, thresholds: { minFilesForParallel: 2 } })
    assert.deepEqual(b, { role: 'developer' }, '尾斜杠重叠应拒绝并行退回形态 A')
  })

  // at:0：确认时刻 0 被拒
  test('confirmGate 接受 at=0 不再产生"落盘已过/面板未确认"矛盾', () => {
    const root = freshRoot()
    const g = new EcGate()
    const state = g.read(root)
    mkdirSync(join(root, STATE_DIR_NAME), { recursive: true })
    writeFileSync(statePathOf(root), JSON.stringify({ ...state, artifacts: { ...state.artifacts, prd: '/p' } }), 'utf8')
    g.confirmGate(root, 'G1', { at: 0 })
    const s = g.read(root)
    assert.ok(s.gates.G1.at > 0, `at=${s.gates.G1.at} 应为有效正数`)
    const chk = checkGate('G1', s, DEFAULT_GATES.G1)
    assert.equal(chk.ok, true, JSON.stringify(chk))
  })

  // C1：/ec memory recall 单参数
  test('/ec memory recall 单参数线索不报"非法规范层"', () => {
    const root = freshRoot()
    memoryAction({ action: 'write', projectRoot: root, layer: 'conventions',
      content: '[RULE R-DI-01] 依赖注入走构造函数。\n  证据: a.py（注入模式）\n  记录: 2026-11-25 · 实测' })
    const r = runEcCommand('/ec memory recall 依赖注入', root)
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.ok(r.hits.some((h) => h.id === 'R-DI-01'), JSON.stringify(r.hits))
  })
})
