# dsh-engineering-craft

> 仓库主页：<https://github.com/zycskylove520/dsh-engineering-craft>

把 engineering-craft 的分层工程方法论落地成 DeepSeek Harness（DSH）内的工程流程插件套件：阶段门、交接物、工程记忆，以及按交接物依赖保序、研发岗可条件并行的六岗位 subagent 流水线。

> 这是 DSH 专用插件。只依赖 DSH 自带的 `@deepseek-ai/*` 系统插件，不依赖任何市场第三方插件。

## 它能做什么

- **阶段门（G1/G2/G3）**：需求未确认不许写实现代码、设计未确认不许开工、检查未过不许送审。门状态在工具返回、系统提示词与面板里可见。
- **六岗位流水线**：产品 → 架构 → 研发 → 测试 → 评审 → 运维，按交接物依赖**严格保序**；其中**研发岗可条件并行**——当 PLAN.md 有 ≥2 个文件归属不重叠的待办单元、且能力与收益条件满足时，`ec_stage(mode:'next-role')` 返回多个并行单元，否则维持单岗位。上游交接物有问题会冻结下游退回重做。专为 DSH 的 subagent 机制设计，**恒走多 agent，不做单 agent 降级**。
- **交接物落盘**：PRD / ADR / CONTRACT / PLAN / TEST-REPORT / BRIEF / FINDINGS / RELEASE 模板生成与结构校验。
- **工程记忆**：维护项目级 `.project_memory/`，只存规范、带来源与日期、不遗忘。
- **人保留拍板权**：G1/G2 确认与发布 go/no-go 通过确认卡请你决定，agent 不替你拍板。
- **中英双语**：面板/确认卡文案走 DSH 系统 locale，切语言即时生效。

## 提供的 agent 工具

| 工具 | 作用 |
|---|---|
| `ec_stage` | 查当前阶段/门状态、记录门确认、取下一应启动岗位 |
| `ec_artifact` | 生成交接物模板或校验结构（落盘 + 登记状态指针） |
| `ec_memory` | `.project_memory/` 建库 / 写规范 / 按线索检索 |
| `ec_gate_metrics` | GATE-LOG 门度量记录与回看 |

另有 `/ec` 命令（`status` / `next` / `gate` / `metrics` / `memory`）与会话头「工程面板」入口。

## 安装

需要 DSH 0.2.2-rc.1+。

1. 克隆本仓库到本地。
2. 打开 DSH → 设置 → 插件 → 添加插件 → 选择本仓库目录。
3. 启用 `@local/engineering-craft-suite`。

插件为单 host row + `dsh.client` 声明自动挂载浏览器半端；状态按项目存 `<项目根>/.engineering-craft/state.json`。

## 门是纪律，不是内核强制

G1/G2/G3 通过工具返回 + 提示词可见 + 面板呈现实现，agent 仍需遵守工具返回。本套件不冒充系统级 hook 强制——这是能力诚实，不是缺陷。

## 文档

- `CONTRACT.md`：接口契约（模块边界、API 签名、错误语义、EcState 结构、工具/命令约定）
- `PRD.md` / `PLAN.md`：需求与执行计划
- `TEST-REPORT.md` / `BRIEF.md` / `FINDINGS.md`：测试报告与评审结论
- `DELIVERY.md`：交付说明与已知限制

## 开发

```bash
node --check <每个 js>          # 语法检查（node >= 22）
node --test tests/*.test.js     # 单元测试（node:test，零外部依赖）
```

测试覆盖门规则纯函数、六岗位推进、路径穿越防御、交接物→门放行集成链路。

## 许可证

MIT
