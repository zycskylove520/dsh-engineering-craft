# CONTRACT · engineering-craft DSH 工程流程套件（接口契约 · G2 架构交接物）

> ⚠️ **废弃早期设计提示（2026-11-24 标注）**：本文 **§1 的「4 row」模块边界**、**§2/§3 的 SessionProjection / wire.view / ctx.remote 相关 API 写法**、§3 数据流中的投影状态图，均为**已废弃的早期设计**，仅作历史原文保留，不代表当前实现。当前落地形态见 §0 与文内 `[实测纠正]` 条：单 host row + `dsh.client` 声明、state.json 落盘 + Host↔Client `ctx.webServer`/`fetch()`。阅读与实现以 `[实测纠正]` 标记及变更记录为准，勿按 §1/§2/§3 的早期写法施工。
>
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

单 bundle `@local/dsh-engineering-craft`，**一个 host plugin row + package.json 的 `dsh.client` 声明挂载 client 半** `[实测纠正]`（原"4 row ecGate/ecTools/ecPanel/ecCommand"是早期假设，被实测推翻；证据 dsh-windows-mcp `cordis.patch.yml`、dsh-ssh/dsh-meme patch）。

- `cordis.patch.yml` 只插一行：`id: '@local/dsh-engineering-craft'`, `name: '@local/dsh-engineering-craft'`（= 包名；loader import 该包的 exports `"."`，即 `index.js`）。**row id 定为包名本身**，使 loader entry id 与 Config namespace 一致（bili 教训：export Config 时两者必须相等，见 §4.2）。
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
 *   形态 A 为默认单岗位形状；形态 B 额外带 roles/units/mode。blockedBy 为缺失交接物键
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
 * 【2026-11-24 注】本段为已废弃的早期投影设计（见文首废弃提示）；当前 stateVersion=2，投影已由 state.json+webServer 取代。
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
   * @returns {Result<EcState, EcError>} 路径须落在 projectRoot 标签内（防 .. 穿越），否则 error.code=PATH_OUT_OF_ROOT
   */
  update(session, patch) { /* 留白 */ }

  /**
   * 返回当前应启动的岗位（封装 rules.nextRole；形态 A 单岗位 / 形态 B 研发岗多单元）。
   * @param {string} projectRoot 项目根（架构收敛后不再传 Session）
   * @param {{capabilities?:{subagent?:boolean}, thresholds?:{minFilesForParallel?:number}}} [opts]
   * @returns {{role: EcRole}|{role:null, blockedBy:string}|{role:'developer', roles:string[], mode:'B', units:Array<{id:string,ownerFiles:string[]}>}}
   */
  nextRole(projectRoot, opts = {}) { /* 留白 */ }

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
  id: '@local/dsh-engineering-craft',
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
【2026-11-24 注】此数据流是已废弃的早期投影设计（见文首废弃提示）；当前为 state.json（version 2）+ webServer/fetch。
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
 *   'PATH_OUT_OF_ROOT'      // 路径越出 projectRoot 标签（防 .. 穿越；不再是宿主白名单校验）
 *   'ARTIFACT_SCHEMA_FAIL'  // 交接物结构校验失败（details.artifact / missingFields）
 *   'ARTIFACT_OUTSIDE_TMP'  // ec_artifact 的 path 不在 .project_memory/tmp/ 内（强制 tmp；details.path）
 *   'CONFIG_INVALID'        // Config 违约（不可恢复，throw）
 *   'STORAGE_UNAVAILABLE'   // storage service/profile 不可用
 */
