# 项目层 · engineering-craft-suite

- 定位：DSH 专用工程流程插件套件，把 engineering-craft skill 落地为工具 + 面板 + 命令 + subagent 岗位流水线。
- 目标平台：DeepSeek Harness 0.2.2-rc.5（本机实测）。
- 语言/运行：ESM JavaScript（Node 24 宿主，host 半）+ 浏览器 lazy factory（React via module table，client 半）。
- 依赖策略：零运行时 npm 依赖（用 DSH 注入的 ctx 服务）；测试用 Node 内置 `node:test` + `node --check`。
- 边界：不重实现 DSH 的 tools/commands/subagent/slots；只编排它们。不写用户 profile 的 cordis.patch.yml。
- 来源：主人 2026-11-23 需求 + ADR（工作区 `../engineering-craft-dsh-suite-adr.md`）。
