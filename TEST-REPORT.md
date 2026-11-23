# TEST-REPORT · engineering-craft DSH 工程流程套件（测试岗交接物）

> 岗位：ec-tester（测试岗）。职责：独立验证研发岗交付代码，**不改任何实现代码**。
> 依据：CONTRACT §4.1 错误语义 / §5 工具约定 / §8 交接物字段 / §9 EcState；PRD §5 AC1~AC10；`.project_memory/conventions/practices.md` 测试纪律。
> 日期：2026-11-23。Node：DSH 自带 bundled Node v24.21.0（PATH 无 node，显式绝对路径）。
> 证据等级：**[实测]**=本轮真实命令输出 / 临时脚本实跑；**[推断]**=基于实测代码逻辑的合理推论，未端到端复现；**[猜测]**=可能性提示，无证据支撑。

---

## 1. 测试代码指针

| 文件 | 来源 | 用例数 | 说明 |
|---|---|---|---|
| `tests/rules.test.js` | 研发岗原有 | 25 | checkGate/nextRole/gatesBetween 基线，未改动一字 |
| `tests/boundary.test.js` | **本次新增** | 31 | 独立边界：四拒绝码分支、nextRole 部分落盘阻塞/严格顺序/全完成、safePathWithin 穿越拒绝、EcState version=1 与字段完整性 |
| `tests/pipeline.test.js` | 研发岗 P0 修复新增 | 4 | create→指针登记→门放行集成链路回归 |

- 新增测试文件：`tests/boundary.test.js`（唯一由测试岗落盘的测试文件）。
- 临时脚本：`_ec_probe.mjs` / `_ec_smoke.mjs` / `_ec_pending_probe.mjs` / `_ec_e2e_final.mjs` 全部**跑完即删**，仓库无残留（实测：`find . -maxdepth 1 -name '_ec_*'` 无输出）。
- 实现代码 9 个 js（index/client/gate-service/rules/tools/command/artifacts/memory/metrics）**零改动**。

## 2. 覆盖率

**实测（全套测试）**：

```
ℹ tests 60
ℹ suites 8
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 140.2003
```

- `node --check` 12 个 js（9 实现 + 3 测试）**全部 OK**。
- `index.js` 动态 import 正常，导出 `Config, apply, inject, statePathOf`。
- **基线复跑结论**：研发岗自述「10 文件语法 OK、25 单测全绿、import 正常」**逐项属实**（实测复跑，未采信自述；当时仓库仅 9 实现 + 1 测试 = 10 文件）。
- **边界覆盖矩阵**（测试名即"条件下应怎样"，断言具体 code/details/状态，不 mock 被测纯函数）：

| 契约点 | 覆盖 | 用例 |
|---|---|---|
| §4.1 MISSING_ARTIFACT | ✅ | 缺交接物优先于未确认，details.missingArtifacts 精确 |
| §4.1 NOT_USER_CONFIRMED | ✅ | confirmedBy≠user（即使 passed=true）；user 但 at=null |
| §4.1 NO_EVIDENCE | ✅ | G3 passed=true 但 evidence=null，且优先于 GATE_NOT_PASSED |
| §4.1 GATE_NOT_PASSED | ✅ | 宽松规则下 passed=false；G3 有证据但 passed=false |
| §4.1 INVALID_INPUT | ✅ | 未知门标识 G9（全函数不抛错） |
| §8 六岗位严格顺序 | ✅ | product→architect→developer→tester→reviewer→ops 逐段落盘断言 |
| §8 上游交接物缺失 | ✅ | architect 仅 adr→blockedBy=contract；reviewer 仅 brief→blockedBy=findings |
| §8 全部完成 | ✅ | role=null 且 blockedBy=all-complete；自定义短 order 表被尊重 |
| §4.1 PATH_OUT_OF_ROOT | ✅ | `..` 父穿越、兄弟目录前缀、非字符串/空串均返回 null；根内相对路径/回环规范化放行 |
| §9 EcState | ✅ | version=1、9 顶层字段、G1/G2=user G3=agent、8 交接物键、plan/pipeline/metrics 初值、statePathOf |

