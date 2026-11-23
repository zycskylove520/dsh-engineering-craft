# 规范层 · practices（使用习惯与约定）

- 公开 API（导出函数/类/类型）必须 TSDoc：用途、参数、返回、异常/边界。
- 函数体内逻辑注释克制，只写"为什么"；类型已表达的不重复。
- 错误处理：可恢复用返回联合/Result，不可恢复 throw；边界转换领域错误；禁止空 catch、禁止静默吞错。
- 测试：Node 内置 `node:test`；TDD 先红后绿；mock 只隔离外部依赖，不 mock 被测对象；证据分级（实测/推断/猜测）。
- 验证闭环：改前跑基线 → 改后跑同一命令 → 读完整报错 → 窄检过再全套 → 贴命令+输出。
- 目录：host/ 与 client/ 分离；client factory 无副作用，资源在 apply 内注册并清理。
- 安全：工具输入不可信、边界校验；路径规范化 + 白名单根防穿越；不硬编码密钥。
- 来源：engineering-craft core/coding-standards.md、verification.md、testing-strategy.md、topics/security.md（2026-11-23）。