```

错误呈现 `[实测纠正]`：工具 `execute` 返回普通对象，失败为 `{ok:false, error:{code, details}}`（经默认 textOutput 渲染成文本；不是 `isError:true` 的 ToolResult）；命令返回结构化 status + reason；Client 确认卡显示失败原因、不谎称已保存（configuration.md）。

### 4.2 Config schema（门规则 + 收益阈值；用户 patch 可调）

`[实测纠正]` Config 真实写法（证据：dsh-bili-scroll `index.js` L46–54 + `lib/hostdeps.mjs`）：

- `export const Config = z.object({...})`，`z` 来自 schemastery（optional peer）；schemastery 彻底取不到时 `Config = undefined`，**插件照常加载，只是设置页降级**。
- **每个要被设置页写的字段必须 `.extra('volatile', true)`**：DSH 的 settings 层只认 volatile 字段（`volatileForm(schema)`），否则写设置抛 "has no volatile fields"。
- **loader entry id 必须等于 namespace 名**（row id 即包名 ` '@local/dsh-engineering-craft'`，见 §1）+ 本模块导出 `Config`，三者齐备设置页才可写。
- schema 校验范围要宽松：范围约束（如阈值上下限）放在**写/读时钳制**，不要写成 `.min()/.max()` 等硬校验——校验不过会让 cordis 拒收 entry ⇒ 整条插件不激活（bili `commentPerRound` 的教训）。

默认值来自 ADR §4.2；`minFilesForParallel` 是**形态 B 的收益门**（语义为**最小并行单元数**，见 ADR-PARALLEL §取舍与风险；默认 2）。**Config 只保留 `gates` 与 `thresholds.minFilesForParallel` 两项**；两个死配置 `paths.memoryDirName/artifactsRoot` 与 `minUnitsForWorkflow` 已删除（墓碑式说明，不出现在 schema 中）。本套件默认多 agent，无 single/workflow 路由；只有一个不可分单元时单岗位顺序执行亦合规（非失败）。

```js
/**
 * 插件 Config（用户可在设置页改；schemastery 缺失时为 undefined，插件照常加载）。[实测纠正]
 * 门规则驱动 rules.checkGate；判定纯函数，工具/面板/命令共用同一份。
 * 字段：gates 阶段门规则表 / thresholds.minFilesForParallel 并行三判据的收益阈值（最小并行单元数，默认 2）。
 * 已删除：paths.memoryDirName/artifactsRoot、minUnitsForWorkflow（死配置）。
 * 每个字段 .extra('volatile', true) 才能被设置页写。
 */
