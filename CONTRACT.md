# CONTRACT · engineering-craft DSH 工程流程套件（接口契约 · G2 架构交接物）

> 架构岗（ec-architect）交接物。**只定接口，不含实现代码**（G2 门：人确认后才由研发岗开工）。
> 基线：ADR `../engineering-craft-dsh-suite-adr.md`（G2 已放行，2026-11-23 修订）、`PRD.md`、`PLAN.md`、`.project_memory/`。
> 契约事实等级标注：`[实测]` = 本轮 `cordis_inspect_query` / asar 文档核对；`[实测纠正]` = lead 从已装插件源码实测、推翻本文件早期假设并据以修订（证据见文内引用路径）；`[交接]` = 任务简报给出的已核实实时契约；`[设计]` = 本文件定义、待实施验证。凡 `[待实测]` 一律进 `open-questions.md`，不得臆造。
> 修订证据源：已安装插件 `dsh-bili-scroll` 的 `index.js` + `lib/hostdeps.mjs`（工具/Config 真实写法）；`dsh-windows-mcp`、`dsh-ssh`、`dsh-meme` 的 patch（单 host row + client 声明）。
> 规范源是 `engineering-craft` skill；本套件只存"规范路径指针 + 门规则"，不复制 skill 正文（ADR §11）。

---

## 0. 本契约的约束（读到先）

- **公开面最小**：模块间只认本文列出的导出；模块内部函数不跨模块引用。
- **错误语义统一**：可恢复失败用 `Result`（`{ok:true,value}` / `{ok:false,error:EcError}`），不可恢复（配置非法、契约违约）`throw EcError`。禁止静默吞错、禁止空 catch（`.project_memory/conventions/practices.md`）。
- **交接只传路径指针**：岗位间、工具与面板间传绝对路径字符串，不传正文内容（ADR §6.1）。
- **门是纪律不是内核强制**：所有"拒绝"通过工具返回值 + `systemPrompt.section()` 可见性实现；不冒充系统 hook（ADR-003）。
- **optional peer 必须容错加载 `[实测纠正]`**：`@deepseek-ai/dsh-tools`（`defineTool`）与 schemastery（`z`）在桌面 profile 常未安装；裸 import 会让整条插件不激活。宿主树解析不到就退回本地等价实现 / `Config=undefined`，**绝不因一个 import 杀死插件**（证据：dsh-bili-scroll `index.js` + `lib/hostdeps.mjs`）。
- **打包形态 `[实测纠正]`**：一个 package 的 host 半只用**一个 row**（`name`=包名，loader import exports `"."`，在单一 `apply(ctx)` 内注册所有 host 能力）；client 半不是独立 row，靠 `package.json` `dsh.client` 声明自动挂载 exports `"./client"`（证据：dsh-windows-mcp / dsh-ssh / dsh-meme patch）。ADR §2/§9 的"4 row"在本契约中不采用，见 §1。

---

## 1. 模块边界

单 bundle `@local/engineering-craft-suite`，**一个 host plugin row + package.json 的 `dsh.client` 声明挂载 client 半** `[实测纠正]`（原"4 row ecGate/ecTools/ecPanel/ecCommand"是早期假设，被实测推翻；证据 dsh-windows-mcp `cordis.patch.yml`、dsh-ssh/dsh-meme patch）。

- `cordis.patch.yml` 只插一行：`id: '@local/engineering-craft-suite'`, `name: '@local/engineering-craft-suite'`（= 包名；loader import 该包的 exports `"."`，即 `index.js`）。**row id 定为包名本身**，使 loader entry id 与 Config namespace 一致（bili 教训：export Config 时两者必须相等，见 §4.2）。
- `index.js` 的单一 `apply(ctx, config)` 内统一注册全部 host 能力：投影（ecGate）、4 工具（ec_stage/ec_artifact/ec_memory/ec_gate_metrics）、`/ec` 命令、`systemPrompt.section()`。
- client 半由 `package.json` 的 `"dsh": {"client": {"platform":"web","immediately":true,"inject":[...]}, "bundle":{"patch":"./cordis.patch.yml"}}` 自动挂载 `exports["./client"]`，`client.js` 内用 `window.__ModuleLoader__.load` 注册 slot；**不单独占 row**。

依赖只允许**自上而下**（展示 → 门控 → 工具 → 底座），门控层不反向依赖展示层；下列"模块"都是这**一个包内的文件**，不是独立 plugin row。

