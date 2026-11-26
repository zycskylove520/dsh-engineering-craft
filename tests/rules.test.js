/**
 * tests/rules.test.js —— rules.js 纯函数的 node:test 单测。
 * TDD 先红后绿：本文件先于 rules.js 落盘；mock 只造状态数据，不 mock 被测纯函数。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkGate, nextRole, gatesBetween, DEFAULT_PIPELINE } from '../rules.js'

/** 门规则表（与 CONTRACT §4.2 默认值一致；测试自带，避免依赖实现内部常量）。 */
const RULES = {
  G1: { requiredArtifacts: ['prd'], requireUserConfirm: true, requireEvidence: false },
  G2: { requiredArtifacts: ['adr', 'contract'], requireUserConfirm: true, requireEvidence: false },
  G3: { requiredArtifacts: [], requireUserConfirm: false, requireEvidence: true },
}

/** 造一个最小 EcState；overrides 只覆盖顶层字段。 */
function makeState(over = {}) {
  return {
    version: 2,
    projectRoot: 'E:/demo',
    stage: 'requirements',
    gates: {
      // confirmedBy 是期望的确认方（CONTRACT §9：G1/G2 恒 user）；at=null 表示人还没拍板。
      G1: { passed: false, confirmedBy: 'user', at: null, evidence: null },
      G2: { passed: false, confirmedBy: 'user', at: null, evidence: null },
      G3: { passed: false, confirmedBy: 'agent', at: null, evidence: null },
    },
    artifacts: {
      prd: null, adr: null, contract: null, plan: null,
      brief: null, release: null, testReport: null, findings: null,
    },
    plan: [],
    // 纪律已满足的默认态（本文件测的是门的其他分支，不做无兼容拦截测试）
    tdd: { redRecorded: true, failingTest: 'test/x.test.js', redAt: 1, greenAt: 2 },
    verification: { checks: [{ command: 'node --test', outputDigest: 'pass', at: 1 }] },
    pipeline: { role: null, status: 'pending', handoffs: {} },
    metrics: { lastGate: null, blockCount: 0 },
    updatedAt: 0,
    ...over,
  }
}

/** 返回只改 artifacts / gates 的状态，避免每层手写深拷贝。 */
function withArtifacts(keys, gatePatch = {}) {
  const artifacts = makeState().artifacts
  for (const k of keys) artifacts[k] = `E:/demo/${k.toUpperCase()}.md`
  const state = makeState({ artifacts })
  state.gates = { ...state.gates, ...gatePatch }
  return state
}

describe('checkGate · 三门判定', () => {
  test('G1 缺 PRD → MISSING_ARTIFACT，details 指明缺 prd', () => {
    const r = checkGate('G1', makeState(), RULES.G1)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'MISSING_ARTIFACT')
    assert.deepEqual(r.error.details.missingArtifacts, ['prd'])
  })

  test('G1 有 PRD 但人未确认 → NOT_USER_CONFIRMED', () => {
    const r = checkGate('G1', withArtifacts(['prd']), RULES.G1)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'NOT_USER_CONFIRMED')
  })

  test('G1 有 PRD 且已确认 → ok', () => {
    const s = withArtifacts(['prd'], {
      G1: { passed: true, confirmedBy: 'user', at: 1, evidence: null },
    })
    assert.deepEqual(checkGate('G1', s, RULES.G1), { ok: true })
  })

  test('G2 只有 PRD → MISSING_ARTIFACT，缺 adr 与 contract', () => {
    const r = checkGate('G2', withArtifacts(['prd']), RULES.G2)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'MISSING_ARTIFACT')
    assert.deepEqual(r.error.details.missingArtifacts, ['adr', 'contract'])
  })

  test('G2 交接物齐但人未确认 → NOT_USER_CONFIRMED', () => {
    const r = checkGate('G2', withArtifacts(['adr', 'contract']), RULES.G2)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'NOT_USER_CONFIRMED')
  })

  test('G3 无证据 → NO_EVIDENCE（即使 passed 也不能过）', () => {
    const s = withArtifacts([], {
      G3: { passed: true, confirmedBy: 'agent', at: 1, evidence: null },
    })
    const r = checkGate('G3', s, RULES.G3)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'NO_EVIDENCE')
  })

  test('G3 有证据且通过 → ok', () => {
    const s = withArtifacts([], {
      G3: { passed: true, confirmedBy: 'agent', at: 1, evidence: 'node --test: 12 pass' },
    })
    assert.deepEqual(checkGate('G3', s, RULES.G3), { ok: true })
  })

  test('未知门 id → INVALID_INPUT', () => {
    const r = checkGate('G9', makeState(), RULES.G1)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'INVALID_INPUT')
  })
})

describe('nextRole · 六岗位推进', () => {
  test('DEFAULT_PIPELINE 顺序为 product→architect→developer→tester→reviewer→ops', () => {
    assert.deepEqual(DEFAULT_PIPELINE.map((e) => e.role),
      ['product', 'architect', 'developer', 'tester', 'reviewer', 'ops'])
  })

  test('全空 → product（无前置交接物）', () => {
    assert.deepEqual(nextRole(makeState()), { role: 'product' })
  })

  test('PRD 落盘 → architect', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd'])), { role: 'architect' })
  })

  test('PRD+ADR 落盘但 contract 缺 → blockedBy=contract', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr'])),
      { role: null, blockedBy: 'contract' })
  })

  test('PRD+ADR+CONTRACT → developer', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr', 'contract'])),
      { role: 'developer' })
  })

  test('再落 PLAN → tester', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr', 'contract', 'plan'])),
      { role: 'tester' })
  })

  test('再落 TEST-REPORT → reviewer', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr', 'contract', 'plan', 'testReport'])),
      { role: 'reviewer' })
  })

  test('再落 BRIEF+FINDINGS → ops', () => {
    assert.deepEqual(nextRole(withArtifacts(['prd', 'adr', 'contract', 'plan', 'testReport', 'brief', 'findings'])),
      { role: 'ops' })
  })

  test('全部交接物齐 → role=null 且 blockedBy=all-complete', () => {
    assert.deepEqual(
      nextRole(withArtifacts(['prd', 'adr', 'contract', 'plan', 'testReport', 'brief', 'findings', 'release'])),
      { role: null, blockedBy: 'all-complete' },
    )
  })
})

describe('gatesBetween · 门区间边界', () => {
  test('同阶段 → []', () => {
    assert.deepEqual(gatesBetween('requirements', 'requirements'), [])
  })

  test('requirements→design → [G1]', () => {
    assert.deepEqual(gatesBetween('requirements', 'design'), ['G1'])
  })

  test('requirements→coding → [G1,G2]', () => {
    assert.deepEqual(gatesBetween('requirements', 'coding'), ['G1', 'G2'])
  })

  test('requirements→testing → [G1,G2,G3]', () => {
    assert.deepEqual(gatesBetween('requirements', 'testing'), ['G1', 'G2', 'G3'])
  })

  test('coding→testing → [G3]', () => {
    assert.deepEqual(gatesBetween('coding', 'testing'), ['G3'])
  })

  test('testing→release → []（review/delivery 无 G 门）', () => {
    assert.deepEqual(gatesBetween('testing', 'release'), [])
  })

  test('倒退 coding→requirements → []', () => {
    assert.deepEqual(gatesBetween('coding', 'requirements'), [])
  })

  test('未知阶段 → []（纯函数保持全函数，不抛错）', () => {
    assert.deepEqual(gatesBetween('bogus', 'testing'), [])
  })
})
