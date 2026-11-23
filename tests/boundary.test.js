/**
 * tests/boundary.test.js —— ec-tester 独立边界验证（不改研发岗原测试）。
 * 覆盖 CONTRACT §4.1 四个拒绝码、§8/§9 nextRole 推进与 EcState 结构、
 * 以及 gate-service.safePathWithin 的路径穿越基本拒绝。
 * 纪律：不 mock 被测纯函数；断言具体 code / details / 返回值。
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { checkGate, nextRole, DEFAULT_PIPELINE } from '../rules.js'
import {
  safePathWithin, initialState, statePathOf, DEFAULT_GATES,
  STATE_DIR_NAME, STATE_FILE_NAME, ecError,
  dshWorkspaceRoots, resolveAllowedRoot,
} from '../gate-service.js'

/** 自带门规则表，与 CONTRACT §4.2 默认值一致（不依赖实现内部常量）。 */
const RULES = {
  G1: { requiredArtifacts: ['prd'], requireUserConfirm: true, requireEvidence: false },
  G2: { requiredArtifacts: ['adr', 'contract'], requireUserConfirm: true, requireEvidence: false },
  G3: { requiredArtifacts: [], requireUserConfirm: false, requireEvidence: true },
}

/** 最小 EcState；overrides 覆盖顶层字段。 */
function makeState(over = {}) {
  return {
    version: 1,
    projectRoot: 'E:/demo',
    stage: 'requirements',
    gates: {
      G1: { passed: false, confirmedBy: 'user', at: null, evidence: null },
      G2: { passed: false, confirmedBy: 'user', at: null, evidence: null },
      G3: { passed: false, confirmedBy: 'agent', at: null, evidence: null },
    },
    artifacts: {
      prd: null, adr: null, contract: null, plan: null,
      brief: null, release: null, testReport: null, findings: null,
    },
    plan: [],
    pipeline: { role: null, status: 'pending', handoffs: {} },
    metrics: { lastGate: null, blockCount: 0 },
    updatedAt: 0,
    ...over,
  }
}

/** 造一份只有指定交接物落盘的状态。 */
function withArtifacts(keys, gatePatch = {}) {
  const artifacts = makeState().artifacts
  for (const k of keys) artifacts[k] = `E:/demo/${k.toUpperCase()}.md`
  const s = makeState({ artifacts })
  s.gates = { ...s.gates, ...gatePatch }
  return s
}

