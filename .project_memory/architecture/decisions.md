# 架构层 · decisions（关键决策与取舍）

## ADR-001 · 单 bundle 四层（2026-11-23）
- 决策：一个 `@local/engineering-craft-suite` bundle，内含多个 plugin row，按底座/能力/门控/展示分层。
- 理由：共享同一份 EcState 与门规则；分 bundle 会让跨包状态同步复杂化。
- 取舍：row 粒度仍可独立启停。

## ADR-002 · 多 agent 常态化，不做单 agent 退化（2026-11-23，主人修订）
- 决策：工程任务恒走 DSH subagent 六岗位顺序流水线；删除 skill 里的"能力门/收益门/单 agent 一等路径"路由。
- 理由：本套件 DSH 专用，subagent 是原生能力且绑在 Lead Session 日志上；岗位顺序严格是主人明确要求。
- 取舍：不用 workflow 脚本（六角色是顺序流水线，非 fan-out）；用 subagent + send_message + wait_agent。
- 来源：主人 2026-11-23「因为是 dsh 专用插件，必然多 agent 协同，不考虑单 agent 退化；岗位职责清晰、顺序严格；针对 dsh 优化，不完全照抄 skill」。

## ADR-003 · 门是状态可见 + 工具纪律，不是内核 hook（2026-11-23）
- 决策：G1/G2/G3 做成 EcState 投影 + 工具返回 + prompt 注入；不冒充系统强制。
- 理由：engineering-craft P0-8 能力诚实；hook 才能强制的规则不伪称强制。
- 取舍：依赖 agent 遵守工具返回；由面板可见性 + 人拍板弥补。

## ADR-004 · 不往 session 日志塞自定义事件类型（2026-11-23）
- 决策：EcState 用 projection + storage 派生，不 `append` 新 event type。
- 理由：dsh-doc `practices.md`——未知 event type 会被 Session 拒绝（不能设 ignorable）。
- 取舍：门状态持久化需实施前用 inspection 确认具体 storage service。