- **功能冒烟覆盖**（临时脚本，tmp 目录，跑完删除）：state.json 落盘/读回、G1/G2 人确认、G3 拒人确认路径+evidence、artifact 模板 create/exists/validate/越界拒绝、memory init/write/来源日期校验/query、metrics record/list、/ec status/next/gate/metrics、四工具 execute（含 AbortSignal 取消）、locale en/zh 23 键一一对应、pendingConfirmOf 全分支。
- **未覆盖**：Client 组件真实渲染 / slot 注册（需浏览器运行时，见 §7 未验证项）。

## 3. 边界异常清单

| 场景 | 输入条件 | 实测行为 | 判定 |
|---|---|---|---|
| 交接物缺失 + 人未确认并存 | G2 缺 adr+contract | 返回 MISSING_ARTIFACT（非 NOT_USER_CONFIRMED） | ✅ 符合"具体优先"语义 |
| 人确认但 confirmedBy=agent | G1 passed=true, confirmedBy='agent' | NOT_USER_CONFIRMED | ✅ 符合 CONTRACT §9 |
| user 确认但无 at | G1 passed=true, at=null | NOT_USER_CONFIRMED | ✅ 时间戳是拍板凭据 |
| G3 有证据但 passed=false | evidence 非空 | GATE_NOT_PASSED | ✅ 落通用未过门码 |
| G3 passed=true 但无证据 | evidence=null | NO_EVIDENCE | ✅ 证据优先 |
| `safePathWithin(join(root,'..','evil.md'))` | 父目录穿越 | null | ✅ 拒绝 |
| `safePathWithin(root+'-evil/PRD.md')` | 兄弟目录前缀 | null | ✅ 拒绝（防字符串前缀误判） |
| `safePathWithin(join(root,'sub','..','PRD.md'))` | 回环到根内 | 返回规范根内路径 | ✅ 合法 normalize |
| `safePathWithin(123/root, '')` | 非字符串/空串 | null | ✅ 防御 |
| 交接物部分落盘 | architect 仅 adr | `{role:null, blockedBy:'contract'}` | ✅ 不跳过双产出岗位 |
| 未知 memory 层 / 未知 metrics action / 非法 PLAN 状态 | 越界枚举 | INVALID_INPUT | ✅ 冒烟实测 |
| state.json 版本不符 | version≠1 | read() 抛 `stateVersion 不匹配` | ✅ 冒烟代码路径核对（推断，未构造坏文件实测） |

## 4. 真实命令与输出（贴末几行）

### 4.1 全套测试（修复后最终复跑）

```
$ node --test tests/*.test.js
...
ℹ tests 60
ℹ suites 8
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 140.2003
```

### 4.2 逐文件语法检查（修复后最终复跑）

```
$ for f in index.js client.js gate-service.js rules.js tools.js command.js artifacts.js memory.js metrics.js tests/rules.test.js tests/boundary.test.js tests/pipeline.test.js; do node --check "$f"; done
OK  index.js
OK  client.js
OK  gate-service.js
OK  rules.js
OK  tools.js
OK  command.js
OK  artifacts.js
OK  memory.js
OK  metrics.js
OK  tests/rules.test.js
OK  tests/boundary.test.js
OK  tests/pipeline.test.js
```

### 4.3 端到端回归（lead 指定路径：create prd → query 无 missing prd → confirm G1 userConfirmed → stage=design）

临时脚本临时目录实跑，**真实输出**：

```
ROOT = <临时目录>\ec-e2e-final-eol8cz
E2E-1 create prd = {"ok":true,"kind":"prd","path":"C:\\...\\ec-e2e-final-eol8cz\\PRD.md","status":"created","missingFields":[]}
E2E-2 prd pointer in EcState = "C:\\...\\ec-e2e-final-eol8cz\\PRD.md"
E2E-3 state.json exists = true
E2E-4 query missingArtifacts = ["adr","contract","plan","brief","release","testReport","findings"]
E2E-4b query G1 gateResult = {"ok":false,"error":{"code":"NOT_USER_CONFIRMED","message":"门 G1 需要人确认，当前确认方=user at=null","details":{"gateId":"G1"}}}
E2E-4c query nextRole = "architect"
E2E-5 confirm G1 userConfirmed = {"ok":true,"version":1,"stage":"design","gates":{"G1":{"passed":true,"confirmedBy":"user","at":1795403667019,...},...},"metrics":{"lastGate":"G1",...},...}
E2E-6 stage after confirm = "design"
E2E-6b gates after confirm = {"G1":true,"G2":false,"G3":false}
E2E-6c nextRole after confirm = "architect"
PC-A  G1 confirmed(at set) -> no G1 card = null
PC-A2 prd landed, G1 not confirmed -> G1 card = {"gate":"G1"}
PC-B  adr+contract landed, G2 not confirmed -> G2 card = {"gate":"G2"}
PC-C  review handoffs landed -> go-no-go card = {"gate":"go-no-go"}
DONE
```