describe('checkGate · 四个拒绝码分支（CONTRACT §4.1）', () => {
  test('交接物缺失优先于未确认 → MISSING_ARTIFACT 且 details.missingArtifacts 具体', () => {
    // 条件：G2 需要 adr+contract，两者都缺，即便人未确认也应先报缺交接物。
    const r = checkGate('G2', makeState(), RULES.G2)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'MISSING_ARTIFACT')
    assert.deepEqual(r.error.details.missingArtifacts, ['adr', 'contract'])
    assert.equal(r.error.details.gateId, 'G2')
  })

  test('交接物齐、确认方非 user → NOT_USER_CONFIRMED（即使 passed=true）', () => {
    // 条件：G1 有 PRD、已 passed，但 confirmedBy=agent，应判未被用户拍板。
    const s = withArtifacts(['prd'], {
      G1: { passed: true, confirmedBy: 'agent', at: 1, evidence: null },
    })
    const r = checkGate('G1', s, RULES.G1)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'NOT_USER_CONFIRMED')
    assert.equal(r.error.details.gateId, 'G1')
  })

  test('交接物齐、确认方是 user 但无 at 时间戳 → NOT_USER_CONFIRMED', () => {
    // 条件：G1 有 PRD、confirmedBy=user，但 at=null 表示还没点过确认卡。
    const s = withArtifacts(['prd'], {
      G1: { passed: true, confirmedBy: 'user', at: null, evidence: null },
    })
    const r = checkGate('G1', s, RULES.G1)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'NOT_USER_CONFIRMED')
  })

  test('G3 有真实证据但 passed=false → GATE_NOT_PASSED', () => {
    // 条件：G3 唯一门禁是证据，证据已给但没记录放行，应落到通用未过门码。
    const s = withArtifacts([], {
      G3: { passed: false, confirmedBy: 'agent', at: 1, evidence: 'node --test: 25 pass' },
    })
    const r = checkGate('G3', s, RULES.G3)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'GATE_NOT_PASSED')
    assert.equal(r.error.details.gateId, 'G3')
  })

  test('无交接物/无确认/无证据要求，仅 passed=false → GATE_NOT_PASSED', () => {
    // 条件：自定义宽松规则（不要任何前置），只靠 passed 判定。
    const rule = { requiredArtifacts: [], requireUserConfirm: false, requireEvidence: false }
    const r = checkGate('G1', makeState(), rule)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'GATE_NOT_PASSED')
  })

  test('G3 缺证据优先于 GATE_NOT_PASSED → NO_EVIDENCE', () => {
    // 条件：G3 passed=true 但 evidence=null，应报缺证据而非放行。
    const s = withArtifacts([], {
      G3: { passed: true, confirmedBy: 'agent', at: 1, evidence: null },
    })
    const r = checkGate('G3', s, RULES.G3)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'NO_EVIDENCE')
  })

  test('未知门标识 → INVALID_INPUT（全函数不抛错）', () => {
    const r = checkGate('G9', makeState(), RULES.G1)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'INVALID_INPUT')
    assert.equal(r.error.details.gateId, 'G9')
  })

  test('放行路径：G2 交接物齐 + 人已确认（user 且 at）→ ok', () => {
    const s = withArtifacts(['adr', 'contract'], {
      G2: { passed: true, confirmedBy: 'user', at: 123, evidence: null },
    })
    assert.deepEqual(checkGate('G2', s, RULES.G2), { ok: true })
  })
})

describe('nextRole · 上游交接物缺失与六岗位严格顺序（CONTRACT §8）', () => {
  test('岗位顺序严格等于 product→architect→developer→tester→reviewer→ops', () => {
    assert.deepEqual(DEFAULT_PIPELINE.map((e) => e.role),
      ['product', 'architect', 'developer', 'tester', 'reviewer', 'ops'])
  })

  test('全空交接物 → product 可启动（无前置）', () => {
    assert.deepEqual(nextRole(makeState()), { role: 'product' })
  })

  test('architect 部分落盘（仅 adr）→ blockedBy=contract，不放行下游', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr'])),
      { role: null, blockedBy: 'contract' })
  })

  test('reviewer 部分落盘（仅 brief）→ blockedBy=findings', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr', 'contract', 'plan', 'testReport', 'brief'])),
      { role: null, blockedBy: 'findings' })
  })

  test('逐段落盘交接物：单产出岗位直接放行，双产出岗位部分落盘则阻塞在缺失键', () => {
    // architect=[adr,contract]、reviewer=[brief,findings] 是双产出岗位，
    // 只落其中一个应阻塞在缺失键而非放行下游；单产出岗位落盘即放行下一岗。
    const steps = [
      { add: 'prd', expect: { role: 'architect' } },
      { add: 'adr', expect: { role: null, blockedBy: 'contract' } },
      { add: 'contract', expect: { role: 'developer' } },
      { add: 'plan', expect: { role: 'tester' } },
      { add: 'testReport', expect: { role: 'reviewer' } },
      { add: 'brief', expect: { role: null, blockedBy: 'findings' } },
      { add: 'findings', expect: { role: 'ops' } },
      { add: 'release', expect: { role: null, blockedBy: 'all-complete' } },
    ]
    let artifacts = makeState().artifacts
    for (const { add, expect } of steps) {
      artifacts = { ...artifacts, [add]: `E:/demo/${add}.md` }
      assert.deepEqual(nextRole(makeState({ artifacts })), expect, `落盘 ${add} 后`)
    }
  })

  test('全部交接物齐 → role=null 且 blockedBy=all-complete', () => {
    const keys = ['prd', 'adr', 'contract', 'plan', 'testReport', 'brief', 'findings', 'release']
    assert.deepEqual(nextRole(withArtifacts(keys)), { role: null, blockedBy: 'all-complete' })
  })

  test('自定义短顺序表被尊重（只按传入 order 判定，不写死 6 岗）', () => {
    const order = [{ role: 'a', outputs: ['prd'] }, { role: 'b', outputs: ['adr'] }]
    assert.deepEqual(nextRole(makeState(), order), { role: 'a' })
    assert.deepEqual(nextRole(withArtifacts(['prd']), order), { role: 'b' })
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr']), order),
      { role: null, blockedBy: 'all-complete' })
  })

  test('state.artifacts 缺失时防御性返回 product，不抛错', () => {
    assert.deepEqual(nextRole({}), { role: 'product' })
  })
})

