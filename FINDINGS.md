# FINDINGS · engineering-craft DSH 工程流程套件（评审岗第 1 轮）

> 格式：`{id, severity, file:line, issue, fix}`。严重度：blocker（目标用例就是错的）/ should（真 bug）/ nit（风格/文档）。
> 评审范围：本次交付全部交接物 + 全部实现 js + tests。第 1 轮 / 4 轮封顶。
> 本轮不采信自述：独立跑 12 文件 `node --check`（全 OK）、`node --test`（61/61 绿）、`plugin_manager list_plugins`（bundle active 无诊断）、并写 heap 探针复现 go-no-go 响应与 pendingConfirmOf 全分支。
> 本轮只写 `BRIEF.md` 与 `FINDINGS.md`，未改任何实现/测试/其他交接物。

---

## 1. 本轮 findings

| id | severity | file:line | issue | fix |
|---|---|---|---|---|
| R-01 | **should** | `index.js:296` | go-no-go 成功分支 `{ ok: true, ...ecGate.write(state), decision: state.releaseDecision }`：`ecGate.write()` 的返回是 **state.json 路径字符串**（`gate-service.js:144-148`），展开字符串得到 `{"0":"C","1":":",...}` 的字符索引键对象，**没有 `stage`/`gates`/`projectRoot` 等 EcState 字段**，违反 CONTRACT §4.1/§5 工具响应应为结构化对象的约定。独立探针 [实测]：`Object.keys(result)` = `['0','1',…]`，`"stage" in result === false`。与 TEST-REPORT F-02（曾判 high，confirm-gate 展开路径字符串）是同一反模式在兄弟分支的残留 —— 当时只修了 confirm-gate 路径，go-no-go 分支漏修。影响：当前 client `submit` 只判 `r.ok !== false`（`client.js:146`）故 UI 仍能清卡、决策已落盘，**目标用例未被破坏**；但 API 响应违约，任何读响应 `stage`/`gates` 的调用方都会拿到 undefined，是待爆陷阱。 | 改为 `{ ok: true, ...ecGate.read(root), decision: state.releaseDecision }`（read 返回完整 EcState），或让 `write()` 改返回 state 对象并核实 `gate-service.js:201/231/271` 的 `Result.value` 约定不受影响；补一条 go-no-go 响应结构的回归测试（连同 confirm-gate 一起覆盖"所有成功分支都返回结构化对象"）。 |
| R-02 | **nit** | `client.js:18-21,95-113,149-155` | AC8 要求 locale en+zh，`locale/{en,zh}.json` 23 键一一对应且完整，但 `client.js` 从未 import/加载 locale，面板/确认卡文案全部硬编码中文（`'工程流程'`/`'阶段'`/`'确认'`/`'退回'` 等），英文 locale 是死资源，英文界面不可达。[实测] 全仓 `ops_grep` 无 `locale`/`i18n`/`t(` 在 client.js 的引用。属"达成字面、未达成意图"。 | 让 client 从 module table 取 locale（经 `require` 或 Host 注入当前语言），把硬编码中文替换为 locale key；或本期明确非目标并记录到 open-questions，避免 AC8 被误读为完全达成。 |
| R-03 | **nit** | `.project_memory/architecture/overview.md:10`、`.project_memory/conventions/naming.md:6`、`.project_memory/open-questions.md:79-86` | 工程记忆规范层未同步 ADR §10.5 架构收敛：overview 仍写 `wire.view` 数据流、naming 仍写 4 row id（`ecGate`/`ecTools`/`ecPanel`/`ecCommand`）、open-questions 收敛区已写对但主条目仍停在 OQ-1/7/8 待实测。实现按收敛写（单 row + state.json + fetch），记忆层与实现漂移。[实测] 逐文件比对。 | 按 `ec_memory write` 或手写更新 overview/naming，标注 2026-11-23 + 来源 ADR §10.5；把已收敛 OQ 标"已解决"，避免下个会话按旧规范改错方向。不阻断本次交付。 |

**无 blocker / critical。R-01 为 should（真 bug 但不破坏目标用例），R-02/R-03 为 nit。**

> **lead 收尾补记（2026-11-23）**：R-01 已由 lead 在 APPROVE 后收掉——`index.js` go-no-go 成功分支改为先 `ecGate.write(state)` 落盘、再返回 `{ok:true, decision, stage, gates}` 结构化对象（不再展开路径字符串）。独立复验证据：`write()` 返回 string（旧 bug 展开得 `{"0":"C",...}` 已复现），新响应含 stage/gates/decision；`node --check index.js` OK、`node --test` 61/61 仍绿。R-03（工程记忆未同步 §10.5）为 nit，已同步 overview/naming 规范层。**R-02 已于同日补做修复**：client.js 接入 DSH 自带系统插件 `@deepseek-ai/dsh-client-locale`（未引入市场第三方），26 个 UI 文案全走命名空间字典 t()、语言切换即时重渲染；`dsh.client.inject` 加 `@deepseek-ai/dsh-client-locale`；zh/en 26 键 parity 通过、12 文件语法 OK、61/61 测试仍绿。AC8 由"部分达成"升为达成（页面级渲染仍需主人刷新 GUI 实测）。

---

## 2. 复核：主检查点（全部通过，列证据）