export const Config = !z ? undefined : z.object({
  // gates: G1/G2/G3 各 {requiredArtifacts, requireUserConfirm, requireEvidence}（默认值见下）
  // thresholds: {minFilesForParallel}
  // ↑ 各字段均在实现时补 .extra('volatile', true)；具体 z 类型（z.object/z.natural/z.string…）由实现定
})
// 默认：
// gates = {
//   G1: { requiredArtifacts:['prd'],             requireUserConfirm:true,  requireEvidence:false },
//   G2: { requiredArtifacts:['adr','contract'],  requireUserConfirm:true,  requireEvidence:false },
//   G3: { requiredArtifacts:[],                  requireUserConfirm:false, requireEvidence:true  },
// }
// thresholds = { minFilesForParallel: 2 }
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
             "description":"query=只读状态；confirm-gate=记录人确认/证据；next-role=返回下一岗位或形态B多单元"},
    "gate": {"type":"string","enum":["G1","G2","G3"],"description":"confirm-gate 时必填"},
    "evidence": {"type":"string","description":"G3 confirm-gate 时必填：命令+输出摘要（非全文）"},
    "projectRoot": {"type":"string","description":"项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性/白名单校验，缺省用进程 cwd；空标签返回 INVALID_INPUT"},
    "capabilities": {"type":"object","properties":{"subagent":{"type":"boolean"}},"additionalProperties":false,"description":"形态B能力门，默认开启"},
    "thresholds": {"type":"object","properties":{"minFilesForParallel":{"type":"integer"}},"additionalProperties":false,"description":"形态B收益门，最小并行单元数，默认2"}
  },
  "required": ["mode"], "additionalProperties": false
}
```
- **execute 返回**（默认 textOutput 渲染）：`{ok:true, stage, gates, gateResults, nextRole, mode, parallelRoles, missingArtifacts, blockedBy}` 普通对象（形态 A 的 `parallelRoles` 为空数组）；拒绝时 `{ok:false, error:{code:'INVALID_INPUT'|'NOT_USER_CONFIRMED'|'MISSING_ARTIFACT'|'NO_EVIDENCE'|'STORAGE_UNAVAILABLE', details}}`（不是 `isError:true` 的 ToolResult；空 projectRoot 归 `INVALID_INPUT`，`PATH_OUT_OF_ROOT` 在本工具不再产生）。`confirm-gate` 的 G1/G2 只接受"用户已在本轮确认"的上下文标记，agent 不得自报确认（ADR-003）。形态 B 三道门见 ADR-PARALLEL.md。

### 5.2 `ec_artifact`

- **description**：`按交接物类型生成模板文件（绝对路径指针）或校验已有交接物结构，不写正文以外的文件。`
- **parameters**（标准 JSON Schema object）：
```json
{
  "type": "object",
  "properties": {
    "action": {"type":"string","enum":["create","validate"],"description":"create=写模板；validate=只读校验"},
    "kind": {"type":"string","enum":["prd","adr","contract","plan","brief","release","testReport","findings","progress"]},
    "path": {"type":"string","description":"目标路径（省略则默认落 .project_memory/tmp/<文件名>）；必须落在 .project_memory/tmp/ 内，越界（含落项目根等其他位置）返回 ARTIFACT_OUTSIDE_TMP（不再是可选择覆盖）"}
  },
  "required": ["action","kind"], "additionalProperties": false
}
```
- **execute 返回**：`{ok:true, kind, path, status:'created'|'exists'|'valid'|'invalid', missingFields:string[]}` 普通对象；失败 `{ok:false, error:{code:'ARTIFACT_SCHEMA_FAIL'|'ARTIFACT_OUTSIDE_TMP', details}}`。**路径指针**是唯一返回值，不回传正文。`path` **只能落在 `.project_memory/tmp/` 内**（省略默认 `.project_memory/tmp/<文件名>`），传项目根等其他位置返回 `ARTIFACT_OUTSIDE_TMP`（不再是"可选覆盖"）。`progress` 类型生成 `PROGRESS.md`，必含五节 `Goal` / `Done` / `Next` / `Open questions` / `Key facts`。PLAN.md 模板含「检索套用约束」节与 `constraints` 字段（写码前 recall 命中的记忆条目 id 列此）。

### 5.3 `ec_memory`

- **description**：`初始化或按 INDEX 线索读写 .project_memory/ 工程记忆（6 职责目录+3 根文件+tmp）；recall=写码前检索套用，命中条目 id 列入 PLAN constraints。`
- **骨架与所有权**：`init` 建 **6 个标准职责目录**（architecture / conventions / api-contracts / data-model / testing / build，build 独立于 architecture）+ **3 个根文件**（INDEX.md / status.md / open-questions.md）+ **tmp/** 执行产物区，全部建好、内容可薄但不缺位。目录所有权用 `.project_memory/` 内的空文件 `.engineering-craft` 标记：**无标记的已存在目录拒绝写入并降级到 `.project_memory_engineer/`**；旧 `.engineering-craft-marker` 已删除。说明：`.engineering-craft` 按 skill 定义是**记忆目录内的空文件 marker**，只作所有权标记，不再兼作状态目录名；插件状态目录已改名为 `<projectRoot>/.ec-state/`（state.json；无兼容：旧路径数据不读取、不迁移，版本不是 2 报 `STORAGE_UNAVAILABLE`），名字冲突已消除。GATE-LOG 落 `<projectRoot>/.project_memory/tmp/GATE-LOG.md`（对齐 skill `core/gate-metrics.md` 六字段，每行一条 JSON；无兼容：旧 `.engineering-craft/gate-log.jsonl` 不再读取合并）。
- **五件套校验（写规范一律强制）**：每条陈述须为 `[KIND ID]`（RULE/FACT/DECISION/OPEN 四选一 + 稳定 id）+ 陈述正文 + `证据:` 行（文件路径 + 模式描述）+ `记录: YYYY-MM-DD · 实测|推断|用户约定`；**证据与记录必须在独立行**（行首正则校验，仅"包含"不算）。硬约束：禁本机绝对路径；事实等级与核实状态（待复核/已复核）正交分列；证据行号仅辅助。写入无 `strict` 参数，一律强制五件套，不退回旧的「来源+日期」校验。
  - **`normalizeMemoryContent`（写入口自动分条，2026-11-24 实测修复）**：LLM 调 `ec_memory write` 时常把五件套挤成单行（`[KIND ID] 正文。证据: X。记录: Y` 全在一行——TinyTrain 建库 150 条全如此）。写入口在校验前统一把这种单行拆成三行（header / `  证据:` / `  记录:`），再校验；幂等（已是多行的不动），非陈述行（标题/引用/`状态:` 等）原样保留；结果带 `normalized:true` 标记。返回值与落盘内容都是分条后的版本。
- **recall（检索套用闭环）**：写业务/核心代码前按线索检索全规范层，返回命中条目的 id/kind/file，供 agent 把 id 列入 `.project_memory/tmp/PLAN.md` 的 constraints；**每个并行单元各自检索，无命中标「无既有约定」**。
- **parameters**（标准 JSON Schema object）：
```json
{
  "type": "object",
  "properties": {
    "action": {"type":"string","enum":["init","write","query","recall"],"description":"init=建骨架（6目录+3根文件+标记+tmp）；write=写规范（默认五件套校验）；query=按需读；recall=检索套用（返回 id/kind 供 PLAN.constraints）"},
    "projectRoot": {"type":"string","description":"项目根路径标签（本机或远端均可，如 /remote/path/to/Project）；不做存在性校验，缺省用当前工作目录"},
    "layer": {"type":"string",
              "enum":["index","status","open-questions","architecture","conventions","api-contracts","data-model","testing","build","tmp"],
              "description":"write/query 的目标层：根文件别名或职责目录（无 project 层）"},
    "file": {"type":"string","description":"职责目录内的文件名（如 architecture/engine.md 的 engine，省略默认 overview）"},
    "content": {"type":"string","description":"write 时正文；默认须合五件套（[KIND ID] + 陈述 + 证据: + 记录: 日期·等级）"},
    "query": {"type":"string","description":"query/recall 的检索线索（recall 会全规范层扫描，返回命中 id/kind）"}
  },
  "required": ["action"], "additionalProperties": false
}
```
- **execute 返回**：`{ok:true, action, path, excerpt?, status}` 普通对象；`recall` 额外返回 `{hits:[{id,kind,file}], filesScanned}`（bounded，最多 30 条）；`init` 冲突目录名冲突时用 `.project_memory_engineer/` 并打标记；违反"只写规范层"或五件套校验失败返回 `{ok:false, error:{code:'INVALID_INPUT', details}}`。

### 5.4 `ec_gate_metrics`

- **description**：`记录或回看 GATE-LOG 门度量（每次门拦截/放行的原因与指针），用于反复拦截时回写规范。`
- **落点与 schema**：GATE-LOG 落 `<projectRoot>/.project_memory/tmp/GATE-LOG.md`，**每行一条 JSON**，对齐 skill `core/gate-metrics.md` **六字段**：日期(date) / 阶段(stage) / 门(gate) / 结果(outcome：`拦住`|`通过`|`绕过`) / 缺什么(missing) / 处置(disposition)。无兼容：旧 `.engineering-craft/gate-log.jsonl` 不再读取合并。
- **parameters**（标准 JSON Schema object）：
```json
{
  "type": "object",
  "properties": {
    "action": {"type":"string","enum":["record","list"],"default":"list"},
    "gate": {"type":"string","enum":["G1","G2","G3"],"description":"record 时必填"},
    "outcome": {"type":"string","enum":["拦住","通过","绕过"],"description":"record 时必填；只接受中文三值（等价于六字段的『结果』），英文 blocked/passed 不识别"},
    "stage": {"type":"string","description":"record 时：阶段（六字段之『阶段』）"},
    "missing": {"type":"string","description":"record 时：缺什么（六字段之『缺什么』）"},
    "disposition": {"type":"string","description":"record 时：处置（六字段之『处置』）"},
    "limit": {"type":"integer","minimum":1,"maximum":100,"default":20,"description":"list 时最多返回条数"}
  },
  "required": ["action"], "additionalProperties": false
}
```
- **execute 返回**：`{ok:true, records: GateMetric[], truncated:boolean}` 普通对象；每条对齐且仅含六字段 `{date, stage, gate, outcome, missing, disposition}`（无 `reason`/`at`/`evidencePath`/`result` 兼容字段）；`outcome` 只取中文 `拦住`/`通过`/`绕过`；bounded，不倾倒全量日志（tool-design.md）。存储载体 `.project_memory/tmp/GATE-LOG.md`（无兼容：旧 `.engineering-craft/gate-log.jsonl` 不读取合并不写盘）。

---

## 6. `/ec` 子命令（`ctx.commands.register`）

- **命令名**：`/ec`；`description`：工程套件统一入口。
- 子命令（`line` 形如 `/ec status`）：

| 子命令 | 作用 | 输出 |
|---|---|---|
| `/ec status` | 显示当前阶段 / 三门状态 / 在岗岗位 | 简表 + 缺失交接物指针 |
| `/ec next` | 返回下一应启动岗位（形态 A 单岗位 / 形态 B 研发岗多单元） | `{role, ready, blockedBy, mode?, parallelRoles}` |
| `/ec gate <G1\|G2\|G3> [evidence]` | 触发门确认（G1/G2 需人确认上下文，G3 需 evidence） | 成功/失败 + code |
| `/ec metrics [limit]` | 回看 GATE-LOG | bounded 记录列表 |
| `/ec memory <init\|write\|query\|recall> …` | 转发 memory 能力（与工具同语义；`recall <线索>` 检索套用，`--file=` 对应 file；无 `--loose`/strict 开关，写入一律强制五件套） | 路径指针 / excerpt / recall hits |

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

> 文件名遵循 `.project_memory/conventions/naming.md`：全大写。字段是"必须存在的最小结构"，由 `ec_artifact validate` 校验；正文由各岗位写，本契约只定 schema。路径指针 = `<projectRoot>/<path>`，`projectRoot` 由 workingDirectory 解析。`ec_artifact` 的 `path` 参数省略时默认落 `.project_memory/tmp/<文件名>`；**传 path 时必须落在 `.project_memory/tmp/` 内**，落项目根等其他位置返回 `ARTIFACT_OUTSIDE_TMP`（见 §4.1/§5.2）；`progress` 类型为长任务接力交接物（PROGRESS.md，五节 Goal/Done/Next/Open questions/Key facts）。

| 岗位（subagent 名） | 交接物文件 | 必含字段（顶层键） | 准出 |
|---|---|---|---|
| `ec-product` | `PRD.md` | `目标` / `用户与场景` / `用户故事` / `优先级` / `验收标准(可判定)` / `开放问题` | 人确认 G1 |
| `ec-architect` | `ADR.md` | `状态` / `目标与非目标` / `总体架构` / `模块清单` / `数据模型` / `风险与取舍` / `待拍板` | 人确认 G2 |
| `ec-architect` | `CONTRACT.md`（本文件） | `模块边界` / `公开 API 签名` / `数据流` / `错误语义` / `Config schema` / `EcState JSON` / `工具约定` / `子命令` / `slot 清单` / `交接物字段` | 人确认 G2 |
| `ec-developer` | `PLAN.md` | 每单元 `{id, target, ownerFiles, acceptance, status, constraints}`；文件所有权不重叠；模板含「检索套用约束」节（`constraints` = 写码前 recall 命中的记忆条目 id，无命中标「无既有约定」） | 窄检通过 G3 |
| `ec-developer` | `PROGRESS.md`（`progress`） | 五节 `Goal` / `Done` / `Next` / `Open questions` / `Key facts`；长任务接力用，默认落 `.project_memory/tmp/PROGRESS.md` | 长任务接力/交接 |
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

## 9. `EcState` JSON 结构（state.json 文件状态，`stateVersion:2`）
> `[已废弃]` 旧称"投影状态"属 §1/§2 早期设计；当前为 `.ec-state/state.json` 文件落盘 + webServer/fetch。

> 基于 ADR §4.1，字段冻结；新增字段须升 `stateVersion`（practices.md §Performance）。纯 JSON、可 checkpoint。
> **v2 变更（2026-11-24）**：新增 `progress` 交接物键（artifacts 共 9 键）、`releaseDecision`（初值 null）、PLAN 单元支持 `constraints` 字段。**无兼容：不识别 v1、不做迁移；只有 version=2 可用，版本不是 2 直接报 `STORAGE_UNAVAILABLE`**。

```jsonc
{
  "version": 2,
  "projectRoot": "E:/path/to/project | null",  // workingDirectory.service 解析；[待实测] OQ-5
  "stage": "requirements",                     // requirements|design|coding|testing|review|delivery|release
  "gates": {
    "G1": { "passed": false, "confirmedBy": "user",  "at": null, "evidence": null },
    "G2": { "passed": false, "confirmedBy": "user",  "at": null, "evidence": null },
    "G3": { "passed": false, "confirmedBy": "agent", "at": null, "evidence": null }
  },
  "artifacts": {                               // 交接物路径指针，null=未落盘（9 键）
    "prd": null, "adr": null, "contract": null,
    "plan": null, "brief": null, "release": null,
    "testReport": null, "findings": null,      // 扩展：TEST-REPORT.md / FINDINGS.md
    "progress": null                           // v2 新增：PROGRESS.md 长任务接力交接物
  },
  "releaseDecision": null,                     // v2 新增：go/no-go 决策，初值 null
  "plan": [
    { "id": "P1", "target": "状态核心", "ownerFiles": ["rules.js"],
      "acceptance": "单测全绿", "status": "todo",  // todo|doing|done
      "constraints": ["R-SVC-01"] }               // v2 新增：recall 命中的记忆条目 id
  ],
  "pipeline": {
    "role": null,                              // product|architect|developer|tester|reviewer|ops|null
    "status": "pending",                       // pending|active|done|blocked
    "handoffs": {                              // 岗位→交接物路径指针
      "product": null, "architect": null, "developer": null,
      "tester": null, "reviewer": null, "ops": null
    }
  },
  "metrics": { "lastGate": null, "blockCount": 0 }, // 轻量摘要；全量在 .project_memory/tmp/GATE-LOG.md（无兼容：旧 .engineering-craft/gate-log.jsonl 不读取合并）
  "updatedAt": 0                               // epoch ms
}
```

- `confirmedBy` 约束：G1/G2/go-no-go 恒 `user`；G3 恒 `agent`。任何反过来写都判 `CONFIG_INVALID`/`NOT_USER_CONFIRMED`。
- `[已废弃]` `view(state)` / 同引用抑制属 §1/§2 早期投影设计；当前 Client 经 `GET /api/engineering-craft/state` 拿 state.json 的只读子集。

---

## 10. 交接摘要（给下游研发岗）

- **先读本文 + PRD/ADR/PLAN + `.project_memory/`** 再动手；G2 已过但实施仍受阶段门约束（P0 骨架 → P1 状态核心 …）。
- `[已废弃]` 早期"先解决 sessionProjections.wire.view / ctx.remote 等 `[待实测]` 项再施工"已不适用——这些问题已由 state.json + `ctx.webServer`/`fetch()` 方案取代（ADR §10.5）；仅 storage domain / slot props / workingDirectory 仍按 open-questions 现状处理，不得猜 API。OQ-2/OQ-4/OQ-9 已由实测澄清（见 §2.3/§4.2/§1 与 open-questions「已实测澄清」区）：工具用 `defineTool({name,description,parameters,output,execute})` 且容错加载、Config 用 schemastery `z.object` + `.extra('volatile',true)`、打包为单 host row + `dsh.client` 声明。
- **每个公开导出保留本文 TSDoc**；`rules.js` 保持纯函数、先红后绿单测（`node:test`）。
- **本契约不改 ADR/PRD/PLAN**（上游交接物）；有冲突回架构岗。

---

## 11. 变更记录

- **2026-11-23 · projectRoot 语义从「宿主白名单路径」改为「用户声明的文本标签」**（主人定，支持远程工程）：
  - `resolveAllowedRoot()` 由「校验是否落在 `EC_ALLOWED_ROOTS`/cwd/tmpdir/工作区白名单内」改为「纯文本标签规范化」——绝对路径标签（含 POSIX `/` 开头与 Windows 盘符）原样保留，只有空/非字符串返回 null（错误码由 `PATH_OUT_OF_ROOT` 改为 `INVALID_INPUT`）。
  - 新增 `ec-path.js`：POSIX 风格标签走 `node:path/posix`，其余走平台原生模块；保证远端标签 `/remote/...` 在 Windows 宿主上不被改写成盘符路径。所有路径 join/dirname/resolve/isAbsolute 改用该助手（gate-service / artifacts / memory / metrics）。
  - **解耦边界**：插件不再判断工程在哪、是否存在、是不是远程——由用户/宿主记忆与 SSH 工具负责；状态仍落 `<projectRoot>/.engineering-craft/`、记忆落 `<projectRoot>/.project_memory/`（远端标签需该路径在宿主可写或由用户同步）。
  - `safePathWithin` 的 `PATH_OUT_OF_ROOT` 语义保留，但仅指「交接物路径越出 projectRoot 标签」的防 `..` 穿越，不再是宿主白名单。
  - 测试：`boundary.test.js` 重写允许根用例为标签语义，新增远端 POSIX 标签原样保留 / statePathOf 落在标签目录等断言；全套 80/80 绿。

- **2026-11-23（同日）· 改动后全面审查的修复**（4 只读审查 agent 并行 + lead 逐条核实原文，不采信自述）：
  - **安全 BUG（2 agent 独立实证）**：POSIX 标签 + Windows 宿主下 `safePathWithin` 用 posix 语义校验，`..\evil.md` 的 `..` 不被折叠而放行，但 fs 落盘按 win32 解析到根外（实测写到 `D:\evil.md`）。修复：containment 校验一律用 `nativePath`（宿主 fs 语义）折叠 `..` 与 `\` 后判断，返回值仍按标签形态构造（远端标签原样保留）。新增 `ec-path.js` 导出 `nativePath` 专供安全校验。
  - **功能 BUG**：`projectRoot` 为文件系统根（`/` 或 `C:\`）时 `r + sep` 产生 `//` 双分隔符，拒绝所有合法子路径。修复：前缀按 `endsWith(sep)` 去尾。
  - **隐私漏网**：上一轮脱敏只扫正斜杠形态，遗漏反斜杠形态的内部路径示例（`ec-path.js`、`CONTRACT §11` 两处）——已全库清除，隐私复扫零命中。
  - **一致性**：ec_memory/ec_gate_metrics 的能力层空标签码 `PATH_OUT_OF_ROOT` → `INVALID_INPUT`，ec_artifact 补空标签检查；HTTP `/state` 缺参不再静默回落 host cwd（改为 400）；CONTRACT §5.1/§5.3 schema、错误码枚举、§2.2 update 注释同步；4 源码顶部"白名单"过时注释清理；UNC `//` 标签不再被 posix 折叠。
  - **验证**：新增 8 条安全回归测试（反斜杠穿越 / 根路径 / 跨 scheme / 空标签 / UNC / 标签形态保留），全套 **88/88 绿**；端到端 6 入口 ok=true、反斜杠穿越经真实工具层返回 `PATH_OUT_OF_ROOT`、空标签返回 `INVALID_INPUT`。