describe('resolveAllowedRoot · 默认允许根纳入 DSH 工作区（BUG：宿主 cwd ≠ 会话工作目录）', () => {
  const saved = process.env.EC_ALLOWED_ROOTS
  afterEach(() => { if (saved === undefined) delete process.env.EC_ALLOWED_ROOTS; else process.env.EC_ALLOWED_ROOTS = saved })

  test('dshWorkspaceRoots 读到本机已登记工作区（纯读、容错）', () => {
    const roots = dshWorkspaceRoots()
    assert.ok(Array.isArray(roots))
    // 本机 workspace.json 含 test_project；若换环境无该文件则允许为空，不崩。
    for (const r of roots) assert.equal(typeof r, 'string')
  })

  test('未设 EC_ALLOWED_ROOTS 时，工作区内项目根被放行（原先只有 cwd+tmpdir 会误拒）', () => {
    delete process.env.EC_ALLOWED_ROOTS
    const roots = dshWorkspaceRoots()
    if (roots.length === 0) return // 无工作区文件时跳过断言，不误报
    assert.equal(resolveAllowedRoot(roots[0]), resolve(roots[0]))
  })

  test('工作区外的路径仍被拒绝（加入工作区不削弱安全边界）', () => {
    delete process.env.EC_ALLOWED_ROOTS
    assert.equal(resolveAllowedRoot('Z:/definitely/outside'), null)
  })

  test('显式 EC_ALLOWED_ROOTS 优先：不自动并入工作区（收紧语义保持）', () => {
    process.env.EC_ALLOWED_ROOTS = 'Z:/explicit-only'
    assert.equal(resolveAllowedRoot('Z:/explicit-only/sub'), resolve('Z:/explicit-only/sub'))
    const w = dshWorkspaceRoots()[0]
    if (w) assert.equal(resolveAllowedRoot(w), null, '显式配置时工作区不应被自动放行')
  })
})

describe('safePathWithin · 路径穿越基本拒绝（CONTRACT §4.1 PATH_OUT_OF_ROOT）', () => {
  const root = 'E:/proj/root'

  test('根内合法绝对路径 → 返回规范绝对路径', () => {
    assert.equal(safePathWithin(join(root, 'PRD.md'), root), join(root, 'PRD.md'))
  })

  test('根内相对路径 → 按根解析并返回绝对路径', () => {
    assert.equal(safePathWithin('PRD.md', root), join(root, 'PRD.md'))
  })

  test('根目录本身 → 视为合法（返回规范化绝对路径）', () => {
    assert.equal(safePathWithin(root, root), resolve(root))
  })

  test('.. 穿越到父目录 → null', () => {
    assert.equal(safePathWithin(join(root, '..', 'evil.md'), root), null)
  })

  test('绝对路径越界到兄弟目录 → null', () => {
    assert.equal(safePathWithin(root + '-evil/PRD.md', root), null)
  })

  test('多级 .. 回环到根内 → 规范化后允许（合法的 normalize 结果）', () => {
    // 条件：sub/../PRD.md 规范化后仍在根内，不属于越界。
    assert.equal(safePathWithin(join(root, 'sub', '..', 'PRD.md'), root), join(root, 'PRD.md'))
  })

  test('非字符串 / 空串目标 → null', () => {
    assert.equal(safePathWithin(123, root), null)
    assert.equal(safePathWithin('', root), null)
    assert.equal(safePathWithin('   ', root), null)
  })

  test('符号链接：词法规范化对根内相对路径放行，realpath 越界不在防御范围（已知限制）', () => {
    // 本函数用 node:path resolve/normalize，只做词法规范化、不解析 symlink。
    // 断言真实行为：根内 './sub/../a.md' 规范化后仍落在根内 → 放行；
    // "根内符号链接指向根外"不在防御范围，按设计记录（Windows 建链权限受限，实测见 TEST-REPORT 未验证项）。
    const inside = safePathWithin('./sub/../a.md', root)
    assert.equal(inside, join('E:/proj/root', 'a.md'))
  })
})

