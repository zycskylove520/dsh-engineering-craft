# DELIVERY · engineering-craft DSH 工程流程套件（交付说明）

> 交付日期：2026-11-23。VERDICT: APPROVE（评审岗第 1 轮，R-01 已 lead 收尾）。
> 六岗位流水线实跑：ec-product（PRD）→ ec-architect（CONTRACT/ADR 修订）→ ec-developer（实现 + 3 轮修复）→ ec-tester（TEST-REPORT + 31 边界测试）→ ec-reviewer（BRIEF/FINDINGS/APPROVE）。

## 做了什么

把 engineering-craft skill 落地为 DSH 内可运行的工程流程套件，包 `@local/engineering-craft-suite`，已装进 desktop profile 并激活（fiberPhase: active）。

- **4 个工具**：`ec_stage`（阶段/门/下一岗位）、`ec_artifact`（交接物模板+校验+指针登记）、`ec_memory`（.project_memory 建库/写回/检索）、`ec_gate_metrics`（GATE-LOG）。
- **六岗位流水线**：product → architect → developer → tester → reviewer → ops，按交接物依赖严格保序；**研发岗可条件并行**（三道门：能力/任务形状/收益，PLAN.md 中文件归属不重叠的待办单元 ≥2 时 `ec_stage(mode:'next-role')` 返回多单元，否则单岗位）；上游缺陷冻结下游退回；G1/G2/go-no-go 由人拍板，G3 凭真实命令证据。DSH 特化：恒走多 agent，不做单 agent 降级。设计见 `ADR-PARALLEL.md`。
- **面板**：`main` keyed 面板（阶段/门/PLAN/岗位树）+ 会话头「工程面板」入口 + go/no-go 确认卡（`shell.overlay`）。
- **状态**：按项目落 `projectRoot/.engineering-craft/state.json`（跨会话连续）；Host↔Client 用 `ctx.webServer` + `fetch()`。
- **/ec 命令** + systemPrompt 门状态注入（两者防御性，失败不影响激活）。

## 实测验收（证据见 TEST-REPORT.md / FINDINGS.md）

- AC1 实机：install_bundle + set_plugin 激活成功，`fiberPhase: active` 无诊断；4 工具经 Tool inspection 确认注册。
- AC2~AC4/AC10：G1 未过拒绝下游、交接物→指针→门放行链路、六岗位保序 + 研发岗形态 B——72/72 测试绿（含 11 条形态 B 用例），端到端 create prd → confirm G1 → stage=design 实测通过；两种形态冒烟：三道门全过→B 多单元、文件重叠/能力关闭→A 单岗位。
- AC5/AC6：memory 规范层只写规范带来源日期；`/ec` 子命令冒烟通过。
- AC7：面板/确认卡代码就绪，pendingConfirmOf 五分支实测正确；**Client 真实渲染未实测**（本会话未做浏览器页面级验证）。
- AC8：locale en/zh 文件完整；**已知限制**：client.js 文案硬编码中文、locale 未接线（评审 R-02，见下）。
- AC9：72 测试 + 实机激活 + 5 findings 全闭环。
- **本次增量（2026-11-23 晚）**：按主人要求给研发岗加条件并行（对齐 skill 的形态 B，但保留 DSH 恒多 agent、无单 agent 降级）。走流水线：ADR-PARALLEL（架构）→ 研发岗实现 + Config 阈值闭环 → 测试岗独立验证（TEST-REPORT §9，边界探针 9 项断言全 PASS）。测试岗 2 条 low findings：P-F-01 roleDefaults 纯内存重启回落（设计如此，Config 由 apply 重新注入，不改）；P-F-02 HTTP action 未透传并行 opts（已修：透传 capabilities/thresholds，与 ec_stage 工具入口一致）。

## 交付前全量审查（2026-11-23 终轮）

用 4 个独立只读 agent 并行审四维（代码正确性 / 文档实现一致性 / 与 skill 思想对齐 / 测试质量），lead 逐条核实原文后修复：