**回归结论**：`create prd` 后 `missingArtifacts` 不再含 `prd`、指针落进 `EcState.artifacts.prd`、`state.json` 落盘；`confirm G1 userConfirmed` 返回**结构化状态对象**（含 stage/gates，非早期裸路径字符串），stage=`design`。pendingConfirmOf 的 G1/G2/go-no-go 三分支均按预期出现。**P0 与两处显示 bug 已闭环**。[实测]

### 4.4 P0 缺陷复现（修复前，存档证据）

修复前同一脚本路径的实测输出（证明缺陷真实存在，非臆测）：

```
E2E-1 create prd = {"ok":true,...,"status":"created",...}
E2E-2 query = {...,"gateResults":{"G1":{"ok":false,"error":{"code":"MISSING_ARTIFACT","message":"门 G1 缺交接物：prd",...}}},"missingArtifacts":["prd",...]}
E2E-3 confirm G1 = {"ok":false,"error":{"code":"MISSING_ARTIFACT","message":"门 G1 缺交接物：prd",...}}
E2E-4 stage after confirm = {"stage":"requirements","gates":{"G1":false,...}}
```

## 5. 证据分级

| 结论 | 等级 | 依据 |
|---|---|---|
| 25 基线单测全绿、9 文件语法 OK、import 正常 | **[实测]** | 本轮复跑命令输出 |
| 新增 31 边界测试全绿、全套 60 绿 | **[实测]** | `node --test` 输出 |
| 四拒绝码分支 / 六岗位顺序 / 路径穿越 / EcState 结构符合契约 | **[实测]** | 边界测试逐条断言具体返回值 |
| 端到端 P0 路径修复后跑通（stage=design） | **[实测]** | §4.3 临时脚本真实输出 |
| pendingConfirmOf 三分支修复后正确 | **[实测]** | §4.3 PC-A/A2/B/C 输出 |
| state.json version≠1 时抛错 | **[推断]** | 代码 L123-125 明确分支，未构造坏文件实测 |
| "根目录内指向外部的符号链接可绕过词法校验" | **[推断]** | safePathWithin 只用 path.resolve/normalize 不做 realpath；Windows 建链需权限，未实测 |
| Client 面板实际渲染 / slot 注册无 crash | **[推断→未验证]** | 静态读 client.js，无浏览器运行时 |

## 6. 发现的问题（findings）

> 格式 `{id, severity, file:line, issue, fix}`。**均按纪律未自行改实现**，交 lead 裁决。前四条已由研发岗修复并经 lead + 测试岗双重复验；第五条为测试岗新发现、待 lead 裁决。

