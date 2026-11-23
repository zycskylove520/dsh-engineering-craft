# 待办层 · open-questions（未决问题与待协商的不合理设计）

> 只放未决问题与待协商项；已解决且落规范的不删条目，标"已解决"。
> 每项格式：要查什么契约 / 用什么手段 / 卡住哪个交付物 / 何时必须定。
> 架构岗 2026-11-23 补充：OQ-1..OQ-9（来自 CONTRACT.md 的 `[待实测]` 标记）。

## 已有（上游记录）

- （待 P1 前确认）`ctx.sessionProjections` 与 storage service 的精确契约需 `cordis_inspect_query` 实测；ADR ADR-004 已定方向，实施前核对具体 service 名与 `wire.view` 写法。→ 细化为 OQ-1 / OQ-3。
- （待 P4 确认）`main` keyed slot 的 registration options / props 需 `Slots.listSubTree({root:'main'})` 实测后再写面板。→ 细化为 OQ-7。

## 架构岗新增：实施前仍需实测确认

- **OQ-1（P1 必须）· `sessionProjections.register` 的 definition 完整字段与 `wire.view` 写法**
  要查：`ProjectionDefinition` 的 `key/apply/view/wire/stateVersion` 精确类型；`wire` 是把哪个/哪些 view 暴露给 Client slot props 的映射（key 命名、返回值形态）；`ProjectionHandle.stateOf()` 的签名与 disposer 形状。
  手段：`cordis_inspect_query(Service, {service:'sessionProjections'})` 拿展开契约（目录签名本轮已见：`register` 两重载 + `snapshot/summaryKeys/checkpoint/...`）；必要时查 `@deepseek-ai/dsh-session` 包 `*.d.ts`。
  卡住：gate-service.js 的投影注册 + CONTRACT §2.2/§3 的 wire 数据流。
  备注：本轮 inspect 工具的 `input` 参数被 harness 层拒（`input must be an object`），Client `Theme.listTokens` 超时；下轮在正常页面/工具状态下重跑。

- **OQ-2（P2 必须）· `ctx.tools.register(definition)` 的 `ToolDefinition` 字段与 inputSchema 类型**
  要查：`name/description/inputSchema/handler` 的真实键名；`inputSchema` 是 JSON Schema、zod 还是 typert key；handler 签名（是否带 `agent/session` 注入、返回 `ToolResult` 的准确形状是 `content:[{type:'text',text}]` 还是别的）；options（`ToolRegistrationOptions`）。
  手段：`cordis_inspect_query(Service, {service:'tools'})` 展开契约 + 看一个已注册的内置工具 schema 作样板。
  卡住：tools.js 四个工具定义、CONTRACT §5 的 schema 记法（本文暂按 JSON Schema draft-07 写，可能是 zod）。

- **OQ-3（P1/P2 必须）· 门状态持久化的 storage service 与 domain spec**
  要查：`ctx.storage.mount(form, facility)` / `ctx.storageDomain.open(spec)` 的可用 `form` 名、`DomainSpec` 字段、按会话读写 API（get/set/patch）；GATE-LOG 落哪个 domain。
  手段：`cordis_inspect_query(Service, {service:'storage'})` 与 `{service:'storageDomain'}` 展开；候选 service key 本轮已从目录确认存在（`storage` / `storageDomain` / `sessionPersistence`）。
  卡住：ADR-004 落地（不 append 新 event type，状态存 storage）、`ec_gate_metrics` 存储载体、CONTRACT §3。

- **OQ-4（P1 必须）· `export const Config` 的声明方式与 schema 书写形式**
  要查：Config 是 zod schema 还是普通对象/JSON Schema；嵌套 `gates` 表如何声明；缺省值如何写；`ctx.fiber.entry` + `configEditor.edit` 保存后是否触发 plugin 重启（`configuration.md`：普通字段重启、`.volatile()` 就地更新）。
  手段：`cordis_inspect_query(Config, {name:'@local/engineering-craft-suite'})` 安装后看投影 schema；对照 host-plugin.md/configuration.md。
  卡住：gate-service.js 构造参数、CONTRACT §4.2 Config schema 的实现写法；收益阈值是否需要 volatile（阈值调整不想重启则声明 volatile）。

