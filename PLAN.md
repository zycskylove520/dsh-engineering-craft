# PLAN · engineering-craft DSH 工程流程套件

> 执行计划（工作区临时产物，不进 `.project_memory/`）。
> 基线 ADR：`../engineering-craft-dsh-suite-adr.md`（G2 已放行，2026-11-23 修订：多 agent 常态、岗位顺序严格、DSH 特化）。
> 本 PLAN 的每步都有可判定验收；未过门禁止进下一步。

## G0 · 交接物落盘（当前）
- [x] ADR 草案 + 修订（architecture + DSH 特化角色流水线）
- [x] PLAN.md（本文件）
- [x] `.project_memory/` 工程记忆骨架（INDEX / architecture / conventions / project / open-questions）

## P0 · bundle 骨架
- [ ] 建 `@local/engineering-craft-suite` 包：package.json / cordis.patch.yml / locale{en,zh}.json / icon.svg / docs{DETAIL.md,preview.svg} / 空 index.js+client.js
- [ ] `node --check` 全部 JS 通过；manifest 校验
- [ ] `plugin_manager install_bundle` 安装；plugin manager 可见、无诊断
- **验收**：面板/插件列表出现套件条目，无 metadata 诊断

## P1 · 状态核心（subagent: ec-architect → ec-developer）
- [ ] 用 `cordis_inspect_query` 确认 `sessionProjections` / storage 契约与 `wire.view` 写法
- [ ] `gate-rules.js` 纯函数（G1/G2/G3 判定 / next-role 推进）+ 单测（先红后绿）
- [ ] `ecGate` 投影服务（EcState 派生、stateVersion、view 同引用抑制）
- **验收**：单测全绿、投影可从 inspection 查到

## P2 · 工具层（subagent: ec-developer）
- [ ] `ec_stage`（query/confirm-gate/next-role）
- [ ] `ec_artifact`（PRD/ADR/CONTRACT/PLAN/Brief/Release 模板 + 校验）
- [ ] `ec_memory`（.project_memory init/write/query）
- [ ] `ec_gate_metrics`（GATE-LOG 最小 schema）
- **验收**：工具注册可见、调用返回正确、产物落盘路径对

## P3 · 命令与注入（subagent: ec-developer）
- [ ] `/ec` 命令（status / next / gate / metrics / memory 子命令）
- [ ] `systemPrompt.section()` 注入当前门与岗位状态
- **验收**：会话内 `/ec` 可调用、prompt 注入可见

## P4 · UI（subagent: ec-developer → ec-reviewer 审查）
- [ ] `main` keyed 面板（阶段/门/PLAN/subagent 岗位树）
- [ ] `conversation.session.header.actions` 入口
- [ ] `shell.overlay` go/no-go 确认卡（人拍板）
- [ ] locale en+zh / theme token / 详情页
- **验收**：页面实测显示、theme/locale 正确、无 slot crash

## P5 · 集成验证与交付（subagent: ec-tester → ec-reviewer → ec-ops）
- [ ] 端到端走一遍 G1→G3→交付，贴真实命令输出
- [ ] 证据分级（实测/推断/猜测）
- [ ] 交付说明 + 追问下一需求
- **验收**：全绿、用户验收

## 岗位流水线（横切 P1–P5，顺序严格）
1. ec-product — 只在需求变更时启动，交 PRD
2. ec-architect — 读 PRD，交 ADR+CONTRACT
3. ec-developer — 读 ADR+CONTRACT，交代码+PLAN 进度
4. ec-tester — 读代码，交测试+真实输出
5. ec-reviewer — 读测试，交 Brief+findings（4 轮封顶）
6. ec-ops — 读 APPROVE，交发布清单+回滚预案（人 go/no-go）

规则：下游在上游交接物文件存在且 lead 确认前不得启动；交接只传路径指针；子 agent 自述不算证据，lead 集成重验。
