# 仓库贡献指南

## 项目结构

- `server/src/entrypoints/{web,worker}/main.ts` 是两个 Node.js 进程的入口。Web 提供面板和 API，Worker 负责采集额度，两者共用 SQLite 数据库。
- `server/src/modules/` 存放会话和采集逻辑，包括 CodexBar 适配器。`server/src/platform/` 存放 HTTP、配置和 SQLite 代码。修改数据库结构时，在 `server/src/platform/storage/sqlite/migrations/` 中新增按序编号的迁移文件。
- `web/src/app/` 存放 React 入口、共享组件和样式，`web/src/features/` 存放各功能模块，`web/src/lib/api/` 存放同源 API 客户端。合成或脱敏的测试数据放在 `testdata/`。进程职责与验证场景见[架构说明](docs/architecture.md)。

## 构建与本地开发

使用 Node.js 24.12 或更高版本，在仓库根目录执行以下命令。

- `npm ci --cache quota-bowl/npm-cache` 按锁文件安装依赖。
- `npm run build` 将服务端编译到 `dist/server/`，检查前端类型，并用 Vite 将前端打包到 `web/dist/`。
- 本机启动命令见 [README](README.md#本机使用)。验证面板时，用 `QUOTA_DB` 指定独立的临时 SQLite 文件。

## 代码风格与命名

沿用现有的 TypeScript 严格模式。使用两个空格缩进、单引号和语句末尾的分号。函数和变量用 `camelCase`，类型和 React 组件用 `PascalCase`，多词文件名用 `kebab-case`。仅导入类型时用 `import type`，服务端相对导入使用 `.js` 扩展名。构建命令会执行类型检查。

## 测试

运行 `npm test`。测试文件以 `*.test.ts` 命名，放在 `server/src/` 下对应模块旁，由 `tsx` 和 `node:test` 执行，断言使用 `node:assert/strict`。回归测试使用合成数据和临时 SQLite 数据库。项目尚未设置覆盖率门槛。面板改动需在本机验证。

## 提交与拉取请求

建议用简短的动词短语作为提交标题。在拉取请求中说明行为变化和验证结果，有关联议题时附上链接，涉及界面变化时附本机验证截图。接入真实数据请参照 [README](README.md)，凭据和本地数据库应留在本地。
