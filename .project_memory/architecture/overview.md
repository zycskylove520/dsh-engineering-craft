# 架构层 · overview（整体架构）

## 分层（单 bundle，四层）
```
展示层 client.js   → main keyed 面板 / header.actions 入口 / shell.overlay 确认卡
门控层 ecGate      → SessionProjection(EcState) + 门规则 + systemPrompt 注入
能力层 tools/cmds  → ec_stage / ec_artifact / ec_memory / ec_gate_metrics + /ec
底座层 DSH 服务    → ctx.tools / ctx.commands / ctx.sessionProjections / ctx.storage / ctx.slots / ctx.subagents
```
- 数据流（2026-11-23 收敛，推翻早期 wire.view 设想）：门状态按项目落 `projectRoot/.engineering-craft/state.json`；Host `ctx.webServer.register({kind:'prefix',path:'/api/engineering-craft'})` 暴露 state/action；Client `fetch()` 读写、只渲染。来源：ADR §10.5（cordis 带参 inspect 在本环境不可用，改用本机已验证 API）。
- 打包形态（2026-11-23 收敛）：单 host row（id/name 均为 `@local/engineering-craft-suite`）+ `dsh.client` 声明自动挂载 client 半；早期"4 row（ecGate/ecTools/ecPanel/ecCommand）"作废。
- 门规则走 Config（schemastery z.object + volatile，容错加载）；判定纯函数，工具/面板/命令共用同一份。
- skill 是规范源；插件只存规范路径指针 + 门规则，不复制正文。

## 岗位流水线（顺序）
product → architect → developer → tester → reviewer → ops。
- 交接物落盘：PRD / ADR+CONTRACT / 代码+PLAN / 测试+证据 / Brief+findings / 发布清单。
- 只传路径指针；lead 集成重验；G1/G2/go-no-go 由人拍板，G3 由真实命令判定。

## 关键文件（实施后填）
- host/gate-service.js、host/rules.js、host/tools.js、host/command.js、host/artifacts.js
- client/client.js、client/panel.jsx、client/confirm.jsx