```
展示层  client.js + panel.jsx/confirm.jsx   （Client，只渲染 wire.view，不 fold 事件）
   │  仅通过 wire.view 读 EcState；写动作经 ctx.remote 走 Host 命令
   ▼
门控层  ecGate（Host service class，默认导出）
   │  对外提供 EcState 查询/门判定/next-role，是工具与命令的唯一状态源
   ▼
能力层  tools.js（4 tool） + command.js（/ec） + artifacts.js + memory.js + metrics.js
   │  组装 gate 的方法；文件/目录副作用只在本层
   ▼
底座层  ctx.tools / ctx.commands / ctx.sessionProjections / ctx.systemPrompt / ctx.storage / slot / subagents
```

> 下表"归属"列均为**同一包内、由单一 `apply(ctx)` 统一注册**的逻辑分组，不是独立 plugin row `[实测纠正]`。

| 模块（包内文件） | 归属（统一入口 `index.js apply`） | 只依赖 | 被依赖 | 允许副作用 |
|---|---|---|---|---|
| `gate-service.js`（默认导出 `EcGate` class） | host apply | sessionProjections/storage/config/systemPrompt | tools / command | 注册投影 + prompt section；门状态读写 |
| `rules.js`（纯函数集） | host apply 内 | 无（纯） | gate-service / tests | 无 |
| `tools.js` | host apply | gate-service, artifacts, memory, metrics | DSH tools 注册表 | 工具注册；经下层写文件 |
| `artifacts.js` | host apply 内 | ctx.fs / Node fs | tools | 交接物模板落盘 + 结构校验 |
| `memory.js` | host apply 内 | Node fs | tools | `.project_memory/` 建库/写回 |
| `metrics.js` | host apply 内 | gate-service / storage | tools, command | GATE-LOG 记录 |
| `command.js` | host apply | gate-service, metrics | DSH commands 注册表 | 命令注册 |
| `client.js` + `*.jsx` | `dsh.client` 自动挂载的 client 半 | slot props 的 wire.view | DSH slots | 仅渲染 + 用户动作回传 |

**边界铁律**：`rules.js` 必须保持纯函数、无 ctx 依赖（单测可独立跑）；`EcGate` 是状态的唯一写入口，工具/命令不得各自维护门状态副本；host 与 client 各自的资源注册写在自己的 apply 内、由各自 ctx 管理 dispose。

---

## 2. 公开 API 签名（JS + TSDoc 契约说明）

> 只列跨模块公开面。TSDoc 用 `/** ... */`，写明用途/参数/返回/边界。实现者必须保留这些注释。

### 2.1 `rules.js`（纯函数，`.project_memory/conventions/naming.md`：kebab-case）

```js
/**
 * 判定单个门是否满足放行条件（纯函数）。
 * @param {EcGateId} gateId 门标识 G1|G2|G3
 * @param {EcState} state 当前工程状态（只读，不得修改）
 * @param {GateRule} rule 该门的 Config 规则
 * @returns {{ok: true} | {ok: false, error: EcError}} ok=放行；否则 error.code 指明缺交接物/未确认/无证据
 */
export function checkGate(gateId, state, rule) { /* 实现留白 */ }

/**
 * 按岗位顺序返回下一个应启动的岗位（纯函数）；形态 A 单岗位，形态 B 研发岗多单元并行。
 * 仅当上游交接物路径存在（非 null 且对应文件已落盘）时放行该岗位。
 * 形态 B 仅在下一岗位为 developer 且三道门全过时启用（ADR-PARALLEL）：
 * 能力门 capabilities.subagent !== false（默认 true）、任务形状门 todo 单元≥2 且 ownerFiles 两两不重叠、收益门 单元数≥minFilesForParallel（默认2）。
 * @param {EcState} state 当前状态
 * @param {PipelineOrder} order 岗位顺序表（默认常量 DEFAULT_PIPELINE）
 * @param {{capabilities?:{subagent?:boolean}, thresholds?:{minFilesForParallel?:number}}} [opts]
 * @returns {{role: EcRole} | {role: null, blockedBy: string} | {role:'developer', roles: string[], mode:'B', units: Array<{id:string,ownerFiles:string[]}>}}
 *   形态 A 兼容旧形状；形态 B 额外带 roles/units/mode。blockedBy 为缺失交接物键
 */
export function nextRole(state, order = DEFAULT_PIPELINE, opts = {}) { /* 实现留白 */ }

/**
 * 计算从当前阶段推进到目标阶段前必须通过的全部门（纯函数）。
 * @param {EcStage} from 当前阶段
 * @param {EcStage} to 目标阶段
 * @returns {EcGateId[]} 需通过的门 id 列表，顺序即推进顺序
 */
export function gatesBetween(from, to) { /* 实现留白 */ }

/** @type {PipelineOrder} 默认顺序 product→architect→developer→tester→reviewer→ops（ADR §6.1） */
export const DEFAULT_PIPELINE;
```

