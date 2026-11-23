# BRIEF · engineering-craft DSH 工程流程套件（评审岗交接物）

> 岗位：ec-reviewer（评审岗，第 1 轮 / 4 轮封顶）。职责：独立评审全部交接物与代码，出 BRIEF + FINDINGS + VERDICT；不改任何实现代码、不改测试、不改其他交接物。
> 依据：PRD §5 AC1~AC10、CONTRACT.md、`../engineering-craft-dsh-suite-adr.md`（含 §10.5 架构收敛）、TEST-REPORT.md、PLAN.md、`.project_memory/` 全部、9 个实现 js + 3 个测试 js + package/cordis.patch/locale。
> 日期：2026-11-23。Node：DSH 自带 bundled Node v24.21.0（PATH 无 node，用显式路径）。
> 证据等级：**[实测]** = 本轮真实命令/探针输出；**[推断]** = 基于落盘代码的合理推论；**[未验证]** = 本环境无运行时，未实测。
> 本文件只写 BRIEF.md 与 FINDINGS.md 两个文件（评审岗纪律）。

---

## 1. 变更摘要（评审视角）

一个 bundle `@local/engineering-craft-suite`：单 host row（package-root）+ `dsh.client` 自动挂载 client 半；把 engineering-craft skill 的阶段门 / 交接物 / 工程记忆 / 六岗位流水线落地为 4 个工具（`ec_stage`/`ec_artifact`/`ec_memory`/`ec_gate_metrics`）+ `/ec` 命令 + systemPrompt 注入 + `main`/header.actions/`shell.overlay` 三 slot 面板 + `/api/engineering-craft/*` HTTP 桥。门状态按 ADR §10.5 收敛为 `<projectRoot>/.engineering-craft/state.json`，Client 用 `fetch()` 读写；六岗位顺序由 `rules.nextRole` 的 `DEFAULT_PIPELINE` 保证，交接物落盘后由 `EcGate.update` 登记路径指针（artifact 键 + role 键双写）。

评审圈范围（全部落盘文件）：`index.js`、`client.js`、`gate-service.js`、`rules.js`、`tools.js`、`command.js`、`artifacts.js`、`memory.js`、`metrics.js`、`tests/{rules,boundary,pipeline}.test.js`、`package.json`、`cordis.patch.yml`、`locale/{en,zh}.json`、`PRD.md`、`CONTRACT.md`、`PLAN.md`、`TEST-REPORT.md`、`docs/*`、`icon.svg`、`.project_memory/**`。无 git 仓库（`git status` 返回 `fatal: not a git repository`），按"全部交接物 + 全量代码"圈范围。

## 2. 独立验证（不采信"已完成/已测试"自述）

| 验证 | 命令/手段 | 结果 |
|---|---|---|
| 语法检查 | `node --check` 12 个 js（9 实现 + 3 测试） | 12/12 `OK` **[实测]** |
| 全套测试 | `node --test tests/*.test.js` | `tests 61 / pass 61 / fail 0 / skip 0`，8 suites，148ms **[实测]** |
| AC1 实机可见 | `plugin_manager list_plugins` | `include:@local/engineering-craft-suite`，`enabled:true`、`fiberPhase:"active"`、无 `readOnlyReason`/诊断 **[实测]** |
| 门判定与岗位顺序 | 读 `rules.js:39-110` + 61 测试逐条断言 | 符合 CONTRACT §4.1/§8/§9 **[实测]** |
| 待拍板卡分支 | 独立 heap 探针调 `pendingConfirmOf`（见 §4 证据） | G1/G2/go-no-go/已确认/已决策 5 分支均正确 **[实测]** |
| go-no-go 返回值 | 独立探针复现 `index.js:296` | **发现新缺陷 R-01**（见 FINDINGS） **[实测]** |
| locale 接线 | `ops_grep` 全仓搜 `locale/i18n/t(` + 读 `client.js` | locale json 完整但 client 未引用，UI 硬编码中文 **[实测]** |

TEST-REPORT 自述的 60/60 与 lead 的 61/61 差异已解释：测试岗报告写在新增第 61 条测试落盘前（报告 §2 记 60，当前实跑 61），不影响"全绿"结论。

## 3. 风险

