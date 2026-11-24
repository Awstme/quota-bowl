# 饭量（QuotaBowl）

在本机查看 OpenDesign、OpenCode Go、Command Code 的额度和历史。React 面板、Node.js Web 与独立采集 Worker 共享 SQLite 数据；New API 和 Linux 部署暂不在本次 MVP 范围内。

## 本机使用

需要 Node.js 24.12+。在项目根目录执行：

```sh
npm ci --cache quota-bowl/npm-cache
npm run build
```

用 `codexbar --version` 确认 CLI 版本，当前适配目标是 [CodexBar 0.85.0](https://github.com/steipete/CodexBar/releases/tag/v0.85.0)。两个终端分别启动：

```sh
QUOTA_CODEXBAR=codexbar npm run start:worker
```

```sh
QUOTA_PORT=5555 npm run start:web
```

在浏览器访问 <http://127.0.0.1:5555>。数据库首次初始化管理员账号时，用户名和密码均为 `admin`。用户名、加盐密码哈希、采集目标、采集凭据和历史都保存在 SQLite，默认路径为 `quota-bowl/quota.sqlite`。若使用 `QUOTA_DB` 覆盖，请让两个进程指向同一文件。可用 `QUOTA_PORT` 修改 Web 端口，Web 只监听 `127.0.0.1`。启动变量可以写入仓库根目录的 `.env`，每行一个 `名称=值`，命令行环境变量优先。

从旧版本升级时，如果现有数据库在 `.quota-bowl/`，请先停止 Web 和 Worker，再把数据库及同名 SQLite 辅助文件一起迁到 `quota-bowl/`。

### 新增账号

在首页点击「新增账号」，选择渠道，填写账号名称和凭据后提交。OpenCode Go 和 Command Code 使用 API Key。OpenDesign 使用 Cookie 请求头的值，并需填写工作区 ID。新增账号会自动排队进行首次采集。

### 密钥管理

进入账号详情后，可在「密钥管理」保存新凭据。

SQLite 以明文保存采集凭据，数据库及其备份都应按凭据文件保管。若旧库已有加密凭据，可让 Worker 用 `QUOTA_CREDENTIAL_PRIVATE_KEY_FILE` 指向原私钥，在下次采集时转换为明文，也可以在面板直接更新该目标的凭据。

## 开发入口

| 目录 | 内容 |
| --- | --- |
| `server/src/entrypoints/` | Web 和 Worker 两个进程的启动入口。 |
| `server/src/modules/` | 登录会话、采集凭据和 CodexBar 适配器。 |
| `server/src/platform/` | 启动配置、HTTP API、SQLite 存储和迁移。 |
| `web/src/` | React 面板、业务组件和同源 API 客户端。 |

`npm test` 运行配置、队列、会话及采集适配器测试。目录职责和验证场景见[架构说明](docs/architecture.md)。
