/**
 * tests/parallel.test.js —— 研发岗条件并行（形态 B）三道门与透传链路测试。
 * TDD：先落测试跑红，再实现 rules.js / gate-service / tools / command 跑绿。
 * mock 只造状态数据与临时项目目录，不 mock 被测函数。
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextRole, DEFAULT_PIPELINE } from '../rules.js'
import EcGate, { getRoleDefaults, setRoleDefaults } from '../gate-service.js'
import { apply } from '../index.js'
import { ECO_TOOLS } from '../tools.js'
import { runEcCommand } from '../command.js'

/** 让 nextRole 推进到 developer 的交接物快照（plan 尚未落盘）。 */
const DEV_ARTIFACTS = Object.freeze({
  prd: 'E:/demo/PRD.md', adr: 'E:/demo/ADR.md', contract: 'E:/demo/CONTRACT.md',
  plan: null, brief: null, release: null, testReport: null, findings: null,
})

/** 造一份下一岗位为 developer 的状态；plan 单元由用例给定。 */
function developerState(plan) {
  return {
    version: 2,
    projectRoot: 'E:/demo',
    stage: 'coding',
    gates: {
      G1: { passed: true, confirmedBy: 'user', at: 1, evidence: null },
      G2: { passed: true, confirmedBy: 'user', at: 2, evidence: null },
      G3: { passed: false, confirmedBy: 'agent', at: null, evidence: null },
    },
    artifacts: { ...DEV_ARTIFACTS, progress: null },
    plan,
    tdd: { redRecorded: false, failingTest: null, redAt: null, greenAt: null },
    verification: { checks: [] },
    pipeline: { role: null, status: 'pending', handoffs: {} },
    releaseDecision: null,
    metrics: { lastGate: null, blockCount: 0 },
    updatedAt: 0,
  }
}

/** 两个文件归属不重叠的 todo 单元——三道门均满足的任务形状。 */
function twoDisjointUnits() {
  return [
    { id: 'P1', target: '规则层', ownerFiles: ['rules.js'], acceptance: '单测全绿', status: 'todo' },
    { id: 'P2', target: '面板层', ownerFiles: ['client.js'], acceptance: '面板显示并行', status: 'todo' },
  ]
}

describe('nextRole · 研发岗条件并行三道门', () => {
  test('① 三道门全过 + ownerFiles 不重叠 → 形态 B 多单元', () => {
    const r = nextRole(developerState(twoDisjointUnits()))
    assert.equal(r.mode, 'B')
    assert.equal(r.role, 'developer')
    assert.deepEqual(r.roles, ['P1', 'P2'])
    assert.deepEqual(r.units, [
      { id: 'P1', ownerFiles: ['rules.js'] },
      { id: 'P2', ownerFiles: ['client.js'] },
    ])
  })

  test('② ownerFiles 两两重叠 → 退回形态 A 单岗位', () => {
    const plan = [
      { id: 'P1', ownerFiles: ['rules.js'], status: 'todo' },
      { id: 'P2', ownerFiles: ['rules.js', 'tools.js'], status: 'todo' },
    ]
    assert.deepEqual(nextRole(developerState(plan)), { role: 'developer' })
  })

  test('③ capabilities.subagent=false → 退回形态 A 单岗位', () => {
    const r = nextRole(developerState(twoDisjointUnits()), DEFAULT_PIPELINE, {
      capabilities: { subagent: false },
    })
    assert.deepEqual(r, { role: 'developer' })
  })

  test('④ minFilesForParallel 阈值不满足 → 退回形态 A 单岗位', () => {
    const r = nextRole(developerState(twoDisjointUnits()), DEFAULT_PIPELINE, {
      thresholds: { minFilesForParallel: 3 },
    })
    assert.deepEqual(r, { role: 'developer' })
  })

  test('⑤ 任一 todo 单元 ownerFiles 为空 → 不可判定，退回形态 A', () => {
    const plan = [
      { id: 'P1', ownerFiles: ['rules.js'], status: 'todo' },
      { id: 'P2', ownerFiles: [], status: 'todo' },
    ]
    assert.deepEqual(nextRole(developerState(plan)), { role: 'developer' })
  })

  test('⑥ 既有 nextRole 单岗位语义不变（形态 A 返回值不变形）', () => {
    const empty = { artifacts: {}, plan: [] }
    assert.deepEqual(nextRole(empty), { role: 'product' })
    assert.deepEqual(nextRole({ artifacts: { prd: 'p' }, plan: [] }), { role: 'architect' })
    assert.deepEqual(nextRole({ artifacts: { prd: 'p', adr: 'a' }, plan: [] }),
      { role: null, blockedBy: 'contract' })
    assert.deepEqual(nextRole(developerState([])), { role: 'developer' })
    assert.deepEqual(nextRole({ ...developerState([]), artifacts: { ...DEV_ARTIFACTS, plan: 'E:/demo/PLAN.md' } }),
      { role: 'tester' })
  })

  test('⑦ 只有 todo 单元参与并行判定，done 单元不计入门槛', () => {
    const plan = [
      { id: 'P0', ownerFiles: ['rules.js'], status: 'done' },
      { id: 'P1', ownerFiles: ['client.js'], status: 'todo' },
    ]
    assert.deepEqual(nextRole(developerState(plan)), { role: 'developer' })
  })
})