### 2.2 `gate-service.js`（Host service class，默认导出）

```js
/**
 * 每会话工程状态的唯一所有者。注册 SessionProjection，派生 EcState；
 * 工具/命令经本类查询与推进门，不另存副本。
 * DSH 契约：sessionProjections.register(definition) -> Promise<ProjectionHandle<S>>，
 * handle.stateOf() 读状态；definition 含 key/apply/view/wire/stateVersion。[交接][实测 §目录签名]
 */
export default class EcGate {
  /**
   * @param {import('cordis').Context} ctx 插件上下文
   * @param {EcConfig} config 已校验的插件 Config
   */
  constructor(ctx, config) {}

  /**
   * 读某会话的工程状态。内部走 projectionHandle.stateOf()。
   * @param {Session} session DSH 会话对象
   * @returns {EcState} 当前状态快照（JSON，调用方不得 mutate）
   */
  stateOf(session) { /* 留白 */ }

  /**
   * 记录人确认的门（G1/G2/go-no-go 只由人拍板，agent 不得代确认）。
   * @param {Session} session 会话
   * @param {EcGateId} gateId 门 id
   * @param {{at?: number, evidence?: string}} meta 时间戳与证据摘要
   * @returns {Result<EcState, EcError>} G3 不接受本路径（G3 走 confirmG3）
   */
  confirmGate(session, gateId, meta) { /* 留白 */ }

  /**
   * 记录 G3 窄检通过（需真实命令输出证据；confirmBy=agent）。
   * @param {Session} session 会话
   * @param {{command: string, outputDigest: string}} evidence 命令与输出摘要（非全文）
   * @returns {Result<EcState, EcError>}
   */
  confirmG3(session, evidence) { /* 留白 */ }

  /**
   * 更新交接物路径指针或 PLAN 单元状态。
   * @param {Session} session 会话
   * @param {{artifact?: ArtifactKey, path?: string, planId?: string, planStatus?: PlanStatus}} patch
   * @returns {Result<EcState, EcError>} 路径须落在允许根内，否则 error.code=PATH_OUT_OF_ROOT
   */
  update(session, patch) { /* 留白 */ }

  /**
   * 返回当前应启动的下一个岗位（封装 rules.nextRole）。
   * @param {Session} session 会话
   * @returns {{role: EcRole} | {role: null, blockedBy: string}}
   */
  nextRole(session) { /* 留白 */ }

  /**
   * 生成注入 prompt 的门状态段落文本（供 systemPrompt.section 使用）。
   * @param {Session} session 会话
   * @returns {string} 简短文本：当前阶段/未过门/在岗岗位；不重复工具说明（tool-design.md）
   */
  promptSection(session) { /* 留白 */ }
}
```

**投影注册契约（apply 内一次性注册，返回 disposer 交给 ctx.effect）**：

```js
/**
 * 注册工程状态投影（纯 fold）。
 * @param {EcConfig} config 门规则来源
 * @returns {Promise<{handle: ProjectionHandle<EcState>, dispose: () => Promise<void>}>}
 *   definition = { key:'engineeringCraft', stateVersion:1,
 *     apply(state, event){...}, view(state){...}, wire: [待实测] 见 open-questions OQ-1 }
 *   apply 对忽略的事件返回同一引用；view 值不变返回同一引用（抑制无效发布）。[交接]
 */
export async function registerEcProjection(config) { /* 留白 */ }
```

### 2.3 `tools.js`（四个工具 spec，经 `defineTool` 包装后交 `ctx.tools.register`）

`[实测纠正]` 真实注册写法（证据：dsh-bili-scroll `index.js` L597–601 + `lib/hostdeps.mjs`）：

```js
ctx.tools.register(defineTool({ name, description, parameters, output, execute }))
```

- `defineTool` 来自 `@deepseek-ai/dsh-tools`（optional peer，桌面 profile 常缺）⇒ **必须容错加载**：宿主树/自身依赖都取不到时用本地等价实现（做同样的 parameters/output.schema 校验后原样返回 spec），否则整条插件不激活。
- `parameters` 是**标准 JSON Schema object**（不是 zod / 不是 inputSchema）；每个 `type:'object'`（含嵌套）**必须显式写 `additionalProperties`**，否则 defineTool 校验抛错。
- `output` 可选：默认 `textOutput`（`{schema:{type:'object',properties:{},additionalProperties:true}, render(_args,value){...}}`），或自定义 `{schema, format/render}`。
- `execute(args, exec)`：`args` 已按 `parameters` 校验（路径仍在内部二次校验）；`exec?.signal` 可取消；**return 普通对象即可**（失败返回 `{ok:false, error:{code,...}}` 之类），不是 `{content:[...]}` 的 `ToolResult`。

