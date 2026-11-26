/**
 * artifacts.js —— 交接物模板落盘与结构校验（CONTRACT §8）。
 * 只写模板文件本身，不碰其他文件；返回路径指针，不回传正文。路径做 projectRoot 标签内的防 .. 穿越校验。
 * 落盘/校验成功后按 CONTRACT §9 把路径指针登记进 EcState；登记回调由调用方注入，
 * 避免反向 import tools.js 造成 ESM 循环（artifacts ← tools 的既有依赖方向不变）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { ecError, safePathWithin, ARTIFACT_FILES } from './gate-service.js'
import { dirnameFor, joinFor } from './ec-path.js'

/**
 * 执行产物默认目录（对齐 skill：所有交接物统一落 .project_memory/tmp/，不散落项目根）。
 * 调用方显式传 path 时仍可覆盖，但默认落点必须是 tmp/。
 */
export const ARTIFACTS_DIR = '.project_memory/tmp'

/** ArtifactKey → 必须存在的顶层标题或字段（最小 schema，CONTRACT §8）。 */
export const ARTIFACT_SCHEMA = Object.freeze({
  prd: ['目标', '用户与场景', '用户故事', '优先级', '验收标准', '开放问题'],
  adr: ['状态', '目标与非目标', '总体架构', '模块清单', '数据模型', '风险与取舍', '待拍板'],
  contract: ['模块边界', '公开 API 签名', '数据流', '错误语义', 'Config schema', 'EcState JSON', '工具约定', '子命令', 'slot 清单', '交接物字段'],
  plan: ['目标', '检索套用约束', '单元', '覆盖映射'],
  brief: ['变更摘要', '风险', '验证结论'],
  release: ['发布清单', '回滚预案', '观察项', 'go/no-go'],
  testReport: ['测试代码指针', 'TDD 红灯证据', 'TDD 绿灯证据', '覆盖率', '边界异常', '真实输出', '证据分级'],
  findings: ['id', 'severity', 'file:line', 'issue', 'fix', 'VERDICT'],
  progress: ['Goal', 'Done', 'Next', 'Open questions', 'Key facts'],
})

/** 模板正文（最小结构骨架；正文由各岗位填）。 */
const TEMPLATES = Object.freeze({
  prd: '# PRD · 产品需求文档\n\n## 目标\n\n## 用户与场景\n\n## 用户故事\n\n## 优先级\n\n## 验收标准(可判定)\n\n## 开放问题\n',
  adr: '# ADR · 架构决策记录\n\n## 状态\n\n## 目标与非目标\n\n## 总体架构\n\n## 模块清单\n\n## 数据模型\n\n## 风险与取舍\n\n## 待拍板\n',
  contract: '# CONTRACT · 接口契约\n\n## 模块边界\n\n## 公开 API 签名\n\n## 数据流\n\n## 错误语义\n\n## Config schema\n\n## EcState JSON\n\n## 工具约定\n\n## 子命令\n\n## slot 清单\n\n## 交接物字段\n',
  plan: '# PLAN · 执行计划\n\n## 目标\n\n## 检索套用约束\n\n<!-- 写码前 recall 命中的工程记忆条目 id 列此；无命中标「无既有约定」 -->\n\n## 单元\n\n- [ ] id=P1 target=… ownerFiles=[…] acceptance=… status=todo constraints=[R-XXX-01]\n\n## 覆盖映射\n\n<!-- 源码顶层目录/模块类别 → 归属文档；建库自检要贴这张表的 diff -->\n\n| 源码目录/模块 | 归属文档 |\n| --- | --- |\n|  |  |\n',
  brief: '# BRIEF · 评审简报\n\n## 变更摘要\n\n## 风险\n\n## 验证结论\n',
  release: '# RELEASE · 发布清单\n\n## 发布清单\n\n## 回滚预案\n\n## 观察项\n\n## go/no-go(人)\n',
  testReport: '# TEST-REPORT · 测试报告\n\n## 测试代码指针\n\n## TDD 红灯证据(先于实现，失败测试+输出摘要)\n\n## TDD 绿灯证据(实现后的通过输出)\n\n## 覆盖率\n\n## 边界异常\n\n## 真实输出\n\n## 证据分级(实测/推断/猜测)\n',
  findings: '# FINDINGS · 评审发现\n\n| id | severity | file:line | issue | fix |\n| --- | --- | --- | --- | --- |\n\n## VERDICT\n',
  progress: '# PROGRESS · 长任务接力\n\n## Goal\n\n## Done\n\n## Next\n\n## Open questions\n\n## Key facts\n',
})

