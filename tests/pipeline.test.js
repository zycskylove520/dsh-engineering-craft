/**
 * tests/pipeline.test.js —— 回归测试：交接物落盘必须登记为 EcState 路径指针，门才能放行。
 * 覆盖 lead 实测的 P0 缺陷：ec_artifact create 后 artifacts.prd 仍为 null 导致 G1 永远过不了。
 *
 * 2026-11-24 对齐：交接物统一落 .project_memory/tmp/（不传 path 即默认目录），
 * state 落 .ec-state/state.json（不再用 .engineering-craft/，该名字只归记忆目录 marker）。
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ECO_TOOLS, ecGate } from '../tools.js'
import { statePathOf } from '../gate-service.js'
import { ARTIFACTS_DIR, artifactAction } from '../artifacts.js'
import { normalizeProjectRoot } from '../gate-service.js'

const byName = Object.fromEntries(ECO_TOOLS.map((t) => [t.name, t]))
const madeRoots = []
const freshRoot = () => { const r = tmpdir() + '/ec-pipeline-' + Math.random().toString(36).slice(2) + '-' + Date.now(); mkdirSync(r, { recursive: true }); madeRoots.push(r); return r }
after(() => { for (const r of madeRoots) { try { rmSync(r, { recursive: true, force: true }) } catch { /* 清理失败不影响测试结论 */ } } })
/** 交接物默认落点（.project_memory/tmp/<文件名>）。 */
const artifactPath = (root, file) => join(normalizeProjectRoot(root), ARTIFACTS_DIR, file)