```js
/**
 * 工具 spec（defineTool 输入）统一签名。[实测纠正]
 * @param {object} spec
 * @param {string} spec.name 工具名 ec_*
 * @param {string} spec.description 说行为不说实现（tool-design.md）
 * @param {object} spec.parameters 标准 JSON Schema object；每层 object 必写 additionalProperties
 * @param {object} [spec.output] 默认 textOutput；自定义为 {schema, render}
 * @param {Function} spec.execute async (args, exec) => 普通对象；args 已校验，exec.signal 可取消
 */
// 注册：ctx.tools.register(defineTool(spec))；四个 spec 的字段见 §5。
```

> OQ-2（原"inputSchema 是 JSON Schema 还是 zod"）已由上述实测澄清，见 §5 与 open-questions「已实测澄清」区。

### 2.4 `client.js`（Client 懒工厂，无副作用）

```js
// 模板约定：[实测 asar templates/decoration/client.js]
window.__ModuleLoader__.load({
  id: '@local/engineering-craft-suite',
  /** @param {(name: string) => any} require 浏览器模块表；React 从 require('react') 取，禁止自带 */
  factory(require) {
    const React = require('react');
    return {
      inject: ['slots'],
      /** @param {{slots: SlotsService}} ctx Client 上下文；注册在 apply 内、dispose 由 ctx 管 */
      apply(ctx) { /* 见 §7 slot 清单；每个 inject 回调返回 register 的 disposer */ },
    };
  },
});
```

**Client 组件公开 props（唯一读状态入口）**：

```js
/**
 * EcPanel / EcConfirmCard 的唯一数据入口。
 * @typedef {{view: EcState,              // Host wire.view 算好的状态，Client 只读
 *            onAction: (intent: EcIntent) => void}} PanelProps
 * EcIntent = {kind:'confirm-gate', gateId} | {kind:'go-no-go', decision:'approve'|'reject'}
 *           | {kind:'open-artifact', key: ArtifactKey}
 * 写动作经 ctx.remote 调 Host 命令；Client 不改 EcState、不 fold 事件。[交接]
 */
```

---

## 3. 数据流

```
[agent 动作 / 文件落盘 / 用户确认]
        │
        ▼
ctx.sessionProjections.apply(state, existingEvent)  ← 只 fold 既有 session 事件；
        │                                            不 append 新 event type（ADR-004）[交接]
        ▼
EcState（投影缓存，stateVersion=1）──handle.stateOf()──► EcGate ──► 4 tools / /ec / promptSection
        │
        └──wire.view(state)──► Client slot props.view ──► EcPanel 渲染（只读）
                                      │
                     用户点确认卡 ──EcIntent──► ctx.remote ──► /ec confirm 子命令 ──► EcGate.confirmGate
```

- **门状态持久化**：不写 session 日志自定义 type；门确认/交接物指针存 projection 状态 + `ctx.storage`/`storageDomain`（具体 service 名与 domain spec `[待实测]` → OQ-3）。
- **同引用抑制**：`apply` 忽略事件返回同一 state 引用；`view` 值不变返回同一引用（ADR §4.1、practices.md §Performance）。
- **单一写口**：所有状态变更经 `EcGate.update/confirm*`，工具与命令只转发，不直接改 storage。
- **UI 动作复用 Host 操作**：confirm/go-no-go 的权威逻辑在 Host 命令，Client 只触发（user-actions.md「one operation, two callers」；确认类动作保持用户专属，agent 不可代批）。

---

## 4. 错误语义与 Config schema

### 4.1 `EcError`（统一领域错误）

```js
/**
 * 领域错误：工具/命令把底层异常转成带 code 的 EcError；可恢复失败用 Result 返回。
 * @typedef {{code: EcErrorCode, message: string, details?: Record<string, unknown>}} EcError
 * EcErrorCode =
 *   'GATE_NOT_PASSED'       // 门未过，拒绝下游动作（details.gateId / missingArtifacts）
 *   'MISSING_ARTIFACT'      // 交接物缺失（details.artifact / expectedPath）
 *   'NOT_USER_CONFIRMED'    // 需人拍板但无确认（details.gateId）
 *   'NO_EVIDENCE'           // G3 缺真实命令输出证据
 *   'INVALID_INPUT'         // 入参不合 schema / 路径非法
 *   'PATH_OUT_OF_ROOT'      // 路径越出允许根（防穿越）
 *   'ARTIFACT_SCHEMA_FAIL'  // 交接物结构校验失败（details.artifact / missingFields）
 *   'CONFIG_INVALID'        // Config 违约（不可恢复，throw）
 *   'STORAGE_UNAVAILABLE'   // storage service/profile 不可用
 */
```