/**
 * 把交接物绝对路径登记到 EcState（幂等；登记失败回传领域错误，不静默）。
 * @param {object} args 含可选 update 回调的入参
 * @param {string} safe 已校验的绝对路径
 * @param {string} kind ArtifactKey
 * @returns {null|object} null=登记成功或无需登记；否则 EcError
 */
function registerPointer(args, safe, kind) {
  if (typeof args.update !== 'function') return null
  const r = args.update({ artifact: kind, path: safe })
  if (r && r.ok === false) return r.error
  return null
}

/**
 * 生成交接物模板或校验已有交接物结构（工具 ec_artifact 的能力实现）。
 * @param {{action: 'create'|'validate', kind: string, path?: string, projectRoot?: string,
 *         update?: (patch: {artifact: string, path: string}) => {ok: boolean, error?: object}}} args 入参；
 *        path 省略时默认 .project_memory/tmp/<文件名>；update 为可选的指针登记回调（注入以避免 ESM 循环）
 * @returns {{ok: true, kind: string, path: string, status: 'created'|'exists'|'valid'|'invalid', missingFields: string[]}
 *          |{ok: false, error: {code: string, message: string, details: object}}} Result
 */
export function artifactAction(args) {
  const kind = String(args?.kind ?? '')
  if (!Object.hasOwn(ARTIFACT_FILES, kind)) {
    return { ok: false, error: ecError('INVALID_INPUT', `未知交接物类型 ${kind}`, { kind }) }
  }
  const root = args.projectRoot ?? process.cwd()
  if (typeof root !== 'string' || !root.trim()) {
    return { ok: false, error: ecError('INVALID_INPUT', 'projectRoot 是空标签', { projectRoot: root }) }
  }
  // 执行产物统一落 .project_memory/tmp/（skill document-tree.md §7 硬要求，不散落项目根）。
  // 显式 path 只接受落在 tmp/ 内；传项目根等其他位置一律拒绝，避免散落。
  const tmpRoot = joinFor(root, ARTIFACTS_DIR)
  const rawPath = typeof args.path === 'string' && args.path.trim()
    ? args.path
    : joinFor(tmpRoot, ARTIFACT_FILES[kind])
  const safe = safePathWithin(rawPath, root)
  if (!safe) {
    return { ok: false, error: ecError('PATH_OUT_OF_ROOT', `交接物路径越出项目根：${rawPath}`, { path: rawPath, root }) }
  }
  if (!safePathWithin(safe, tmpRoot)) {
    return { ok: false, error: ecError('ARTIFACT_OUTSIDE_TMP',
      `交接物必须落在 .project_memory/tmp/ 内（不散落项目根）：${rawPath}`, { path: rawPath, tmpRoot }) }
  }
  if (args.action === 'create') {
    if (existsSync(safe)) {
      const err = registerPointer(args, safe, kind)
      if (err) return { ok: false, error: err }
      return { ok: true, kind, path: safe, status: 'exists', missingFields: [] }
    }
    try {
      mkdirSync(dirnameFor(safe), { recursive: true })
      writeFileSync(safe, TEMPLATES[kind], 'utf8')
    } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `模板落盘失败：${e?.message ?? e}`, { path: safe }) }
    }
    const err = registerPointer(args, safe, kind)
    if (err) return { ok: false, error: err }
    return { ok: true, kind, path: safe, status: 'created', missingFields: [] }
  }
  if (args.action === 'validate') {
    if (!existsSync(safe)) {
      return {
        ok: true, kind, path: safe, status: 'invalid',
        missingFields: [`文件不存在：${ARTIFACT_FILES[kind]}`],
      }
    }
    let text = ''
    try { text = readFileSync(safe, 'utf8') } catch (e) {
      return { ok: false, error: ecError('STORAGE_UNAVAILABLE', `读取交接物失败：${e?.message ?? e}`, { path: safe }) }
    }
    // 文件已落盘即登记指针，与结构校验结果无关（幂等，保证"存在即指针"）。
    const err = registerPointer(args, safe, kind)
    if (err) return { ok: false, error: err }
    const missingFields = ARTIFACT_SCHEMA[kind].filter((field) => !text.includes(field))
    return { ok: true, kind, path: safe, status: missingFields.length ? 'invalid' : 'valid', missingFields }
  }
  return { ok: false, error: ecError('INVALID_INPUT', `未知 action ${args.action}`, { action: args.action }) }
}