describe('形态 B 透传 · gate-service / ec_stage / /ec', () => {
  const madeRoots = []
  const freshRoot = () => { const r = mkdtempSync(join(tmpdir(), 'ec-parallel-')); madeRoots.push(r); return r }
  after(() => { for (const r of madeRoots) { try { rmSync(r, { recursive: true, force: true }) } catch { /* 清理失败不影响测试结论 */ } } })
  const tool = ECO_TOOLS.find((t) => t.name === 'ec_stage')

  test('gate-service.nextRole 透传 opts：关能力门得形态 A，默认得形态 B', () => {
    const root = freshRoot()
    const gate = new EcGate()
    gate.write({ ...developerState(twoDisjointUnits()), projectRoot: root })
    assert.deepEqual(gate.nextRole(root, { capabilities: { subagent: false } }), { role: 'developer' })
    const b = gate.nextRole(root)
    assert.equal(b.mode, 'B')
    assert.deepEqual(b.roles, ['P1', 'P2'])
  })

  test('ec_stage next-role 透传 opts；query 输出带 mode/parallelRoles', async () => {
    const root = freshRoot()
    const gate = new EcGate()
    gate.write({ ...developerState(twoDisjointUnits()), projectRoot: root })
    const a = await tool.execute({ mode: 'next-role', projectRoot: root, capabilities: { subagent: false } })
    assert.deepEqual(a, { ok: true, role: 'developer' })
    const q = await tool.execute({ mode: 'query', projectRoot: root })
    assert.equal(q.mode, 'B')
    assert.deepEqual(q.parallelRoles, ['P1', 'P2'])
  })

  test('Config 阈值默认注入：设默认 3 → 形态 A；显式传 2 → 形态 B；调用方 opts 优先', () => {
    const root = freshRoot()
    const gate = new EcGate()
    gate.write({ ...developerState(twoDisjointUnits()), projectRoot: root })
    const original = getRoleDefaults()
    try {
      setRoleDefaults({ thresholds: { minFilesForParallel: 3 } })
      assert.deepEqual(gate.nextRole(root), { role: 'developer' })
      assert.equal(runEcCommand('/ec next', root).mode, 'A')
      // 显式 opts 覆盖 Config 默认。
      assert.equal(gate.nextRole(root, { thresholds: { minFilesForParallel: 2 } }).mode, 'B')
      assert.equal(runEcCommand('/ec next', root, { thresholds: { minFilesForParallel: 2 } }).mode, 'B')
    } finally {
      setRoleDefaults(original)
    }
  })

  test('/ec next 与 status 透传 opts 并输出 mode/parallelRoles', () => {
    const root = freshRoot()
    const gate = new EcGate()
    gate.write({ ...developerState(twoDisjointUnits()), projectRoot: root })
    const a = runEcCommand('/ec next', root, { capabilities: { subagent: false } })
    assert.equal(a.mode, 'A')
    assert.deepEqual(a.parallelRoles, [])
    const b = runEcCommand('/ec next', root)
    assert.equal(b.mode, 'B')
    assert.deepEqual(b.parallelRoles, ['P1', 'P2'])
    const s = runEcCommand('/ec status', root)
    assert.equal(s.mode, 'B')
    assert.deepEqual(s.parallelRoles, ['P1', 'P2'])
  })

  test('生产接线：apply(ctx, config) 把 Config.thresholds 注入 roleDefaults', () => {
    // 覆盖 index.js:180 这一行——删掉它本测试必须变红（审计发现的缺口）。
    const original = getRoleDefaults()
    const stub = {
      tools: { register() {} },
      webServer: { register() {} },
      effect(fn) { try { fn() } catch { /* 注册容错：stub 不模拟 DSH 全部服务 */ } },
      get() { return undefined },
    }
    try {
      apply(stub, { thresholds: { minFilesForParallel: 7 } })
      assert.equal(getRoleDefaults().thresholds.minFilesForParallel, 7)
      const root = freshRoot()
      const gate = new EcGate()
      gate.write({ ...developerState(twoDisjointUnits()), projectRoot: root })
      // 默认阈值 7 > 2 单元 → 形态 A（无 roles 字段）；证明生产接线生效。
      const routed = gate.nextRole(root)
      assert.equal(routed.role, 'developer')
      assert.equal(routed.roles, undefined)
    } finally {
      setRoleDefaults(original)
    }
  })
})