- **2 个 blocker 已修**：① HTTP/工具层的 `projectRoot` 自校验恒真（`safePathWithin(root,root)`）使白名单形同虚设——新增 `resolveAllowedRoot()`（允许根来自 `EC_ALLOWED_ROOTS`，缺省 cwd + 系统 tmpdir），HTTP 与工具统一使用；实测根内放行、根外拒绝。② `EcConfirmCard` 在提前 return 后调用 `useCallback` 违反 React hooks 规则会崩——hook 提到返回前、gate 改由参数传入。
- **should 已修**：ownerFiles 重叠检测做路径规范化（防 `./a.js` vs `a.js` 绕过）；坏 state.json / 残缺字段转 STORAGE_UNAVAILABLE；GET /state 补 `nextRole`（面板"下一岗位"不再恒 '-'）；readBody 改 Buffer.concat 一次解码（防中文跨 chunk 乱码）；confirmGate/G3 的 stage 只前进不回退。
- **测试质量已修**：符号链接空断言改为真实行为断言；补 `apply(ctx,config)` 生产接线测试（删 index.js:180 必红）；73/73 全绿。
- **文档漂移已修**：ADR-PARALLEL 形态 B 返回值、CONTRACT §2.2/§5.1/§6/§4.2、根 ADR 三处陈旧三态路由措辞、README 均已与实现对齐。
- **与 skill 思想对齐度：高**。六岗位保序、双形态三道门、交接物落盘只传指针、lead 集成重验、事实等级、契约收敛留痕、G1/G2/go-no-go 人拍板均有源码证据。保留的合理差异仅"无单 agent 降级"（主人明确要求的 DSH 特化）。
- **已知限制（不阻断）**：releaseDecision 使 EcState 增字段但未升 version（schema 漂移，已记录）；确认动作信任 userConfirmed 布尔（设计风险，加 nonce 属新功能）；safePathWithin 不解析 realpath（默认允许根已收窄，Windows 建链权限受限）；TEST-REPORT §9 与 CONTRACT §9 两处记录性漂移；临时目录未清理（测试卫生）。

## 已知限制（诚实标注）

1. ~~**R-02（nit，未修）**：locale 死资源。~~ **已修复（2026-11-23 补做）**：client.js 接 DSH 自带系统插件 `@deepseek-ai/dsh-client-locale`——`ctx.locale.register(NS,{zh,en})` 注册字典、`ctx.locale.bind(NS)` 拿 t、`useSyncExternalStore(locale.subscribe, locale.getSnapshot)` 订阅语言切换即时重渲染；26 个 UI 文案全部走 t，面板/确认卡/入口随设置页语言切换。只依赖 `@deepseek-ai/*` 系统插件，未引入任何市场第三方插件。zh/en 字典 26 键一一对应。
2. **Client 页面级验证未做**：slot 注册/主题 token/确认卡实际渲染未在本会话浏览器实测；代码按 dsh-context 生产范式写，但实际呈现需主人在 Web GUI 里看一眼。
3. **门是纪律不是内核强制**：G1/G2/G3 通过工具返回 + prompt 可见 + 面板呈现实现，agent 仍需遵守；不冒充系统 hook（engineering-craft P0-8 能力诚实）。
4. **配置设置页未实测**：Config 用 schemastery `z.object` + volatile（照 dsh-bili-scroll 生产写法），设置页可写性需安装后实测。

## 文件与位置

- 源码包：本仓库根目录
- 架构与收敛决策：工作区根 `engineering-craft-dsh-suite-adr.md`（含 §10.5 架构收敛）
- 交接物：`PRD.md`、`CONTRACT.md`、`PLAN.md`、`TEST-REPORT.md`、`BRIEF.md`、`FINDINGS.md`
- 工程记忆：包内 `.project_memory/`（已同步 §10.5 收敛）

## 安装状态

已安装在 desktop profile（`include:@local/engineering-craft-suite`），链接本地目录工作区源码——后续改源码 HMR 自动重载；要下发给别人时把包目录发布，对方用插件管理器「添加本地目录」安装。
