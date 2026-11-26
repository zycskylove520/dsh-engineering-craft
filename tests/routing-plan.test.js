/**
 * tests/routing-plan.test.js —— 回归测试（session-b820e44d 后续需求）：
 *  1. 「开始工程」路由提示：有代码无记忆库 → 直接建库不问；空目录/已有记忆库 → 才问用户。
 *  2. state.plan 写入口：ec_stage(mode=plan) / setPlan / /ec plan 能把单元落进 state.plan。
 *
 * 历史缺口：state.plan 初始 []，全项目没有任何入口新增单元——update() 只能 find 已存在
 * 单元再改，ec_artifact create plan 只写 md 不碰 state.plan。agent 写完 PLAN.md 后
 * state.plan 永远空，Web 面板与形态B并行读它等于废字段。
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EcGate, { statePathOf } from '../gate-service.js'
import { ECO_TOOLS } from '../tools.js'
import { runEcCommand } from '../command.js'
import { writeActiveRoot, clearActiveRoot } from '../active-root.js'

const byName = Object.fromEntries(ECO_TOOLS.map((t) => [t.name, t]))
const madeRoots = []
const freshRoot = () => { const r = mkdtempSync(join(tmpdir(), 'ec-routeplan-')); madeRoots.push(r); return r }
after(() => { for (const r of madeRoots) { try { rmSync(r, { recursive: true, force: true }) } catch { /* noop */ } } clearActiveRoot() })

describe('需求1：「开始工程」路由提示', () => {
  const g = new EcGate()
  test('promptSection 明确写出：有代码无记忆库直接建库、不问用户', () => {
    const root = freshRoot()
    writeActiveRoot(root)
    const prompt = g.promptSection(root)
    assert.ok(prompt.includes('开始工程'), prompt)
    assert.ok(/不要询问|直接/.test(prompt), `缺"直接建库不问"纪律：${prompt}`)
    assert.ok(/已有项目代码.*没有 \.project_memory/.test(prompt), `缺"有代码无记忆库"分支：${prompt}`)
  })
  test('promptSection 明确写出：空目录 / 已有记忆库才询问用户', () => {
    const root = freshRoot()
    writeActiveRoot(root)
    const prompt = g.promptSection(root)
    assert.ok(/目录是空的.*才问用户/.test(prompt), `缺"空目录才问"分支：${prompt}`)
    assert.ok(/已有 \.project_memory.*才问用户/.test(prompt), `缺"已有记忆库才问"分支：${prompt}`)
  })
  test('未确认项目根：强制前置询问，且明确它发生在三大分支之前、不可被"直接建库"绕过', () => {
    const prompt = g.promptSection(null)
    assert.ok(/问用户一句.*是否在.*会话目录/.test(prompt), `缺前置询问：${prompt}`)
    assert.ok(/强制前置步骤|不可省略|不得跳过/.test(prompt), `未标明强制：${prompt}`)
    assert.ok(/三大分支.*之前|落定之后才进入三大分支/.test(prompt), `未标明时序在前：${prompt}`)
    assert.ok(/不可被"直接建库"绕过|不得用"直接建库"绕过/.test(prompt), `未防绕过：${prompt}`)
  })
  test('已确认项目根的路由也声明"两段式/前置"时序，避免误读成连目录都不问', () => {
    const root = freshRoot()
    writeActiveRoot(root)
    const prompt = g.promptSection(root)
    assert.ok(/两段式/.test(prompt), `缺两段式声明：${prompt}`)
    assert.ok(/项目根确认.*强制前置|强制前置.*项目根确认/.test(prompt), `缺前置声明：${prompt}`)
    assert.ok(/不可省略|不可被"直接建库"绕过/.test(prompt), prompt)
  })
})