错误呈现 `[实测纠正]`：工具 `execute` 返回普通对象，失败为 `{ok:false, error:{code, details}}`（经默认 textOutput 渲染成文本；不是 `isError:true` 的 ToolResult）；命令返回结构化 status + reason；Client 确认卡显示失败原因、不谎称已保存（configuration.md）。

### 4.2 Config schema（门规则 + 收益阈值；用户 patch 可调）

`[实测纠正]` Config 真实写法（证据：dsh-bili-scroll `index.js` L46–54 + `lib/hostdeps.mjs`）：

- `export const Config = z.object({...})`，`z` 来自 schemastery（optional peer）；schemastery 彻底取不到时 `Config = undefined`，**插件照常加载，只是设置页降级**。
- **每个要被设置页写的字段必须 `.extra('volatile', true)`**：DSH 的 settings 层只认 volatile 字段（`volatileForm(schema)`），否则写设置抛 "has no volatile fields"。
- **loader entry id 必须等于 namespace 名**（row id 即包名 ` '@local/engineering-craft-suite'`，见 §1）+ 本模块导出 `Config`，三者齐备设置页才可写。
- schema 校验范围要宽松：范围约束（如阈值上下限）放在**写/读时钳制**，不要写成 `.min()/.max()` 等硬校验——校验不过会让 cordis 拒收 entry ⇒ 整条插件不激活（bili `commentPerRound` 的教训）。

默认值来自 ADR §4.2；`收益阈值` 指多 agent 三道门的"任务够大才摊平协调成本"门（ADR §11 保留为可配；本套件恒走多 agent，但阈值用于提示"是否需要 workflow 升级"）。

```js
/**
 * 插件 Config（用户可在设置页改；schemastery 缺失时为 undefined，插件照常加载）。[实测纠正]
 * 门规则驱动 rules.checkGate；判定纯函数，工具/面板/命令共用同一份。
 * 字段：gates 门规则表 / thresholds 三道门收益阈值 / paths 路径策略（相对 projectRoot）。
 * 每个字段 .extra('volatile', true) 才能被设置页写。
 */
export const Config = !z ? undefined : z.object({
  // gates: G1/G2/G3 各 {requiredArtifacts, requireUserConfirm, requireEvidence}（默认值见下）
  // thresholds: {minFilesForParallel, minUnitsForWorkflow}
  // paths: {memoryDirName, artifactsRoot}
  // ↑ 各字段均在实现时补 .extra('volatile', true)；具体 z 类型（z.object/z.natural/z.string…）由实现定
})
// 默认：
// gates = {
//   G1: { requiredArtifacts:['prd'],             requireUserConfirm:true,  requireEvidence:false },
//   G2: { requiredArtifacts:['adr','contract'],  requireUserConfirm:true,  requireEvidence:false },
//   G3: { requiredArtifacts:[],                  requireUserConfirm:false, requireEvidence:true  },
// }
// thresholds = { minFilesForParallel: 2, minUnitsForWorkflow: 6 }
// paths = { memoryDirName:'.project_memory', artifactsRoot:'.' }
```

`GateRule` = `{requiredArtifacts: ArtifactKey[], requireUserConfirm: boolean, requireEvidence: boolean}`。
Config 保存走 `ctx.fiber.entry` + `ctx.get('configEditor').edit(entry, current => ({...current, ...}))` `[实测]`；密钥（若有）走 `ctx.credentials`，不写 patch `[实测]`。无密钥需求时不声明 `credentials` inject。volatile 字段更新就地生效（不重启插件），适合门规则/阈值热调。

> OQ-4（原"Config 是 zod 还是普通对象"）已由上述实测澄清，见 open-questions「已实测澄清」区。

---

## 5. 四个工具的 name / description / parameters / output 约定

> `[实测纠正]` 字段是 `defineTool({name, description, parameters, output, execute})`（非 inputSchema/handler），注册为 `ctx.tools.register(defineTool(spec))`。`defineTool` 必须容错加载（宿主树 → 自身依赖 → 本地等价实现），否则整条插件不激活；见 §2.3 与证据 dsh-bili-scroll `lib/hostdeps.mjs`。
> 描述遵守 tool-design.md：说行为不说实现、约束放参数、事实只说一次、bounded output。`parameters` 用标准 JSON Schema object 记法；**每个 `type:'object'`（含嵌套）必须显式写 `additionalProperties`**（defineTool 校验要求）。`execute(args, exec)` 返回普通对象（失败用 `{ok:false, error:{code,...}}`），不是 `{content:[...]}` 的 `ToolResult`；`exec?.signal` 可取消。默认 `output`=textOutput。OQ-2 已由实测澄清。