1. **R-01（should，未阻断交付）**：`index.js:296` go-no-go 动作 `{ok:true, ...ecGate.write(state), decision}` 展开的是路径**字符串**（`gate-service.js:147-148` write 返回路径），产出 `{"0":"C","1":":",…,"decision":"go"}` 的无用字符键对象、无 `stage`/`gates`。这是 F-02（曾判 high）同类反模式在兄弟分支的残留。当前 client `EcConfirmCard.submit` 只判断 `r.ok !== false`（`client.js:146`）故 UI 仍能清卡、决策已落盘，目标用例未被破坏；但响应违约且是潜在陷阱。详见 FINDINGS R-01。
2. **locale 未接线（should/nit）**：`locale/{en,zh}.json` 23 键一一对应且完整（AC8 字面达成），但 `client.js:18-21/95-113/149-155` 全用硬编码中文，从未加载 locale；英文界面不可达，locale 文件为死资源。
3. **门是纪律非内核强制（设计边界，ADR-003/§10.5 已声明）**：`ec_stage.confirm-gate` 接受调用方传入 `userConfirmed:true`；`/ec gate G1 --confirm`（`command.js:51-52`）更把"自行确认"写进错误提示。agent 可自报确认，G1/G2"人拍板"依赖调用方自律而非系统强制。与 ADR-003「不冒充内核 hook」一致，故列为风险而非新 bug；若要硬保证需 DSH hook 级支持。
4. **projectRoot 取 `process.cwd()`（nit）**：prompt 注入 `index.js:199` 与命令 execute `command.js:87` 均以宿主进程 cwd 为项目根，与显式传 `projectRoot` 的工具/HTTP 路径不一致；cwd 非目标项目时面板/注入可能显示另一项目状态。
5. **符号链接越界（推断，未实测）**：`safePathWithin`（`gate-service.js:68-74`）只做词法 resolve/normalize，不做 realpath；根内指向外部的 symlink 可绕过。Windows 建链需权限，测试岗已在 TEST-REPORT §5/§7 标推断。
6. **Client 真实渲染未验证（未验证）**：本环境无 DSH Web GUI/DOM 运行时，AC7/AC8 的 slot 注册与渲染只做静态审阅；lead 实机已见插件 active + 四工具注册，但未报告面板渲染截图。

## 4. AC1~AC10 逐条结论（对照 PRD §5）

