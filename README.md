# dsh-engineering-craft

> 仓库主页：<https://github.com/zycskylove520/dsh-engineering-craft>

**本插件来自另一个项目：[engineering-craft 通用 skill](https://github.com/zycskylove520/engineering-craft)。** 那个项目是纯 Markdown、不绑定任何 agent 软件的代码工程规范；**如果你不用 DSH，或想要不依赖 DSH 的版本，请直接使用它**。本仓库是它针对 DeepSeek Harness 的特化实现——把工程纪律做成 DSH 里可调用的工具、面板与多 agent 流水线。

把 engineering-craft 的工程纪律搬进 DeepSeek Harness：阶段门、交接物落盘、工程记忆，以及由多个 subagent 分工协作的六岗位流水线。

> DSH 专用插件。只依赖 DSH 自带的 `@deepseek-ai/*` 系统插件，不依赖任何市场第三方插件。

## 它解决什么

- 需求没确认就写码，做到一半发现方向错了
- 改完只说"应该没问题"，拿不出真实命令和输出
- 项目规范散在聊天里，换个会话就丢
- 复杂任务一个 agent 扛到底，没人分工、没人复核

## 安装

需要 DSH 0.2.2-rc.1+。

1. 克隆本仓库：`git clone https://github.com/zycskylove520/dsh-engineering-craft.git`
2. DSH → 设置 → 插件 → 添加插件 → 选择本仓库目录。
3. 启用 `@local/dsh-engineering-craft`。

插件是单 host row + `dsh.client` 声明自动挂载浏览器半端，状态按项目存 `<项目根>/.ec-state/state.json`（无兼容：旧路径 `.engineering-craft/state.json` 不读取、不迁移；版本不是 2 直接报 `STORAGE_UNAVAILABLE`），跨会话连续。

## 三种使用场景

### 1. 第一次用（空项目）

对 agent 说「开始工程」+ 你要做什么。它**先问你一句**是否在 `<当前会话所处目录>` 进行工程构建（默认候选取会话目录，不是 DSH 自己的 profile 目录）——你确认或换个路径后才动手；所有 `ec_*` 工具的 `projectRoot` 都会显式用这个已确认目录。之后它会和你商谈**架构、语言、命名、技术栈**（不凭空替你决定），把约定落成项目规范，再进入需求澄清。你只需回答问题、在关键处拍板。

### 2. 融入已有项目

- **有代码、尚无记忆**：它通读源码，沉淀出这个项目的架构、命名和习惯（每条带文件路径证据），指出不合理设计并和你协商，再建起 `.project_memory/`——标准骨架为 **6 个职责目录**（architecture / conventions / api-contracts / data-model / testing / build，build 独立于 architecture）+ **3 个根文件**（INDEX.md / status.md / open-questions.md）+ **tmp/** 执行产物区，全部建好、内容可薄但不缺位；目录所有权用空文件 `.engineering-craft` 标记。不擅自大改。
- **代码和记忆都在**：先读 `INDEX.md` 按现有约定干活，不重写你的规矩；写业务/核心代码前用 `ec_memory recall` 按线索检索全规范层，把命中条目 id 列入 `.project_memory/tmp/PLAN.md` 的 constraints（每个并行单元各自检索，无命中标「无既有约定」）。

### 3. 下一次

不用重讲项目背景。说「开始工程」+ 新需求，它读已有记忆接着上次的约定走；写码前先 `ec_memory recall` 检索套用既有约定，有长期约定变化会写回规范层，下次自动生效。

日常写代码、改 bug、重构、审查代码时，这套工具也会自动可用。

## 运行原理（概览）

复杂任务交给六个岗位的 subagent 分工，各司其职：

| 岗位 | 它为你做什么 | 完成后给你什么 | 谁拍板 |
|---|---|---|---|
| 产品 | 把模糊想法问成有验收标准的需求 | 需求文档 | **你**：确认验收 |
| 架构 | 基于需求设计结构、选语言和技术栈 | 架构决策 + 接口约定 | **你**：确认选型 |
| 研发 | 按计划小步写代码，每步能编译 | 可运行代码 + 执行计划 | agent 自检 |
| 测试 | 写测试、跑边界、贴真实命令输出 | 测试报告 + 可核查证据 | agent 自检 |
| 评审 | 回看改动与证据，找问题提修法 | 评审结论 + 问题清单 | agent 自审；争议请你定 |
| 运维 | 备好上线材料与回滚方案 | 发布清单 + 回滚预案 | **你**：go/no-go |

六岗位按交接物依赖**严格保序**：上游落盘、下游才开工。**研发岗可条件并行**——当 PLAN.md 里有 ≥2 个文件归属不重叠的待办单元、且能力与收益门槛满足时，一次启动多个研发单元；否则单岗位顺序推进。上游交接物有问题会冻结下游、退回重做。

**默认多 agent，不做单 agent 降级**——这是 DSH 特化（subagent 是原生能力）；只有一个不可分单元时，单岗位顺序执行亦合规（非失败）。

只有三个地方需要**你**拍板：确认需求验收、确认技术选型、发布 go/no-go；其余由 agent 按纪律推进。

门是**纪律与可验证性**，不是内核强制 hook：违规和未经验证的断言会显眼可查，但不能物理阻止 agent 绕过流程。

## 提供的 agent 工具

| 工具 | 作用 |
|---|---|
| `ec_stage` | 查阶段/门状态、记录门确认、取下一岗位或并行单元、开新任务（`new-task`），以及记录 TDD 红绿灯（`tdd`/`green`）与验证证据（`verify`）。**TDD 与验证是机械硬门**：没有红灯记录、没有验证证据，G3 直接拦住（`TDD_RED_MISSING`/`VERIFY_MISSING`），不能宣称完成 |
| `ec_artifact` | 生成交接物模板（落盘 + 登记指针）或校验结构；`path` 省略默认落 `.project_memory/tmp/<文件名>`，且**只能落在 `.project_memory/tmp/` 内**，越界返回 `ARTIFACT_OUTSIDE_TMP`；新增 `progress`（PROGRESS.md 五节 Goal/Done/Next/Open questions/Key facts） |
| `ec_memory` | `.project_memory/` 建库（6 职责目录 + 3 根文件 + tmp，职责目录自动带边界声明桩）/ 写规范（**职责目录**强制五件套并附**内容质量软警告**：清单式计数 / 纯行号证据；`tmp` 与 3 根文件 `index/status/open-questions` 免校验、写自由文本如 PLAN/导航/快照）/ `query` 按需读 / `recall` 写码前按线索检索全规范层，**字面整句优先、零命中分词/二元组回退**、按相关性排序、可按 `kind`/`layer` 过滤，返回 id/kind/file/matchMode / `audit` 建库自检 + **qualityScore 质量分**（边界声明、清单式、纯行号证据、**RULE 占比**、**配方覆盖**、**插件实现幻觉**、无 header 散文文件、PLAN 覆盖映射；init 生成的桩豁免无条目扣分、agent 写进桩的散文照常报；≥60 才 passed）/ `patch` 按 id 条目级更新（改正文或加 `状态:` 行，不动其他条目，认 `##` 与 `- [OPEN]` 两种前缀） |
| `ec_gate_metrics` | GATE-LOG 门度量记录与回看；GATE-LOG 落 `.project_memory/tmp/GATE-LOG.md`（每行一条 JSON，对齐 skill `core/gate-metrics.md` 六字段：日期/阶段/门/结果 拦住\|通过\|绕过/缺什么/处置；无兼容：旧 `.engineering-craft/gate-log.jsonl` 不再读取合并），`record` 支持 stage/missing/disposition 参数、outcome 只接受中文 拦住\|通过\|绕过（英文 blocked/passed 不识别） |

**记忆内容规格与检索闭环**：每条陈述须为 `[KIND ID]`（RULE/FACT/DECISION/OPEN + 稳定 id）+ 正文 + `证据:` 行（文件路径 + 模式描述）+ `记录: YYYY-MM-DD · 实测|推断|用户约定`；禁本机绝对路径，事实等级与核实状态（待复核/已复核）正交分列，行号仅辅助。写入默认强制这套五件套；写码前用 `recall` 检索、把命中 id 列入 PLAN constraints，形成"规范落地 → 检索套用 → 按证据回写"的闭环。

**建库质量闸（会话头常驻提示 + audit 计分）**：只把项目拍成 FACT 照片不算合格——RULE 占比须 ≥35%，高频动作（新增算子/引擎/loss/数据集/backend）须有 ≥3 条带步骤配方且含验证方式；证据主体是"路径 + 模式描述"不是纯行号；清单式计数改写为规律；bug 必须写成 `[OPEN BUG-NN]` 五件套（散文列表进不了 recall）；不得把 `.engineering-craft` 标记等插件自身实现写成项目约定。`ec_memory audit` 把这些逐条计成 `qualityScore`（0–100，<60 判不合格），agent 建库后必须贴报告。

另有 `/ec` 命令（`use` / `which` / `status` / `next` / `gate` / `metrics` / `memory`）和会话头「工程面板」入口。**先用 `/ec use <项目根>` 落定工程目录**（`which` 查当前、`use clear` 清除）：会话头注入的阶段/门状态读这个已确认根，不再读宿主 cwd；未确认时只显示红线、不显示任何阶段的门数字。面板显示阶段、门、计划和岗位树；需要你拍板时弹出确认卡。

## 配置

- **项目路径是文本标签（不做存在性校验）**：`projectRoot` 既可以是本机路径，也可以是远端路径（如 `/remote/path/to/Project`）。插件不校验它是否存在、不在白名单内与否——工程在哪里、是不是远程、怎么挂载，由你/宿主记忆与 SSH 工具负责。状态与记忆就落在 `<projectRoot>/.ec-state/` 和 `<projectRoot>/.project_memory/`（无兼容：旧状态路径不读取、不迁移；GATE-LOG 落 `<projectRoot>/.project_memory/tmp/GATE-LOG.md`；远端路径需该路径在你的宿主环境可写，或由你同步）。POSIX 风格标签（`/` 开头）原样保留，不会被改写成 Windows 盘符；相对标签按当前目录解析（不读 `EC_ALLOWED_ROOTS`）。只有空标签返回 `INVALID_INPUT`。
- **门规则与并行阈值**：通过插件 Config 覆盖，只保留 `gates` 与 `thresholds.minFilesForParallel`（语义为研发岗并行的最小单元数，默认 2）。已删除两个死配置 `paths.memoryDirName/artifactsRoot` 与 `minUnitsForWorkflow`。
- **中英双语**：面板/确认卡文案走 DSH 系统 locale，在设置里切语言即时生效。

## 适用范围

**适合**：有规模或多人/多 agent 协作、需要可审计过程、质量重于速度的代码工程；生产代码、开源项目、团队项目。

**不适合**：纯闲聊、查资料、非代码任务。

**所有代码任务（含小改动/增量功能）一律严格走完整六岗位流水线**，不得以"小功能、增量、直接改"为由跳过任何岗位。岗位可经评估后快速完成——落该岗交接物把它标记为完成，再由 `ec_stage next-role` 推进；但岗位本身不可省略。识别到用户提出**新需求**时，先调 `ec_stage(mode=new-task)`（或 `/ec new-task`）归档旧状态并重置六岗（工程记忆不动），再从 product 岗重新走完整流程；不要复用上一需求"全部完成"的状态直接开工。旧状态在 `.ec-state/history/` 可找回。

**工程纪律硬门（融合 obra/superpowers 方法论）**：① **TDD**——写生产代码前先写失败测试，调 `ec_stage mode=tdd` 记红灯，改完调 `mode=green` 记绿灯；没有红灯记录 G3 门机械拒绝。② **证据先于断言**——宣称完成/通过/修好前先真实跑验证命令，调 `ec_stage mode=verify` 落「命令+本次输出摘要」；没有验证证据 G3 门机械拒绝。会话头每轮注入反合理化红线（"太简单不用走流程""先写实现回头补测试""agent 说成功就算完成"等一律视为违规）。

## 已知限制

- 门是纪律不是内核强制，agent 仍需遵守工具返回。
- 浏览器里的面板渲染、配置页可写性未在本会话实测，按 DSH 系统组件范式实现。
- ~~状态写入新增的发布决策字段尚未升级 state schema 版本（记录性漂移，不影响使用）。~~ **已修**：state schema 已升至 **version 2**，新增 `progress` 交接物键与 `releaseDecision`（初值 null）、PLAN 单元支持 `constraints`；无兼容：v1 state 不识别、不迁移，版本不是 2 报 `STORAGE_UNAVAILABLE`。

## 项目文档

- `CONTRACT.md`：接口契约（`nextRole` 形态 A/B、工具 schema、EcState 结构）
- `ADR-PARALLEL.md`：研发岗条件并行设计
- `PRD.md` / `PLAN.md`：需求与执行计划
- `TEST-REPORT.md` / `BRIEF.md` / `FINDINGS.md` / `DELIVERY.md`：测试、评审、交付与已知限制

## 开发

```bash
node --check <每个 js>          # 语法检查（node >= 22）
node --test tests/*.test.js     # 单元测试（node:test，零外部依赖）
```

测试覆盖门规则纯函数、六岗位推进与研发岗并行三道门、路径穿越防御、交接物→门放行链路（产物落 tmp）、Config 生产接线，以及工程记忆对齐回归（6 目录+3 根文件+tmp、所有权标记、五件套/硬约束、recall 相关性排序与过滤、内容质量软警告、tmp/根文件自由文本、audit 自检与桩豁免、patch 条目级更新与列表前缀/幽灵条目防丢失、state v2 严格校验（无 v1→v2 迁移、无旧路径兼容）、GATE-LOG 移位）。运行 `npm test` 查看当前全绿读数。

## 许可证

MIT