### 5.1 `ec_stage`

- **description**：`查询当前工程阶段与门状态、尝试过门、或取下一个应启动的岗位；门未过时拒绝进入下游动作。`
- **parameters**（标准 JSON Schema object）：
```json
{
  "type": "object",
  "properties": {
    "mode": {"type":"string","enum":["query","confirm-gate","next-role"],"default":"query",
             "description":"query=只读状态；confirm-gate=记录人确认/证据；next-role=返回下一岗位"},
    "gate": {"type":"string","enum":["G1","G2","G3"],"description":"confirm-gate 时必填"},
    "evidence": {"type":"string","description":"G3 confirm-gate 时必填：命令+输出摘要（非全文）"}
  },
  "required": ["mode"], "additionalProperties": false
}
```
- **execute 返回**（默认 textOutput 渲染）：`{ok:true, stage, gates, nextRole, missingArtifacts, blockedBy}` 普通对象；拒绝时 `{ok:false, error:{code:'GATE_NOT_PASSED'|'NOT_USER_CONFIRMED'|'NO_EVIDENCE', details}}`（不是 `isError:true` 的 ToolResult）。`confirm-gate` 的 G1/G2 只接受"用户已在本轮确认"的上下文标记，agent 不得自报确认（ADR-003）。

### 5.2 `ec_artifact`

- **description**：`按交接物类型生成模板文件（绝对路径指针）或校验已有交接物结构，不写正文以外的文件。`
- **parameters**（标准 JSON Schema object）：
```json
{
  "type": "object",
  "properties": {
    "action": {"type":"string","enum":["create","validate"],"description":"create=写模板；validate=只读校验"},
    "kind": {"type":"string","enum":["prd","adr","contract","plan","brief","release"]},
    "path": {"type":"string","description":"目标绝对路径；须落在允许根内（PATH_OUT_OF_ROOT 防穿越）"}
  },
  "required": ["action","kind","path"], "additionalProperties": false
}
```
- **execute 返回**：`{ok:true, kind, path, status:'created'|'exists'|'valid'|'invalid', missingFields:string[]}` 普通对象；失败 `{ok:false, error:{code:'ARTIFACT_SCHEMA_FAIL'|'PATH_OUT_OF_ROOT', details}}`。**路径指针**是唯一返回值，不回传正文。

### 5.3 `ec_memory`

- **description**：`初始化或按 INDEX 线索读写 .project_memory/ 规范层；只存规范，不写会话流水。`
- **parameters**（标准 JSON Schema object）：
```json
{
  "type": "object",
  "properties": {
    "action": {"type":"string","enum":["init","write","query"],"description":"init=建骨架；write=写规范带来源+日期；query=按需读"},
    "projectRoot": {"type":"string","description":"项目根绝对路径；缺省由 workingDirectory.service 解析（[待实测] OQ-5）"},
    "layer": {"type":"string","enum":["architecture","conventions","project","open-questions"],
              "description":"write/query 的目标层（INDEX.md 单独可用 'index'）"},
    "content": {"type":"string","description":"write 时正文；须含来源与日期指针"},
    "query": {"type":"string","description":"query 时的检索线索（不倾倒全目录）"}
  },
  "required": ["action"], "additionalProperties": false
}
```
- **execute 返回**：`{ok:true, action, path, excerpt?, status}` 普通对象；`init` 冲突目录名冲突时用 `.project_memory_engineer/` 并打标记（ADR §8）；违反"只写规范层"返回 `{ok:false, error:{code:'INVALID_INPUT', details}}`。

### 5.4 `ec_gate_metrics`

- **description**：`记录或回看 GATE-LOG 门度量（每次门拦截/放行的原因与指针），用于反复拦截时回写规范。`
- **parameters**（标准 JSON Schema object）：
```json
{
  "type": "object",
  "properties": {
    "action": {"type":"string","enum":["record","list"],"default":"list"},
    "gate": {"type":"string","enum":["G1","G2","G3"],"description":"record 时必填"},
    "outcome": {"type":"string","enum":["blocked","passed"],"description":"record 时必填"},
    "reason": {"type":"string","description":"record 时：拦截/放行原因摘要（bounded）"},
    "limit": {"type":"integer","minimum":1,"maximum":100,"default":20,"description":"list 时最多返回条数"}
  },
  "required": ["action"], "additionalProperties": false
}
```
- **execute 返回**：`{ok:true, records: GateMetric[], truncated:boolean}` 普通对象；每条 `{gate, outcome, reason, at, evidencePath}`；bounded，不倾倒全量日志（tool-design.md）。存储载体 `[待实测]` → OQ-3。