- **2026-11-24 · 对齐 engineering-craft skill「工程记忆系统定稿」**（不重写上文历史，仅追加）：
   - `memory.js` 骨架 = 6 职责目录 + 3 根文件 + tmp；所有权标记改为 `.project_memory/` 内空文件 `.engineering-craft`，无标记目录拒写降级 `.project_memory_engineer/`；旧 `.engineering-craft-marker` 删除（与项目根同名 `.engineering-craft/` 状态目录互不冲突，GATE-LOG 仍原位）。
   - `ec_memory` 新增 `recall` + `file` 参数，layer 枚举扩展；写入一律强制五件套校验，无 `strict`（详见 §5.3）。
   - `ec_artifact` 的 `path` 改可选（默认 `.project_memory/tmp/`），新增 `progress`（PROGRESS.md 五节），PLAN 模板加「检索套用约束」与 `constraints`。
   - `EcState` 升 **version 2**：新增 `progress` 键（artifacts 共 9 键）、`releaseDecision`（null）、PLAN 单元 `constraints`；无兼容：不识别 v1、不迁移，版本不是 2 报 `STORAGE_UNAVAILABLE`（§9）。
   - Config 删除死配置 `paths.memoryDirName/artifactsRoot`、`minUnitsForWorkflow`，只留 `gates` 与 `thresholds.minFilesForParallel`（§4.2）。
   - 措辞统一为「默认多 agent；只有一个不可分单元时单岗位顺序执行亦合规（非失败）」，**无单 agent 降级**（DSH 特化，用户明确要求）。

