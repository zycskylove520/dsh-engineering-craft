# DELIVERY · engineering-craft DSH 工程流程套件（交付说明）

> 交付日期：2026-11-23。VERDICT: APPROVE（评审岗第 1 轮，R-01 已 lead 收尾）。
> 六岗位流水线实跑：ec-product（PRD）→ ec-architect（CONTRACT/ADR 修订）→ ec-developer（实现 + 3 轮修复）→ ec-tester（TEST-REPORT + 31 边界测试）→ ec-reviewer（BRIEF/FINDINGS/APPROVE）。

## 做了什么

把 engineering-craft skill 落地为 DSH 内可运行的工程流程套件，包 `@local/engineering-craft-suite`，已装进 desktop profile 并激活（fiberPhase: active）。

- **4 个工具**：`ec_stage`（阶段/门/下一岗位）、`ec_artifact`（交接物模板+校验+指针登记）、`ec_memory`（.project_memory 建库/写回/检索）、`ec_gate_metrics`（GATE-LOG）。
- **六岗位顺序流水线**：product → architect → developer → tester → reviewer → ops，交接物落盘、只传路径指针、门未过不得进下游；G1/G2/go-no-go 由人拍板，G3 凭真实命令证据。DSH 特化：不做单 agent 退化（按主人要求）。
- **面板**：`main` keyed 面板（阶段/门/PLAN/岗位树）+ 会话头「工程面板」入口 + go/no-go 确认卡（`shell.overlay`）。
- **状态**：按项目落 `projectRoot/.engineering-craft/state.json`（跨会话连续）；Host↔Client 用 `ctx.webServer` + `fetch()`。
- **/ec 命令** + systemPrompt 门状态注入（两者防御性，失败不影响激活）。

## 实测验收（证据见 TEST-REPORT.md / FINDINGS.md）

- AC1 实机：install_bundle + set_plugin 激活成功，`fiberPhase: active` 无诊断；4 工具经 Tool inspection 确认注册。
- AC2~AC4/AC10：G1 未过拒绝下游、交接物→指针→门放行链路、六岗位严格顺序——61/61 测试绿，端到端 create prd → confirm G1 → stage=design 实测通过。
- AC5/AC6：memory 规范层只写规范带来源日期；`/ec` 子命令冒烟通过。
- AC7：面板/确认卡代码就绪，pendingConfirmOf 五分支实测正确；**Client 真实渲染未实测**（本会话未做浏览器页面级验证）。
- AC8：locale en/zh 文件完整；**已知限制**：client.js 文案硬编码中文、locale 未接线（评审 R-02，见下）。
- AC9：61 测试 + 实机激活 + 5 findings 全闭环。

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