| AC | 结论 | 证据指针 |
|---|---|---|
| AC1 插件管理器可见、无 metadata/icon/detail 诊断 | **达成** | [实测] `plugin_manager list_plugins`：`include:@local/engineering-craft-suite` / `fiberPhase:active` / 无诊断；`cordis.patch.yml:8-10` 单 row；`package.json:36-46` dsh.client 声明；`locale/{en,zh}.json`、`icon.svg`、`docs/DETAIL.md` 落盘 |
| AC2 `ec_stage` 查阶段与门；G1 未过拒下游 | **达成** | [实测] `tools.js:79-91` query 返回 stage/gates/gateResults/missingArtifacts；`rules.js:39-66` checkGate 四拒绝码；`tests/boundary.test.js:56-122`、`tests/rules.test.js` 逐条断言；G3 人确认路径被 `tools.js:62-69` 拒绝 |
| AC3 `next-role` 六岗位顺序 + 仅上游交接物存在放行 | **达成** | [实测] `rules.js:23-30` DEFAULT_PIPELINE 六岗严格顺序、`rules.js:76-88` 全落盘才放行/部分落盘阻塞缺失键；`tests/boundary.test.js:131-183`、`tests/pipeline.test.js` 逐段实测；`gate-service.js:283-285` 封装 |
| AC4 `ec_artifact` 六类模板 + 校验结构 | **达成** | [实测] `artifacts.js:13-16` 8 类键（含 testReport/findings）、`artifacts.js:32-40` 模板、`artifacts.js:19-28` schema、`artifacts.js:64-108` create/validate + 指针登记；TEST-REPORT §4.3 E2E-1 实测 create 落 PRD.md |
| AC5 `ec_memory` init/write/query、只写规范层、带来源+日期 | **达成** | [实测] `memory.js:55-120` 三动作；`memory.js:43-47` `hasProvenance` 强制"来源"+`YYYY-MM-DD`；`memory.js:15` 层白名单；冲突降级 `.project_memory_engineer/`（`memory.js:23-36`） |
| AC6 `/ec` 五子命令 + prompt 注入含当前门与岗位 | **达成** | [实测] `command.js:16-67` status/next/gate/metrics/memory；`index.js:193-204` systemPrompt.section 注册；`gate-service.js:302-312` promptSection 含阶段/未过门/下一岗位/阻塞；`/ec` 经 `ctx.get('commands')` 容错（`command.js:74-98`） |
| AC7 Client 面板显示阶段/门/PLAN/岗位树；go-no-go 卡按需出现 | **部分达成（渲染未实测）** | [实测] `client.js:75-115` 面板四块 + 岗位树读 `handoffs[roleKey]`（`:103-106`）；`index.js:156-169` pendingConfirmOf 三分支探针全对（G1/G2/go-no-go）；[未验证] 真实浏览器 slot 渲染；R-01 影响 go-no-go 响应体但不阻断卡片清显 |
| AC8 locale en+zh 完整、面板用 theme token、无 slot crash | **部分达成** | [实测] `locale/en.json`/`zh.json` 33 行 23 键一一对应；`client.js:51-72` 全用 `--dsw-alias-*` token 且带 fallback；slot 注册有防御 `client.js:171-190`；**但 client 未加载 locale、硬编码中文** → 英文不可达（见风险 2）；slot 无 crash 仅静态推断 |
| AC9 端到端 G1→G3→交付、真实输出+证据分级 | **部分达成（证据在 lead/tester 报告）** | [实测] 本轮复跑 61/61、`node --check` 12/12；[交接证据] TEST-REPORT §4.3 真实输出 create prd→confirm G1→stage=design、PC-A/A2/B/C；`.project_memory/open-questions.md:88-99` lead 集成复验记录；G2/G3/交付全链由 lead 声明覆盖，工作区无残留 state.json 可复查（本轮 `find` 无结果） |
| AC10 六岗位 subagent 顺序启动、交接物落盘、只传路径、lead 集成重验 | **达成（流程实证 + 逻辑实证）** | [实测] `list_agents` 见 lead + ec-architect/ec-developer/ec-tester/ec-reviewer 顺序树；交接物落盘 PRD/CONTRACT/TEST-REPORT/PLAN + 本轮 BRIEF/FINDINGS；`rules.js:23-30` 与 `tests/boundary.test.js:131-170` 顺序/上游门实证；`.project_memory/open-questions.md:92-97` lead 集成重验记录 |

## 5. 验证结论

**总体：达成主线，带 1 条应修未阻断缺陷（R-01）+ 2 条非阻断项（locale 死资源、projectRoot 取 cwd）。无 critical/blocker。**

- 架构收敛一致性：实现符合 ADR §10.5（文件落盘 state.json + webServer/fetch + defineTool 容错 + schemastery 容错 + 单 host row）。CONTRACT §1/§2 中仍保留的 SessionProjection/wire.view/ctx.remote 属于被 §10.5 明确覆盖的早期设计，不构成实现偏离；`.project_memory/architecture/overview.md:10`、`decisions.md:4`、`conventions/naming.md:6`、`open-questions.md:79-86` 未同步收敛（如 overview 仍写 wire.view、naming 仍写 4 row id），属规范记忆与实现的文档漂移（nit，不阻断，见 FINDINGS R-03）。
- 安全：`safePathWithin` 词法白名单 + loopback/同源栅栏（`index.js:219-264`）+ 1MB body 上限（`:214`）+ 输入枚举校验；除 symlink 推断面外无实证漏洞。
- 错误语义：CONTRACT §4.1 五码在 `rules.js`/`gate-service.js`/`tools.js` 一致落地；唯一不一致即 R-01（go-no-go 响应形状）。
- 5 条历史 findings：F-01~F-05 **全部核验为已闭环**，证据见 FINDINGS §3；R-01 是 F-02 同类反模式在未被原 findings 覆盖的兄弟分支（go-no-go）中的残留，另立新 finding，不推翻 F-02 本身的闭环结论。
- `node --test` 61/61、12 文件语法 OK、AC1 实机 active —— 主线质量满足交付门槛。

VERDICT 见 `FINDINGS.md` 末行。