---

## 6. `/ec` 子命令（`ctx.commands.register`）

- **命令名**：`/ec`；`description`：工程套件统一入口。
- 子命令（`line` 形如 `/ec status`）：

| 子命令 | 作用 | 输出 |
|---|---|---|
| `/ec status` | 显示当前阶段 / 三门状态 / 在岗岗位 | 简表 + 缺失交接物指针 |
| `/ec next` | 返回下一应启动岗位 + 进入条件是否满足 | `{role, ready, blockedBy}` |
| `/ec gate <G1\|G2\|G3> [evidence]` | 触发门确认（G1/G2 需人确认上下文，G3 需 evidence） | 成功/失败 + code |
| `/ec metrics [limit]` | 回看 GATE-LOG | bounded 记录列表 |
| `/ec memory <init\|write\|query> …` | 转发 memory 能力（与工具同语义） | 路径指针 / excerpt |

- **go-no-go**：不在 `/ec` 里由 agent 拍板；走 `shell.overlay` 确认卡 → `ctx.remote` → 用户动作专属命令（ADR §6.1、user-actions.md）。
- **命令定义真实字段**（`CommandDefinition` 的 name/description/handler 形状）`[待实测]` → OQ-6。

---

## 7. Client slot 注册清单（全部 `replaceRisk:none` `[交接]`）

> `[实测纠正]` client 半**不是独立 plugin row**：由 `package.json` 的 `dsh.client:{platform:'web',immediately:true,inject:[...]}` 自动挂载 exports `"./client"`（`client.js` 内 `window.__ModuleLoader__.load` 注册 slots）。证据：dsh-ssh/dsh-meme 均为单 host row + dsh.client 声明。

| slotKey | 类型 | 注册内容 | 触发/用途 | 说明 |
|---|---|---|---|---|
| `main` | keyed（可做全页面板） | `EcPanel` 主面板 | 阶段进度条 / 三门状态 / PLAN 看板 / subagent 岗位树 | 注册用 `ctx.slots.inject('main', () => ctx.slots.register({name:'main', id:'engineering-craft', order, ...}, EcPanel))`；keyed 的 `key`/props `[待实测]` → OQ-7 |
| `conversation.session.header.actions` | list | 「工程面板」入口按钮 | 点开 main 面板 | list slot，order 控制位置 |
| `shell.overlay` | list | `EcConfirmCard` 确认卡 | **仅** G1/G2 人确认、go-no-go 需要人拍板时 | 携带证据摘要 + 确认/退回；用户动作经 `ctx.remote` 回 Host；不可常驻 |
| `conversation.composer.dock` | list | 预留（本期不注册） | 轻量状态条备选 | 仅当 main panel 方案被否时启用（ADR §12 Q4），本期不注册以免占空间 |

- 一律 `ctx.slots.inject(ownerKey, () => ctx.slots.register({name, id, order, ...}, Component))`；factory 无副作用，资源在 `apply` 内注册并清理 `[实测模板]`。
- React 从 `require('react')` 取，禁止自带 / CDN / UMD `[实测模板]`。
- 样式只用 theme token（`--dsw-alias-*`）；文本走 Client locale（en + zh）；详情 `docs/DETAIL.md` + `meta.title/description` `[实测 host-plugin.md]`。
- 不读他人 DOM/样式、不 `require('@deepseek-ai/dsh-client-ui-primitives')`、不改 app root / 不 append body `[实测 practices.md]`。

---

## 8. 六岗位交接物文件名与字段（交接只传路径指针）

> 文件名遵循 `.project_memory/conventions/naming.md`：全大写。字段是"必须存在的最小结构"，由 `ec_artifact validate` 校验；正文由各岗位写，本契约只定 schema。路径指针 = `<projectRoot>/<path>`，`projectRoot` 由 workingDirectory 解析。