- **OQ-5（P1 必须）· `projectRoot` 的解析来源**
  要查：`ctx.workingDirectory.get(session)` 的调用时机与返回（目录签名本轮已见 `get/set/ensure/defaultDirectory`）；session 未设置工作目录时 `ensure(agent)` 的副作用是否可接受；工具 handler 拿 agent/session 的哪个参数来解析。
  手段：`cordis_inspect_query(Service, {service:'workingDirectory'})` 展开。
  卡住：EcState.projectRoot 初值、`ec_memory init` 缺省 projectRoot、路径白名单根。

- **OQ-6（P3 必须）· `ctx.commands.register(definition)` 的 `CommandDefinition` 字段与 `/ec` 解析**
  要查：命令名是否含前导 `/`、子命令参数如何拿到（本轮目录见 `@Remote execute(agent, line, submittedAttachments, signal)`，`line` 是整行）；命令 handler 返回 `CommandExecution` 的形状；`registerFileReceiptResolver` 与本套件是否相关。
  手段：`cordis_inspect_query(Service, {service:'commands'})` 展开。
  卡住：command.js、CONTRACT §6 子命令表。

- **OQ-7（P4 必须）· `main` keyed slot 的 registration options / props 与 `conversation.session.header.actions`、`shell.overlay` 的 list 项形态**
  要查：`main` 的 keyed 参数怎么传（`{name:'main', id, order, ...}` 之外还需什么）、props 是否带 selector hook；三个 slot 的 catalog 与 occupants；wire.view 值如何作为 props 注入（与 OQ-1 联动）。
  手段：`cordis_inspect_query(Slots, {root:'main'})`、同法查另两个 slot（本轮 `input` 被拒 + Client inspect 超时，未拿到）。
  卡住：client.js 注册清单、panel.jsx / confirm.jsx 的 props 契约（CONTRACT §2.4/§7）。

- **OQ-8（P4 必须）· Client 调用 Host 的 `ctx.remote` 具体路径**
  要查：Client 侧从 `require` 能拿到什么（`Builtins.listBuiltins`）；调命令是 `ctx.remote.commands.execute(...)` 还是另有注入；参数序列化（agent 从哪来，Client 无 agent 对象时如何定位会话）。
  手段：`cordis_inspect_query(Builtins, listBuiltins)` + `cordis_inspect_query(Client Service, {service:'commands'})`；对照 user-actions.md「UI action 经 ctx.remote 调 Host 命令」。
  卡住：确认卡/go-no-go 回传（CONTRACT §3/§7）；人确认动作必须保持用户专属，agent 不可代批。

- **OQ-9（P0 必须）· bundle patch 的 4 row 写法与 `inject` 依赖声明**
  要查：`cordis.patch.yml` 里 4 行（ecGate/ecTools/ecPanel/ecCommand）各自 `id/name/config/inject` 的准确 YAML 语法；子路径 plugin（若采用 `./tools` 等）是否可行，还是必须单 package-root row + 一 apply 全注册；`dsh.client.inject` 与 Host `inject` 的书写差异。
  手段：asar `templates/decoration/cordis.patch.yml`（本轮已读，单 row 范例）+ 找一个多 row 的内置 bundle patch 作样板；对照 host-plugin.md。
  卡住：P0 骨架可安装可见（AC1）、ADR §9 的"四 row"是否成立。若实测表明只能 package-root 单 row，回架构岗改 ADR §2/§9（不改上游文件，走变更协商）。

## 已实测澄清（2026-11-23，lead 从已装插件源码核对，研发岗按此写）

> 证据：已安装插件 `dsh-bili-scroll` 的 `index.js`（真实运行中的插件）+ `lib/hostdeps.mjs`。均标 [实测]。

