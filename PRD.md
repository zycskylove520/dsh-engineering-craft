# PRD · engineering-craft DSH 工程流程套件

> 产品交接物（G1）。来源：主人 2026-11-23 需求 + 追问确认 + 修订指令。
> 验收标准见 §5，均可判定。

## 1. 目标
把 `engineering-craft` skill 的方法论落地为 DSH 内可运行、可查询、可视化的工程流程套件：让 agent 在 DSH 中按阶段门、交接物、工程记忆、多 agent 岗位流水线干活，而非仅靠提示词自觉。

## 2. 用户与场景
- 用户：DSH 用户（主人），在本机做代码工程任务。
- 场景：开启一个工程任务 → 套件驱动产品/架构/研发/测试/评审/运维六个 subagent 岗位顺序协作 → 门状态与人拍板点可视化 → 工程记忆落盘。

## 3. 用户故事
1. 作为开发者，我想在会话里查当前工程阶段与门状态，以便知道下一步能做什么。
2. 作为用户，我想在 G1/G2/go-no-go 时被明确请求确认，以便保留最终拍板权。
3. 作为开发者，我想让工程交接物（PRD/ADR/契约/PLAN/Brief）落盘成文件，以便跨会话续接。
4. 作为开发者，我想用工具维护 `.project_memory/`，以便工程规范长期不遗忘。
5. 作为用户，我想看到 subagent 岗位流水线的实时状态，以便知道哪个角色在干什么。
6. 作为用户，我要岗位顺序严格、不做单 agent 退化，因为这是 DSH 专用插件、协同是常态。

## 4. 优先级
- P0：bundle 可安装可见
- P1：门状态核心 + 规则单测
- P2：四个工具 + 交接物/工程记忆落盘
- P3：`/ec` 命令 + prompt 注入
- P4：面板 + 确认卡 + locale/theme
- P5：端到端验证与交付

## 5. 验收标准（可判定）
- [ ] AC1 插件管理器可见 `@local/dsh-engineering-craft`，无 metadata/icon/detail 诊断。
- [ ] AC2 `ec_stage` 能查询阶段与门；G1 未过时拒绝进入编码动作。
- [ ] AC3 `ec_stage(mode:'next-role')` 按 product→architect→developer→tester→reviewer→ops 返回下一岗位，且仅在上游交接物存在时放行。
- [ ] AC4 `ec_artifact` 生成 PRD/ADR/CONTRACT/PLAN/Brief/Release/TEST-REPORT/FINDINGS/PROGRESS 模板并校验结构（`[2026-11-24 更新]` 清单已扩展；保留原文）。
- [ ] AC5 `ec_memory` 能 init/write/query/recall `.project_memory/`，只写规范层。
  - `[2026-11-24 更新]` 写入校验已从"带来源与日期"升级为**强制五件套**（`[KIND ID]`+陈述+证据+记录日期·等级）+四条硬约束，并新增 recall 检索套用；保留原文，以 CONTRACT §5.3 为准。
- [ ] AC6 `/ec` 命令可列出 status/next/gate/metrics/memory；prompt 注入含当前门与岗位。
- [ ] AC7 Client 面板显示阶段/门/PLAN/岗位树；go/no-go 确认卡只在需要人拍板时出现。
- [ ] AC8 locale en+zh 完整；面板用 theme token；无 slot crash。
- [ ] AC9 端到端 G1→G3→交付跑通，贴真实命令输出并标证据等级。
- [ ] AC10 六个岗位 subagent 顺序启动，交接物落盘、只传路径指针，lead 集成重验。

## 6. 开放问题
- 无（5 个设计选项已在 ADR §12 由主人「开始执行」+ 我方推荐默认收敛）。