| id | severity | file:line | issue | fix | 状态 |
|---|---|---|---|---|---|
| F-01 | **critical** | `artifacts.js:56-88`（修复前）+ `tools.js:113-116` | `ec_artifact create` 只写模板文件、不登记 `EcState.artifacts` 指针，导致 G1/G2 永远报 `MISSING_ARTIFACT`（AC2/AC4 阻断）。修复前端到端实测：create 后 query 仍含 `missingArtifacts:["prd"]`，confirm G1 失败、stage 停在 requirements | 研发岗在 `artifacts.js` 增 `registerPointer`，`tools.js` 注入 `update` 回调 `ecGate.update(root, patch)`；create/exists 均补登指针 | **已修复并经 lead + tester 复验**（§4.3 真实输出；dev `pipeline.test.js` 含回归） |
| F-02 | **high** | `tools.js`（confirm-gate 分支，修复前） | `confirm-gate` 路径 `{ok:true, ...r.value}`，而 `r.value` 是 state.json 路径字符串 → spread 出无 `stage`/`gates` 字段，dev `pipeline.test.js` 首版 2/4 失败（confirmed.stage=undefined） | 改为返回结构化 EcState 对象 | **已修复并经 lead + tester 复验**（§4.3 E2E-5 返回含 stage/gates/version） |
| F-03 (bug A) | **medium** | `index.js:156`（修复前 `pendingConfirmOf`） | 条件 `!passed && confirmedBy!=='user'` 永假——初始态 `confirmedBy` 恒为 `'user'`（CONTRACT §9），PRD 落盘后 G1 人确认卡永不出现（实测 pendingConfirm=null），AC2/AC7 受损 | 改用 `!gates.G1?.at` 判断人是否已拍板 | **已修复并经 lead + tester 复验**（§4.3 PC-A2 返回 `{"gate":"G1"}`） |
| F-04 (bug B) | **medium** | `index.js:158`（修复前 `pendingConfirmOf`） | go-no-go 要求 `stage==='release'`，但 release 仅在用户批准后才赋值（修复前 L285），决策前 stage 不为 release → go-no-go 确认卡永不出现（实测 pendingConfirm=null），AC7 受损 | 改为按评审交接物齐或 RELEASE.md 落盘判定可见性 | **已修复并经 lead + tester 复验**（§4.3 PC-C 返回 `{"gate":"go-no-go"}`） |
| F-05 | **medium** | `gate-service.js:246` ↔ `client.js:104` | `update()` 写 `state.pipeline.handoffs[patch.artifact]`（键为 `prd`/`adr`/…），而 Client 面板读 `handoffs[key]`（key 为 `product`/`architect`/… 岗位键）→ 交接物落盘后面板六岗位树勾选标记永不点亮（实测：写后 `handoffs.prd` 有值、`handoffs.product` 为 undefined）。影响 AC7 面板岗位树展示 | 建议：写入侧同时维护岗位键映射（product→prd, architect→[adr,contract], developer→plan, tester→testReport, reviewer→[brief,findings], ops→release），或读取侧按 `ARTIFACT_FILES`/岗位输出表反查。**测试岗不改实现，交 lead 决定是否退回研发岗** | **待 lead 裁决**（本轮新发现，未修复） |

## 7. 未验证项

| 项 | 原因 | 影响 |
|---|---|---|
| Client 面板 / 确认卡真实渲染、三个 slot 注册无 crash（AC7/AC8） | 需运行中的 DSH Web GUI 与模块加载器浏览器环境；本测试环境只有 Node v24，无 DOM/React 运行时 | 只做静态代码审阅（读 client.js），未实测 UI。F-05（handoffs 键错位）正是静态+数据层实测发现 |
| AC1 插件管理器可见、无 metadata/icon/detail 诊断 | 需安装 bundle 到 profile 并经 DSH 插件管理器观察 | 属 lead 集成/运维验证范围；测试岗仅验证 `cordis.patch.yml` 单 row + `package.json` dsh.client 声明结构正确（静态核对） |
| 符号链接越界真实绕过 | Windows 建 symlink 需管理员/开发者模式，临时目录未成功建链；`safePathWithin` 不做 realpath（详见 §5 推断） | 路径安全仅验证词法层；符号链接攻击面待安全专项 |
| state.json 损坏版本（version≠1）时抛错 | 冒烟脚本未构造坏文件；代码路径明确但无实测输出 | 标推断，不谎报实测 |
| 端到端 G1→G3→交付全链（AC9/AC10）流水线实证 | 本轮聚焦 G1 回归与边界；三岗位以上真实 subagent 协同由 lead 集成验证 | 测试岗只验证到 G1 门放行 + nextRole 推进逻辑；AC10 依 lead 集成重验 |

---

## 8. 交付结论

- **测试通过数**：60/60（含测试岗新增 31 条边界测试），fail=0，skip=0。
- **P0 回归**：lead 指定的 `create prd → query 无 missing prd → confirm G1 userConfirmed → stage=design` 端到端路径**修复后实测跑通**，真实输出见 §4.3。
- **findings**：5 条 —— F-01~F-04 **已修复并经 lead + tester 复验闭环**；F-05（handoffs 岗位键/交接物键错位，medium）**待 lead 裁决**，测试岗未改实现。
- **纪律自查**：未弱化/跳过/删除任何测试；未 mock 被测纯函数；测试名均含"条件→期望"并断言具体输出；临时脚本全部删除；实现代码零改动。