| 岗位（subagent 名） | 交接物文件 | 必含字段（顶层键） | 准出 |
|---|---|---|---|
| `ec-product` | `PRD.md` | `目标` / `用户与场景` / `用户故事` / `优先级` / `验收标准(可判定)` / `开放问题` | 人确认 G1 |
| `ec-architect` | `ADR.md` | `状态` / `目标与非目标` / `总体架构` / `模块清单` / `数据模型` / `风险与取舍` / `待拍板` | 人确认 G2 |
| `ec-architect` | `CONTRACT.md`（本文件） | `模块边界` / `公开 API 签名` / `数据流` / `错误语义` / `Config schema` / `EcState JSON` / `工具约定` / `子命令` / `slot 清单` / `交接物字段` | 人确认 G2 |
| `ec-developer` | `PLAN.md` | 每单元 `{id, target, ownerFiles, acceptance, status}`；文件所有权不重叠 | 窄检通过 G3 |
| `ec-tester` | `TEST-REPORT.md` | `测试代码指针` / `覆盖率` / `边界异常` / `真实输出` / `证据分级(实测/推断/猜测)` | 全绿 |
| `ec-reviewer` | `BRIEF.md` + `FINDINGS.md` | Brief：变更摘要 / 风险 / 验证结论；Findings：`{id, severity, file:line, issue, fix}`；`VERDICT: APPROVE`（4 轮封顶） | VERDICT APPROVE |
| `ec-ops` | `RELEASE.md` | `发布清单` / `回滚预案` / `观察项` / `go/no-go(人)` | 人 go/no-go |

**岗位顺序与门**（`EcState.pipeline` 与 `EcState.artifacts` 同步）：

```
ec-product → ec-architect → ec-developer → ec-tester → ec-reviewer → ec-ops
   G0输入      G1过            G2过            G3过       测试全绿      APPROVE
```
下游仅在上游交接物文件存在且 lead 确认后启动；`ec_stage(mode:'next-role')` 按 `nextRole()` 返回；交接只传路径字符串；子 agent 自述不作证据，lead 集成重验（ADR §6.1）。

---

## 9. `EcState` JSON 结构（投影状态，`stateVersion:1`）

> 基于 ADR §4.1，字段冻结；新增字段须升 `stateVersion` 并给迁移说明（practices.md §Performance）。纯 JSON、可 checkpoint。

```jsonc
{
  "version": 1,
  "projectRoot": "E:/path/to/project | null",  // workingDirectory.service 解析；[待实测] OQ-5
  "stage": "requirements",                     // requirements|design|coding|testing|review|delivery|release
  "gates": {
    "G1": { "passed": false, "confirmedBy": "user",  "at": null, "evidence": null },
    "G2": { "passed": false, "confirmedBy": "user",  "at": null, "evidence": null },
    "G3": { "passed": false, "confirmedBy": "agent", "at": null, "evidence": null }
  },
  "artifacts": {                               // 交接物路径指针，null=未落盘
    "prd": null, "adr": null, "contract": null,
    "plan": null, "brief": null, "release": null,
    "testReport": null, "findings": null       // 扩展：TEST-REPORT.md / FINDINGS.md
  },
  "plan": [
    { "id": "P1", "target": "状态核心", "ownerFiles": ["rules.js"],
      "acceptance": "单测全绿", "status": "todo" }   // todo|doing|done
  ],
  "pipeline": {
    "role": null,                              // product|architect|developer|tester|reviewer|ops|null
    "status": "pending",                       // pending|active|done|blocked
    "handoffs": {                              // 岗位→交接物路径指针
      "product": null, "architect": null, "developer": null,
      "tester": null, "reviewer": null, "ops": null
    }
  },
  "metrics": { "lastGate": null, "blockCount": 0 }, // 轻量摘要；全量在 GATE-LOG（OQ-3）
  "updatedAt": 0                               // epoch ms
}
```

- `confirmedBy` 约束：G1/G2/go-no-go 恒 `user`；G3 恒 `agent`。任何反过来写都判 `CONFIG_INVALID`/`NOT_USER_CONFIRMED`。
- `view(state)` 返回的 Client 视图是本结构的只读子集（去掉内部 `metrics.blockCount` 明细等），值不变返回同引用。

---

## 10. 交接摘要（给下游研发岗）

- **先读本文 + PRD/ADR/PLAN + `.project_memory/`** 再动手；G2 已过但实施仍受阶段门约束（P0 骨架 → P1 状态核心 …）。
- **先解决 `open-questions.md` 中仍标 `[待实测]` 的项**（sessionProjections.wire.view、storage domain、slot props、ctx.remote 路径、workingDirectory 解析）再写对应模块；不得猜 API。OQ-2/OQ-4/OQ-9 已由实测澄清（见 §2.3/§4.2/§1 与 open-questions「已实测澄清」区）：工具用 `defineTool({name,description,parameters,output,execute})` 且容错加载、Config 用 schemastery `z.object` + `.extra('volatile',true)`、打包为单 host row + `dsh.client` 声明。
- **每个公开导出保留本文 TSDoc**；`rules.js` 保持纯函数、先红后绿单测（`node:test`）。
- **本契约不改 ADR/PRD/PLAN**（上游交接物）；有冲突回架构岗。