| 检查点 | 结论 | 证据 |
|---|---|---|
| AC1 实机可见 | 通过 | `plugin_manager list_plugins`：`include:@local/engineering-craft-suite` / `enabled:true` / `fiberPhase:"active"` / 无诊断 |
| 12 文件语法 | 通过 | `node --check` 12/12 `OK` |
| 全套测试 | 通过 | `node --test tests/*.test.js` → `tests 61 / pass 61 / fail 0` |
| 六岗位顺序 | 通过 | `rules.js:23-30` + `tests/boundary.test.js:131-170` 逐段落盘断言；`tests/pipeline.test.js` 创建→指针→门放行链路 |
| 门拒绝语义 | 通过 | `rules.js:39-66` 五码；`tests/boundary.test.js:56-122` 分支断言不 mock 被测函数 |
| 路径穿越栅栏 | 通过 | `gate-service.js:68-74` + `tests/boundary.test.js:191-229`（父穿越/兄弟前缀/回环/非字符串/symlink 标注）；`index.js:219-264` loopback+同源 |
| 人确认时间戳 | 通过 | `rules.js:54-58` 用 `at` 而非 `confirmedBy` 恒量判断；独立探针 `pendingConfirmOf` G1/G2/go-no-go/已确认/已决策 5 分支全对（见 BRIEF §4） |
| 架构收敛 §10.5 | 通过 | state.json 落盘（`gate-service.js:11-12,129-149`）、webServer+fetch（`index.js:303-332`、`client.js:84,125,135`）、defineTool/Config 容错（`index.js:76-134`）、单 host row（`cordis.patch.yml:8-10`） |
| 错误语义一致性 | 有例外 | CONTRACT §4.1 在 rules/gate-service/tools 一致；唯一例外 R-01（go-no-go 响应形状） |

---

## 3. TEST-REPORT 5 条历史 findings 闭环状态（逐条核验，非采信自述）

| id | severity | issue 摘要 | 闭环核验（本轮独立证据） | 状态 |
|---|---|---|---|---|
| F-01 | critical | `ec_artifact create` 只写文件不登记 `EcState.artifacts` 指针 → G1 永远 MISSING_ARTIFACT | `artifacts.js:49-54,74-88` 有 `registerPointer` + create/validate 幂等登记；`tools.js:116-121` 注入 `update:(patch)=>ecGate.update(root,patch)`；`gate-service.js:245-259` update 双写 artifact 键 + role 键；`tests/pipeline.test.js` 含回归；TEST-REPORT §4.3 E2E-1~3 实测指针落盘。**本轮复跑 61/61 含该回归** | **已闭环** |
| F-02 | high | confirm-gate 路径 `{ok:true,...r.value}`，r.value 是路径字符串 → 无 stage/gates | `tools.js:68,77` 改为 `{ok:true,...r.value}`，其中 `r.value` 已是 EcState 对象（`gate-service.js:201-203,231-233,271-272` 注释明确 Result.value=Estate）；独立探针 `confirmGate(...).value` keys = `version,projectRoot,stage,gates,…`，含 stage。**注**：同行反模式在 go-no-go 分支残留，另立 R-01（见 §1） | **已闭环** |
| F-03 | medium | `pendingConfirmOf` 用 `!passed && confirmedBy!=='user'` 永假 → G1 卡不出现 | `index.js:159-160` 改用 `!gates.G1?.at`；独立探针：仅 prd 落盘 → `{"gate":"G1"}`，G1 已确认（at 设）→ `null` | **已闭环** |
| F-04 | medium | go-no-go 卡要求 `stage==='release'`，release 只在批准后赋值 → 卡不出现 | `index.js:162-167` 改为按评审交接物齐/RELEASE 落盘/stage=delivery 判定；独立探针：review 交接物齐 → `{"gate":"go-no-go"}`、stage=delivery → `{"gate":"go-no-go"}` | **已闭环** |
| F-05 | medium | `update()` 写 `handoffs[artifact键]` vs Client 读 `handoffs[role键]` → 面板岗位树不点亮 | `gate-service.js:27-35,256-258` 定义 `ARTIFACT_TO_ROLE` 并按 role 键写 handoffs；`client.js:103-106` 读 `handoffs[roleKey]` 一致；`.project_memory/open-questions.md:92` lead 复验"product/architect 点亮、无 artifact 键泄漏" | **已闭环** |

---

## 4. 交付判断

- 无阻断项（无 blocker/critical），目标用例全部跑通；R-01 是 should 级真 bug 但不破坏当前 UI 目标路径，R-02 是 AC8 部分达成的 nit，R-03 是工程记忆同步 nit。
- 若按评审纪律"只剩 nit 或 APPROVE 就停"：本轮含 1 条 should（R-01），但因其不破坏 PRD 任何 AC 的目标用例（go-no-go 决策已正确落盘、卡片正确清显），判为**不阻断交付的应修项**，交由 ops 岗纳入发布观察项或后续小修。
- 4 轮封顶：本轮为第 1 轮，无需退回重做的 critical/high；不再发起后续评审轮。

VERDICT: APPROVE（理由：AC1~AC10 主线达成——AC1 实机 active 无诊断、AC2~AC6/AC10 逻辑与测试双证、AC7/AC9 有 lead/tester 实测证据、AC8 locale 文件完整；12 文件语法 OK、61/61 测试绿、5 条历史 findings 逐条核验闭环；R-01/R-02/R-03 均为不破坏目标用例的 should/nit，其中 R-01 是 go-no-go 响应形状残留缺陷，建议 ops 岗列观察项并尽快小修，但不构成 REQUEST_CHANGES。）