- **OQ-2 已澄清（推翻 CONTRACT 假设）**：工具注册不是裸 `{name,inputSchema,handler}`。
  - 真实写法：`ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`。
  - `defineTool` 来自 `@deepseek-ai/dsh-tools`（**optional peer**，桌面 profile 常没装）⇒ 必须容错加载：宿主树找不到就退回本地等价实现（照抄 hostdeps.mjs 的 `loadHostDeps` 模式），否则整条插件不激活。
  - `parameters` 是**标准 JSON Schema object**（每个 object 必须写 `additionalProperties`，否则 defineTool 校验报错）；不是 zod、不是 `inputSchema`。
  - `execute(args, exec)`：`args` 已校验入参，`exec.signal` 可用于取消；返回普通对象即可（插件里直接 return JSON 对象），不必包成 `{content:[...]}`。
  - `output` 可选：`textOutput`（默认）或自定义 `{schema, format}`；图片走 `{type:'image', attachment}`。
  - 结论：CONTRACT §5 的 `inputSchema/handler/ToolResult` 记法作废，研发岗改用 `defineTool + parameters + execute`。

- **OQ-4 已澄清（推翻 CONTRACT 假设）**：`Config` 不是普通对象/JSON Schema，是 **schemastery** `z.object({...})`，每个要被设置页写的字段加 `.extra('volatile', true)`；`export const Config = z.object(...)`。
  - `z` 同样来自宿主树容错加载（`schemastery`，optional peer）；拿不到就 `Config = undefined`，插件照常加载、设置页降级。
  - loader entry id 必须等于 namespace 名才能写设置（本次 patch row id 注意）。
  - 结论：gate 规则 Config 用 `z.object({ gates: z.object(...), thresholds: z.object(...), paths: z.object(...) })`，字段 `.extra('volatile', true)`（若需设置页改）。

- **OQ-9 已澄清（P0）**：`declareTool` 那套依赖容错加载；本套件 package.json 把 `@deepseek-ai/dsh-tools`/`@deepseek-ai/schemastery` 列为 optionalDependencies 或直接用本地等价兜底，避免桌面 profile 不装 peer 导致不激活。patch 4 row 写法仍待安装实测验证（多 row 是否可行）。

## 架构收敛（2026-11-23 lead 决策 · 覆盖 OQ-1/3/7/8，研发岗按此实现）

> cordis_inspect_query 带参在本环境反复被拒（非我能修复），不再依赖未实测 API。全部改用本机已装插件验证过的模式，证据见 open-questions「已实测澄清」区与 ADR §10.5。

- **OQ-1/3 收敛**：门状态不用 SessionProjection/Storage service，改为 `projectRoot/.engineering-craft/state.json`（EcState JSON 落盘）。工具接受 `projectRoot`（默认 cwd，经路径白名单校验），跨会话连续。理由：工程状态本就按项目而非会话；fs API 稳定无需实测。
- **OQ-7/8 收敛**：Client 不依赖 `wire.view` / `ctx.remote`，改为 Host `ctx.webServer.register({kind:'prefix', path:'/api/engineering-craft'})` 暴露状态与动作，Client `fetch()` 读写。证据：dsh-bili-scroll/dsh-meme 在生产用这条路径（含 loopback 校验）。
- **OQ-6**：`/ec` 命令用 `ctx.commands.register`，防御性实现（ctx.commands 存在性检查 + try/catch），失败不阻断插件激活；核心能力在 tools 里，命令是便利层。
- 仍保留：六岗位流水线语义、门纪律、交接物落盘、工程记忆只写规范层——这些是 skill 内核，与承载 API 无关。

## 实机集成验证结果（2026-11-23，lead）— 全绿

