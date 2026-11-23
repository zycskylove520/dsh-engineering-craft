# 规范层 · naming（命名约定）

- 文件/模块：kebab-case（`gate-service.js`、`ec-gate-metrics.js`）。
- 类/类型：PascalCase（`EcState`、`GateRules`）；接口不加 I 前缀。
- 函数/变量：camelCase；常量 UPPER_SNAKE（如 `DEFAULT_GATES`）。
- Row id（2026-11-23 收敛）：单 host row `id = name = '@local/engineering-craft-suite'`；早期 4 row（ecGate/ecTools/ecPanel/ecCommand）作废，client 由 `dsh.client` 声明挂载。来源：ADR §10.5。
- 工具名：`ec_*` 前缀（`ec_stage`、`ec_artifact`...）；命令 `/ec`。
- 交接物文件名全大写：`PRD.md` / `ADR.md` / `CONTRACT.md` / `PLAN.md` / `BRIEF.md` / `RELEASE.md`。
- 来源：languages/typescript.md §3 + 本项目约定（2026-11-23）。
