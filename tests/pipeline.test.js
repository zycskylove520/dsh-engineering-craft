/**
 * tests/pipeline.test.js —— 回归测试：交接物落盘必须登记为 EcState 路径指针，门才能放行。
 * 覆盖 lead 实测的 P0 缺陷：ec_artifact create 后 artifacts.prd 仍为 null 导致 G1 永远过不了。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ECO_TOOLS } from '../tools.js'
import { ecGate } from '../tools.js'
import { statePathOf } from '../gate-service.js'

const byName = Object.fromEntries(ECO_TOOLS.map((t) => [t.name, t]))
const freshRoot = () => mkdtempSync(join(tmpdir(), 'ec-pipeline-'))

describe('交接物落盘 → 门放行 集成链路', () => {
  test('create PRD → G1 缺交接物消失 → confirm-gate G1 成功 → stage=design', async () => {
    const root = freshRoot()
    const created = await byName.ec_artifact.execute({
      action: 'create', kind: 'prd', path: join(root, 'PRD.md'), projectRoot: root,
    })
    assert.equal(created.ok, true)
    assert.equal(created.status, 'created')

    const afterCreate = await byName.ec_stage.execute({ mode: 'query', projectRoot: root })
    assert.equal(afterCreate.ok, true)
    assert.ok(!afterCreate.missingArtifacts.includes('prd'), 'create 后 missingArtifacts 不应再含 prd')
    assert.equal(ecGate.read(root).artifacts.prd, join(root, 'PRD.md'))

    const confirmed = await byName.ec_stage.execute({
      mode: 'confirm-gate', gate: 'G1', userConfirmed: true, projectRoot: root,
    })
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error))
    assert.equal(confirmed.stage, 'design')
    assert.equal(confirmed.gates.G1.passed, true) // confirm-gate 返回完整 EcState（§9 gates 为对象）
  })

  test('validate PRD 幂等登记指针（已落盘但未登记时补登）', async () => {
    const root = freshRoot()
    // 先造一个"文件已落盘但 state 未登记"的初始态：用 gate-service 直接写 state 清掉指针。
    const { write } = ecGate
    const state = ecGate.read(root)
    write.call(ecGate, state)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(root, 'PRD.md'), '# PRD\n')

    const validated = await byName.ec_artifact.execute({
      action: 'validate', kind: 'prd', path: join(root, 'PRD.md'), projectRoot: root,
    })
    assert.equal(validated.ok, true)
    assert.equal(validated.status, 'invalid') // 模板字段不全，结构校验不合格
    assert.equal(ecGate.read(root).artifacts.prd, join(root, 'PRD.md'), 'validate 也应补齐指针登记')
  })

  test('G2：create ADR + CONTRACT 后可 confirm-gate G2（H2 断言）', async () => {
    const root = freshRoot()
    for (const kind of ['adr', 'contract']) {
      const r = await byName.ec_artifact.execute({
        action: 'create', kind, path: join(root, kind.toUpperCase() + '.md'), projectRoot: root,
      })
      assert.equal(r.ok, true)
    }
    const before = await byName.ec_stage.execute({ mode: 'query', projectRoot: root })
    assert.ok(!before.missingArtifacts.includes('adr'))
    assert.ok(!before.missingArtifacts.includes('contract'))

    // G2 只要求 adr+contract 指针（不要求 PRD）；确认走 userConfirmed。
    const confirmed = await byName.ec_stage.execute({
      mode: 'confirm-gate', gate: 'G2', userConfirmed: true, projectRoot: root,
    })
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error))
    assert.equal(confirmed.stage, 'coding')
    assert.equal(confirmed.gates.G2.passed, true)
  })

  test('交接物 key 名对齐：testReport / findings 落盘后 next-role 推进', async () => {
    const root = freshRoot()
    for (const [kind, file] of [['prd', 'PRD.md'], ['adr', 'ADR.md'], ['contract', 'CONTRACT.md'],
      ['plan', 'PLAN.md'], ['testReport', 'TEST-REPORT.md'], ['brief', 'BRIEF.md'], ['findings', 'FINDINGS.md']]) {
      const r = await byName.ec_artifact.execute({ action: 'create', kind, path: join(root, file), projectRoot: root })
      assert.equal(r.ok, true, `${kind}: ${JSON.stringify(r.error)}`)
    }
    const state = ecGate.read(root)
    for (const key of ['prd', 'adr', 'contract', 'plan', 'testReport', 'brief', 'findings']) {
      assert.ok(state.artifacts[key], `${key} 指针应已登记`)
    }
    // 全部交接物齐（缺 release）→ next-role 指向 ops。
    const next = await byName.ec_stage.execute({ mode: 'next-role', projectRoot: root })
    assert.deepEqual(next, { ok: true, role: 'ops' })
    assert.equal(existsSync(statePathOf(root)), true, 'create 登记指针时 state.json 应已落盘')
  })

  test('F-05：handoffs 用 role 键——create prd 点亮 product，adr+contract 点亮 architect', async () => {
    const root = freshRoot()
    await byName.ec_artifact.execute({ action: 'create', kind: 'prd', path: join(root, 'PRD.md'), projectRoot: root })
    const afterPrd = ecGate.read(root)
    assert.ok(afterPrd.pipeline.handoffs.product, 'prd 落盘应点亮 pipeline.handoffs.product')
    assert.equal(afterPrd.pipeline.handoffs.prd, undefined, '不应再写 artifact 键（键空间错位）')

    await byName.ec_artifact.execute({ action: 'create', kind: 'adr', path: join(root, 'ADR.md'), projectRoot: root })
    await byName.ec_artifact.execute({ action: 'create', kind: 'contract', path: join(root, 'CONTRACT.md'), projectRoot: root })
    const afterArchitect = ecGate.read(root)
    assert.ok(afterArchitect.pipeline.handoffs.architect, 'adr+contract 落盘应点亮 pipeline.handoffs.architect')

    // 幂等：重复登记同一 role 不应清空已有指针；后一个产物（contract）覆盖为自身路径是允许的（同一 role 的最新交接物）。
    await byName.ec_artifact.execute({ action: 'create', kind: 'adr', path: join(root, 'ADR.md'), projectRoot: root })
    const afterAgain = ecGate.read(root)
    assert.equal(afterAgain.pipeline.handoffs.architect, join(root, 'ADR.md'))
    assert.ok(afterAgain.pipeline.handoffs.product, '重登记 architect 不应抹掉 product')
  })
})
