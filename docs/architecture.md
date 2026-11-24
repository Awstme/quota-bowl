# 架构说明

## 目录职责

| 目录 | 放什么 |
| --- | --- |
| `server/src/entrypoints/{web,worker}` | Node.js / TypeScript 进程入口。Web 提供同源 UI 和 API，Worker 独立执行采集。 |
| `server/src/modules/collection` | 采集凭据处理和 CodexBar CLI 适配器。 |
| `server/src/modules/auth` | 管理员密码哈希、本机内存会话、登录限速与 CSRF 防护。 |
| `server/src/platform/httpapi` | REST 接口、静态面板和统一错误响应。 |
| `server/src/platform/config` | 启动参数和采集目标校验。 |
| `server/src/platform/storage/sqlite` | 采集目标、任务队列、凭据、快照历史和版本化迁移。 |
| `web/src/{app,features,lib/api}` | React / TypeScript 应用入口、业务功能、同源 API 客户端。前端使用 TanStack Query 刷新状态，不引入推送连接。 |
| `testdata` | 脱敏或合成的跨模块测试夹具，不存真实凭据或原始上游响应。 |

## MVP 边界

- OpenDesign 首版按**一份 Cookie 配置对应一个工作区**采集，直接使用 CodexBar 的当前工作区口径。同一账号的多个工作区、或多个账号，均分别配置 Cookie；只展示已配置的工作区，不自动发现其他工作区，也不自动切换。同时监控多个工作区时，每项使用独立的本地采集目标 ID。更换同一工作区的 Cookie 不重置历史；复用目标 ID 切换工作区时，旧历史先隐藏，新工作区首次成功采集后才原子替换旧历史。若无法确认结果属于配置中的工作区，不将其写入该目标历史。
- 采集失败保留最后一次成功的值并标旧；没有数据不显示成零。采集默认约每 5 分钟错峰执行，同目标防重，失败有限退避。
- New API 对接与 Linux 部署延后；本次 Web 仅监听本机，不提供对外部署方案。
- 面板新增账号时，SQLite 在同一事务中创建目标、保存明文凭据并安排首次采集。Worker 在领取任务前读取新增目标。账号和历史使用 SQLite 中的目标 ID，已有 ID 保留给原目标和历史。
- 管理员可在面板为现有目标保存或移除采集凭据。Web 将明文写入 SQLite，Worker 在采集时读取。面板接口用 `credentialSource` 表示凭据来源，未配置时返回 `unconfigured`。采集适配器将上游响应转换为额度指标，供持久化和前端展示。OpenCode 仅覆盖 Go。
- Web 读取面板数据、提交采集请求和管理凭据；实际采集在 Worker 完成。租约防止重复提交。凭据切换后的首次采集会等待该目标的在途任务，旧任务的结果不会写入历史。Web 与 Worker 必须使用同一个 SQLite 数据库。API 每个目标返回最近 100 条成功快照。

## 本机验证

用 `npm test` 和合成数据验证登录、采集队列、刷新与历史。接入真实数据时，用同一自有账号的两个工作区分别配置 Cookie 并交替采集，对照官网确认额度和工作区归属。检查一份会话切换工作区或过期是否影响另一份配置。OpenDesign 只接收 CodexBar 返回的上游工作区 ID 与配置完全一致的结果。OpenCode Go 和 Command Code 也需用独立配置确认多账号不串号。