- **2026-11-24（收尾）· 状态目录改名 / GATE-LOG 移位 / 产物强制 tmp**（lead 已在源码落地、最近一次 116/116 测试通过；不重写上文历史，本节为当前事实，凡上文出现的相关旧描述均以此为准。兼容已彻底移除）：
   - **状态目录改名**：`.engineering-craft/` → **`.ec-state/`**，state.json 新路径 `<projectRoot>/.ec-state/state.json`。原因：`.engineering-craft` 按 skill 定义是**记忆目录内的空文件 marker**，不能同时当状态目录名。**无兼容**：旧 `.engineering-craft/state.json` 不读取、不迁移，没有 `legacyStatePathOf`；版本不是 2 直接报 `STORAGE_UNAVAILABLE`。上文「状态仍落 `.engineering-craft/`」「与项目根同名 `.engineering-craft/` 状态目录互不冲突」等说法已作废——状态目录已改名，名字冲突已消除。
   - **GATE-LOG 移位**：`.engineering-craft/gate-log.jsonl` → **`.project_memory/tmp/GATE-LOG.md`**，对齐 skill `core/gate-metrics.md` 六字段（日期/阶段/门/结果 拦住\|通过\|绕过/缺什么/处置），每行一条 JSON；**无兼容**：旧 gate-log.jsonl 不再读取合并（不 list 并入、不触发写盘）。`ec_gate_metrics` record 新增 `stage`/`missing`/`disposition` 参数，outcome 只接受中文 拦住\|通过\|绕过，英文 blocked/passed 不识别（见 §5.4）。上文「GATE-LOG 仍落 `.engineering-craft/gate-log.jsonl`」「GATE-LOG 仍原位」等说法已作废。
   - **交接物强制 tmp**：`ec_artifact` 的 `path` **只能落在 `.project_memory/tmp/` 内**，传项目根等其他位置返回新错误码 `ARTIFACT_OUTSIDE_TMP`（不再是"可选覆盖"）；不传 path 默认 tmp/（见 §4.1/§5.2）。