describe('需求2：state.plan 写入口', () => {
  test('ec_stage(mode=plan) 把单元落进 state.plan（全量替换）', async () => {
    const root = freshRoot()
    const units = [
      { id: 'P1', target: '核心状态', ownerFiles: ['rules.js'], acceptance: '单测绿', status: 'todo', constraints: ['R-SVC-01'] },
      { id: 'P2', target: '工具层', ownerFiles: ['tools.js'], acceptance: '工具测试绿' },
    ]
    const r = await byName.ec_stage.execute({ mode: 'plan', units, projectRoot: root })
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.plan.length, 2)
    const state = JSON.parse(readFileSync(statePathOf(root), 'utf8'))
    assert.equal(state.plan.length, 2)
    assert.equal(state.plan[0].id, 'P1')
    assert.deepEqual(state.plan[0].ownerFiles, ['rules.js'])
    assert.deepEqual(state.plan[0].constraints, ['R-SVC-01'])
    assert.equal(state.plan[1].status, 'todo', '缺省状态应为 todo')

    // 全量替换
    const r2 = await byName.ec_stage.execute({ mode: 'plan', units: [{ id: 'P9', target: '新计划' }], projectRoot: root })
    assert.equal(r2.ok, true)
    const state2 = JSON.parse(readFileSync(statePathOf(root), 'utf8'))
    assert.equal(state2.plan.length, 1)
    assert.equal(state2.plan[0].id, 'P9')
  })

  test('setPlan 校验：非数组 / 缺 id / id 重复 / 非法状态 / ownerFiles 非数组一律拒', () => {
    const root = freshRoot()
    const g = new EcGate()
    assert.equal(g.setPlan(root, 'not-array').ok, false)
    assert.equal(g.setPlan(root, [{ target: 'x' }]).ok, false, '缺 id')
    assert.equal(g.setPlan(root, [{ id: 'P1' }, { id: 'P1' }]).ok, false, 'id 重复')
    assert.equal(g.setPlan(root, [{ id: 'P1', status: 'weird' }]).ok, false, '非法状态')
    assert.equal(g.setPlan(root, [{ id: 'P1', ownerFiles: 'rules.js' }]).ok, false, 'ownerFiles 非数组')
    assert.equal(g.setPlan(root, [{ id: 'P1', constraints: [1, 2] }]).ok, false, 'constraints 非字符串数组')
  })

  test('setPlan 落盘后形态B并行能识别多单元（ownerFiles 不重叠）', () => {
    const root = freshRoot()
    const g = new EcGate()
    // 落齐 developer 之前的所有交接物（PRD/ADR/CONTRACT），但【不落 plan 交接物】——
    // developer 岗以 plan 交接物为准出；落了 plan 就会被判该岗已完成、推进到 tester，
    // 就测不到 developer 岗的形态B并行判定。state.plan 单元是独立字段，与 plan 交接物分开。
    for (const k of ['prd', 'adr', 'contract']) {
      g.update(root, { artifact: k, path: join(root, '.project_memory', 'tmp', k.toUpperCase() + '.md') })
    }
    g.confirmGate(root, 'G1', {}); g.confirmGate(root, 'G2', {})
    g.setPlan(root, [
      { id: 'P1', ownerFiles: ['rules.js'] },
      { id: 'P2', ownerFiles: ['tools.js'] },
    ])
    const role = g.nextRole(root)
    assert.equal(role.role, 'developer', JSON.stringify(role))
    assert.equal(role.mode, 'B', JSON.stringify(role))
    assert.equal(role.roles.length, 2)
  })

  test('/ec plan --units JSON 同步 state.plan', () => {
    const root = freshRoot()
    const units = [{ id: 'P1', target: '经命令行', ownerFiles: ['a.js'], acceptance: 'ok' }]
    const r = runEcCommand(`plan --units '${JSON.stringify(units)}'`, root)
    assert.equal(r.ok, true, JSON.stringify(r.error))
    const state = JSON.parse(readFileSync(statePathOf(root), 'utf8'))
    assert.equal(state.plan.length, 1)
    assert.equal(state.plan[0].id, 'P1')
  })

  test('/ec plan --units 非 JSON 返回 INVALID_INPUT', () => {
    const root = freshRoot()
    const r = runEcCommand('plan --units not-json', root)
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'INVALID_INPUT')
  })

  test('promptSection 写清：写完 PLAN.md 必须调 ec_stage(mode=plan) 同步 state', () => {
    const root = freshRoot()
    writeActiveRoot(root)
    const prompt = new EcGate().promptSection(root)
    assert.ok(/PLAN 单元同步/.test(prompt), prompt)
    assert.ok(/ec_stage\(mode="plan"/.test(prompt), `缺 mode=plan 指引：${prompt}`)
  })
})