- 实机 `plugin_manager install_bundle` → 首次因 cordis 可选 service 访问失败（已修），disable→enable 重新激活后 `fiberPhase: active`、无诊断。
- 四个工具经 `cordis_inspect_query(Tool.listTools)` 确认注册成功（ec_stage/ec_artifact/ec_memory/ec_gate_metrics）。
- 最终 lead 复验：12 文件 node --check OK、`node --test` 61/61 绿、端到端 create prd→confirm G1→stage=design 成功、F-05 handoffs 键空间正确（product/architect 点亮、无 artifact 键泄漏）。
- 5 个 findings（F-01 artifact 指针 / F-02 confirm 返回值 / F-03 G1 确认卡 / F-04 go-no-go 卡 / F-05 handoffs 键）全部修复并经 lead+tester 复验闭环，详见 TEST-REPORT.md。

## 实机集成发现（2026-11-23，lead，历史记录）

- **已解决并复验 · 门状态指针断裂**：实机调 `ec_artifact create prd` 落了 PRD.md，但 `EcState.artifacts.prd` 未登记，`checkGate(G1)` 永远报 MISSING_ARTIFACT，六岗位流水线卡死。根因：artifacts.js 的 artifactAction create 只写文件、没调 EcGate.update 登记指针。研发修复：artifactAction 加可选 `update` 注入（避免 ESM 循环），create/validate 成功幂等登记；gate-service 的 Result.value 从路径字符串改为 EcState 对象；index.js pendingConfirmOf 两处 bug（G1 用 confirmedBy 恒真、go-no-go stage 不可达）一并修。lead 复验：12 文件语法 OK、60/60 测试绿、create prd→confirm G1→stage=design 成功。教训：① 交接物"落盘"与"在状态里登记"是两件事，门判定只认后者；② cordis 门状态里用 `confirmedBy` 常量判断确认与否不可靠，要用时间戳 `at`；③ 确认卡的可见条件必须在决策发生前就成立，别用决策后才出现的状态；④ 这类集成契约必须端到端实测，单测只能各测各的。

- **已解决 · cordis 可选 service 访问**：cordis 的 `ctx.<service>` 对未 inject 的服务是 Proxy getter，直接抛 `cannot get property "X" without inject`，`if (ctx.X)` 防御无效。可选 service 一律用 `ctx.get('X')` 且包在 try 里。证据：首次 install_bundle 的 application:failed 诊断。修复后 set_plugin 重新激活 → fiberPhase: active、四工具注册成功。

## locale 接线（2026-11-23 补做，R-02 已闭环）

- Client i18n 只用 DSH 自带系统插件 `@deepseek-ai/dsh-client-locale`（主人明确要求：不许依赖市场装的第三方插件）。契约实测自 asar 内 `dsh-client-locale/README.zh.md` + `src/client/index.ts`：
  - `ctx.locale.register(ns, {zh, en})` 注册命名空间字典（zh/en 必须齐全），返回 disposer；也支持 `register(ns, locale, dict)` 单语言形式。
  - `ctx.locale.bind(ns)` 返回稳定的 `t(key, params?)`。
  - `LocaleRuntime` 同时是 LocaleFace：`getSnapshot()` 返回稳定引用 snapshot、`subscribe(fn)` 在语言切换/字典注册时通知 → 配 `useSyncExternalStore(subscribe, getSnapshot)` 实现切语言即时重渲染。
  - client 工厂 `inject` 必须列 `locale`；package.json `dsh.client.inject` 加 `@deepseek-ai/dsh-client-locale`。
- 本套件 NS=`@local/engineering-craft-suite`，client.js 内嵌 zh/en 各 26 键字典（与 locale/*.json 对齐），渲染文案全走 t()；hook 无条件调用 + noop fallback 保证 hooks 规则。

## 环境备注（工具层，非契约问题）

- 本轮 `cordis_inspect_query` 带 `input` 参数时被 harness 一律拒为 `input must be an object`（host/client、带/不带参数皆然）；无参数调用正常（Service/Event/Tool 目录已拿到）。下轮在工具层修复或换调用方式后重跑 OQ-1/2/3/5/6/7/8。
- Client `Theme.listTokens` 本轮超时（页面未连/未打开），P4 前需在 Web GUI 打开状态下重取 theme token 清单。