describe('交接物落盘 → 门放行 集成链路（产物落 tmp/）', () => {
  test('create PRD → G1 缺交接物消失 → confirm-gate G1 成功 → stage=design', async () => {
    const root = freshRoot()
    const created = await byName.ec_artifact.execute({ action: 'create', kind: 'prd', projectRoot: root })
    assert.equal(created.ok, true, JSON.stringify(created.error))
    assert.equal(created.status, 'created')
    assert.equal(created.path, artifactPath(root, 'PRD.md'))

    const afterCreate = await byName.ec_stage.execute({ mode: 'query', projectRoot: root })
    assert.equal(afterCreate.ok, true)
    assert.ok(!afterCreate.missingArtifacts.includes('prd'), 'create 后 missingArtifacts 不应再含 prd')
    assert.equal(ecGate.read(root).artifacts.prd, created.path)

    const confirmed = await byName.ec_stage.execute({
      mode: 'confirm-gate', gate: 'G1', userConfirmed: true, projectRoot: root,
    })
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error))
    assert.equal(confirmed.stage, 'design')
    assert.equal(confirmed.gates.G1.passed, true)
  })

  test('validate PRD 幂等登记指针（已落盘但未登记时补登）', async () => {
    const root = freshRoot()
    ecGate.write(ecGate.read(root)) // 先有 state 文件（清掉指针）
    const p = artifactPath(root, 'PRD.md')
    mkdirSync(join(root, ARTIFACTS_DIR), { recursive: true })
    writeFileSync(p, '# PRD\n')

    const validated = await byName.ec_artifact.execute({ action: 'validate', kind: 'prd', path: p, projectRoot: root })
    assert.equal(validated.ok, true)
    assert.equal(validated.status, 'invalid') // 模板字段不全，结构校验不合格
    assert.equal(ecGate.read(root).artifacts.prd, p, 'validate 也应补齐指针登记')
  })

  test('显式 path 传项目根 → 拒绝（ARTIFACT_OUTSIDE_TMP，不散落）', () => {
    const root = normalizeProjectRoot(freshRoot())
    const r = artifactAction({ action: 'create', kind: 'prd', path: join(root, 'PRD.md'), projectRoot: root })
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'ARTIFACT_OUTSIDE_TMP')
    assert.ok(!existsSync(join(root, 'PRD.md')), '不得在项目根落产物')
  })

  test('G2 乱序被拒；先过 G1 再 confirm G2 成功（门序硬约束）', async () => {
    const root = freshRoot()
    for (const kind of ['prd', 'adr', 'contract']) {
      const r = await byName.ec_artifact.execute({ action: 'create', kind, projectRoot: root })
      assert.equal(r.ok, true, JSON.stringify(r.error))
    }
    // G1 未过时先确认 G2 → GATE_ORDER 拒绝
    const outOfOrder = await byName.ec_stage.execute({
      mode: 'confirm-gate', gate: 'G2', userConfirmed: true, projectRoot: root,
    })
    assert.equal(outOfOrder.ok, false)
    assert.equal(outOfOrder.error.code, 'GATE_ORDER')

    // 先过 G1
    const g1 = await byName.ec_stage.execute({
      mode: 'confirm-gate', gate: 'G1', userConfirmed: true, projectRoot: root,
    })
    assert.equal(g1.ok, true, JSON.stringify(g1.error))
    const confirmed = await byName.ec_stage.execute({
      mode: 'confirm-gate', gate: 'G2', userConfirmed: true, projectRoot: root,
    })
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error))
    assert.equal(confirmed.stage, 'coding')
    assert.equal(confirmed.gates.G2.passed, true)
  })

  test('交接物 key 名对齐：testReport / findings 落盘后 next-role 推进', async () => {
    const root = freshRoot()
    for (const kind of ['prd', 'adr', 'contract', 'plan', 'testReport', 'brief', 'findings']) {
      const r = await byName.ec_artifact.execute({ action: 'create', kind, projectRoot: root })
      assert.equal(r.ok, true, `${kind}: ${JSON.stringify(r.error)}`)
    }
    const state = ecGate.read(root)
    for (const key of ['prd', 'adr', 'contract', 'plan', 'testReport', 'brief', 'findings']) {
      assert.ok(state.artifacts[key], `${key} 指针应已登记`)
    }
    const next = await byName.ec_stage.execute({ mode: 'next-role', projectRoot: root })
    assert.deepEqual(next, { ok: true, role: 'ops' })
    assert.equal(existsSync(statePathOf(root)), true, 'create 登记指针时 .ec-state/state.json 应已落盘')
  })

  test('F-05：handoffs 用 role 键——create prd 点亮 product，adr+contract 点亮 architect', async () => {
    const root = freshRoot()
    await byName.ec_artifact.execute({ action: 'create', kind: 'prd', projectRoot: root })
    const afterPrd = ecGate.read(root)
    assert.ok(afterPrd.pipeline.handoffs.product, 'prd 落盘应点亮 pipeline.handoffs.product')
    assert.equal(afterPrd.pipeline.handoffs.prd, undefined, '不应再写 artifact 键（键空间错位）')

    await byName.ec_artifact.execute({ action: 'create', kind: 'adr', projectRoot: root })
    await byName.ec_artifact.execute({ action: 'create', kind: 'contract', projectRoot: root })
    const afterArchitect = ecGate.read(root)
    assert.ok(afterArchitect.pipeline.handoffs.architect, 'adr+contract 落盘应点亮 pipeline.handoffs.architect')

    // 幂等：重复登记同一 role 不应清空已有指针；后一个产物（contract）覆盖为自身路径是允许的。
    const again = await byName.ec_artifact.execute({ action: 'create', kind: 'adr', projectRoot: root })
    const afterAgain = ecGate.read(root)
    assert.equal(afterAgain.pipeline.handoffs.architect, again.path)
    assert.ok(afterAgain.pipeline.handoffs.product, '重登记 architect 不应抹掉 product')
  })

  test('G3 工具链路：证据须 command+outputDigest（不接受 evidence 字符串）；过 G1/G2 后成功且 stage→testing', async () => {
    const root = freshRoot()
    // 空证据 → NO_EVIDENCE（工具层显式校验）
    const empty = await byName.ec_stage.execute({ mode: 'confirm-gate', gate: 'G3', projectRoot: root })
    assert.equal(empty.ok, false)
    assert.equal(empty.error.code, 'NO_EVIDENCE')

    // 落齐 PRD/ADR/CONTRACT，按序过 G1/G2
    for (const kind of ['prd', 'adr', 'contract']) {
      await byName.ec_artifact.execute({ action: 'create', kind, projectRoot: root })
    }
    const g1 = await byName.ec_stage.execute({ mode: 'confirm-gate', gate: 'G1', userConfirmed: true, projectRoot: root })
    assert.equal(g1.ok, true, JSON.stringify(g1.error))
    const g2 = await byName.ec_stage.execute({ mode: 'confirm-gate', gate: 'G2', userConfirmed: true, projectRoot: root })
    assert.equal(g2.ok, true, JSON.stringify(g2.error))

    // 唯一契约：只给 evidence 字符串（旧格式）一律拒；必须 command + outputDigest。无兼容。
    const badShape = await byName.ec_stage.execute({ mode: 'confirm-gate', gate: 'G3', evidence: 'x::y', projectRoot: root })
    assert.equal(badShape.ok, false)
    assert.equal(badShape.error.code, 'NO_EVIDENCE')

    // FUSION：G3 前必须先记 TDD 红灯 + 至少一条验证证据（机械门）
    const noTdd = await byName.ec_stage.execute({ mode: 'confirm-gate', gate: 'G3', command: 'x', outputDigest: 'y', projectRoot: root })
    assert.equal(noTdd.ok, false)
    assert.equal(noTdd.error.code, 'TDD_RED_MISSING')
    const tdd = await byName.ec_stage.execute({ mode: 'tdd', failingTest: 'test/x.test.js::should fail', outputDigest: '1 failed', projectRoot: root })
    assert.equal(tdd.ok, true, JSON.stringify(tdd.error))
    const noVerify = await byName.ec_stage.execute({ mode: 'confirm-gate', gate: 'G3', command: 'x', outputDigest: 'y', projectRoot: root })
    assert.equal(noVerify.ok, false)
    assert.equal(noVerify.error.code, 'VERIFY_MISSING')
    const ver = await byName.ec_stage.execute({ mode: 'verify', command: 'node --check memory.js', outputDigest: 'exit 0', projectRoot: root })
    assert.equal(ver.ok, true, JSON.stringify(ver.error))
    // G3 带证据过门：command + outputDigest，与 verify 同形
    const g3 = await byName.ec_stage.execute({
      mode: 'confirm-gate', gate: 'G3', command: 'node --check memory.js', outputDigest: 'exit 0', projectRoot: root,
    })
    assert.equal(g3.ok, true, JSON.stringify(g3.error))
    assert.equal(g3.stage, 'testing')
    assert.equal(g3.gates.G3.passed, true)
    assert.equal(g3.gates.G3.evidence, 'node --check memory.js :: exit 0')
  })
})