describe('EcState · stateVersion=1 与字段完整性（CONTRACT §9）', () => {
  const root = 'E:/demo'

  test('initialState.version === 1 且顶层字段齐全', () => {
    const s = initialState(root)
    assert.equal(s.version, 1)
    assert.deepEqual(Object.keys(s).sort(),
      ['artifacts', 'gates', 'metrics', 'pipeline', 'plan', 'projectRoot', 'stage', 'updatedAt', 'version'])
  })

  test('gates 三门的确认方约束：G1/G2=user，G3=agent；初值 passed=false', () => {
    const s = initialState(root)
    assert.deepEqual(Object.keys(s.gates).sort(), ['G1', 'G2', 'G3'])
    assert.equal(s.gates.G1.confirmedBy, 'user')
    assert.equal(s.gates.G2.confirmedBy, 'user')
    assert.equal(s.gates.G3.confirmedBy, 'agent')
    for (const g of ['G1', 'G2', 'G3']) {
      assert.deepEqual(Object.keys(s.gates[g]).sort(), ['at', 'confirmedBy', 'evidence', 'passed'])
      assert.equal(s.gates[g].passed, false)
      assert.equal(s.gates[g].at, null)
      assert.equal(s.gates[g].evidence, null)
    }
  })

  test('artifacts 八个键均为 null（含 testReport/findings 扩展键）', () => {
    const s = initialState(root)
    assert.deepEqual(Object.keys(s.artifacts).sort(),
      ['adr', 'brief', 'contract', 'findings', 'plan', 'prd', 'release', 'testReport'])
    assert.ok(Object.values(s.artifacts).every((v) => v === null))
  })

  test('plan=[] / pipeline / metrics / updatedAt 初值符合契约', () => {
    const s = initialState(root)
    assert.deepEqual(s.plan, [])
    assert.deepEqual(s.pipeline, { role: null, status: 'pending', handoffs: {} })
    assert.deepEqual(s.metrics, { lastGate: null, blockCount: 0 })
    assert.equal(s.updatedAt, 0)
    assert.equal(s.stage, 'requirements')
    assert.equal(typeof s.projectRoot, 'string')
  })

  test('statePathOf 落在 <root>/.engineering-craft/state.json', () => {
    const p = statePathOf(root)
    assert.equal(p, join(root, STATE_DIR_NAME, STATE_FILE_NAME))
  })

  test('DEFAULT_GATES 与契约默认规则一致', () => {
    assert.deepEqual(DEFAULT_GATES.G1, RULES.G1)
    assert.deepEqual(DEFAULT_GATES.G2, RULES.G2)
    assert.deepEqual(DEFAULT_GATES.G3, RULES.G3)
  })

  test('ecError 产出 {code,message,details} 结构', () => {
    assert.deepEqual(ecError('X', 'msg', { a: 1 }), { code: 'X', message: 'msg', details: { a: 1 } })
    assert.deepEqual(ecError('X', 'msg').details, {})
  })
})
