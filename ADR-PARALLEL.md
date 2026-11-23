# ADR-PARALLEL · 研发岗条件并行（2026-11-23）

> 状态：G2 已由主人确认（"插件是 DSH 特化版本，天生支持多 agent；实现某些情况下多 agent 可并行、某些情况必须严格顺序；不需要单 agent 降级"）。
> 本 ADR 是对 ADR §6 的增量修订，不推翻其他部分。

## 背景

原设计为纯形态 A：六岗位严格顺序、恒走多 agent、无单 agent 退化。通用 skill 后来演化出双形态（A 顺序 / B 条件并行 + 单 agent 降级）。主人要求插件对齐 skill 的"岗位级并行判定"，但**保留 DSH 特化的恒多 agent 前提**——不要单 agent 降级。

## 决策

1. **形态 A 为骨架**：product→architect→developer→tester→reviewer→ops 严格顺序不变。六岗位中只有**研发岗**可被形态 B 替换。
2. **形态 B 仅限研发岗内部**：当下一岗位为 `developer` 且满足三道门时，`nextRole` 返回多个并行单元 `roles:[...]`（每个单元来自 PLAN.md 的 `ownerFiles` 不重叠分组），而非单个 role；否则维持 `{role:'developer'}`。
3. **三道门判据**：
   - 能力门：调用方传入 `capabilities.subagent === true`（DSH 天生有，默认 true，Config 可关）。
   - 任务形状门：PLAN.md 中状态为 `todo` 的单元 ≥2，且 `ownerFiles` 两两不重叠（有重叠则退回形态 A，不制造假并行）。
   - 收益门：单元数 ≥ Config `thresholds.minFilesForParallel`（默认 2）。
4. **不做单 agent 降级**：无论能力门是否通过，仍返回多 agent 岗位或单元；能力门关闭只意味着形态 B 不启用（退回形态 A 的多 agent 顺序），绝不返回"单 agent 代理六岗位"。
5. **交接物与门不变**：并行单元各自仍以 `plan` 交接物落盘为准；上游缺陷（ADR/CONTRACT）仍冻结所有下游单元退回上游；人拍板点（G1/G2/go-no-go）不变。

## 接口变更（供 CONTRACT 与研发岗）

- `rules.nextRole(state, order, opts)` 新增 `opts = { capabilities?: {subagent?: boolean}, thresholds?: {minFilesForParallel?: number} }`。
  - 返回形态 A `{role: string}` / `{role:null, blockedBy:string}`（保持旧形状，**不带 mode**）或形态 B `{role:'developer', roles:string[], mode:'B', units:[{id,ownerFiles}]}`。
  - 为兼容既有调用，形态 A 不加 mode；调用方用 `roles` 是否存在区分形态（与 rules.js / CONTRACT §2.1 实现一致）。
- `gate-service.nextRole(projectRoot, opts)` 透传；EcState 不需要新字段（并行判定纯函数、按当前 state.plan 计算）。
- `ec_stage` inputSchema 加 `capabilities`（object，可选）与 `mode` 枚举不变；输出加 `mode` 与 `parallelRoles`。
- `/ec next` 同步输出 `mode` 与 `parallelRoles`。
- client 面板的岗位树在 mode=B 时把 developer 显示为多个并行单元。

## 取舍与风险

- 收益门用单元数而非文件数：`minFilesForParallel` 字段沿用旧名易误解，本次不改字段名以免破坏 Config 兼容，语义在注释中澄清为"最小并行单元数"。
- `ownerFiles` 为空数组的单元不参与并行判定（视为无法判定归属，保守退回形态 A）。
- 能力门默认 true 的理由：DSH 原生 subagent，工具存在即视为可用；Config 可显式关闭。

## 验证要点

- 单测：三道门任一不满足 → 形态 A；三道门全过且 ownerFiles 不重叠 → 形态 B 多单元；有重叠 → 形态 A。
- 回归：既有 61 测试全绿（形态 A 返回值兼容）。
- 实机：`ec_stage(mode:'next-role')` 在临时项目上验证两种形态。
