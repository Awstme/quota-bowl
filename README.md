# 饭量（QuotaBowl）

查看 OpenDesign、OpenCode Go、Command Code 的额度和历史。Node.js 提供 React 面板并定时采集，数据保存在 SQLite，支持本机运行和 Docker Compose 部署。

## 本机使用

需要 Node.js 24.12+。在项目根目录执行：

```sh
npm ci --cache quota-bowl/npm-cache
npm run build
```

用 `codexbar --version` 确认 CLI 版本，当前适配目标是 [CodexBar 0.85.0](https://github.com/steipete/CodexBar/releases/tag/v0.85.0)。在一个终端启动面板和采集：

```sh
npm start
```

在浏览器访问 <http://127.0.0.1:5555>，按 Ctrl+C 停止面板和采集。数据库首次初始化管理员账号时，用户名和密码均为 `admin`。用户名、加盐密码哈希、采集目标、采集凭据和历史都保存在 SQLite，默认路径为 `quota-bowl/quota.sqlite`。可用 `QUOTA_DB` 修改数据库路径、用 `QUOTA_PORT` 修改端口、用 `QUOTA_CODEXBAR` 指定采集 CLI。Web 默认监听 `127.0.0.1`。启动变量可以写入仓库根目录的 `.env`，每行一个 `名称=值`，命令行环境变量优先。

需要分别启动时，可使用 `npm run start:web` 和 `npm run start:worker`，两者须指向同一个 SQLite 文件。

从旧版本升级时，如果现有数据库在 `.quota-bowl/`，请先停止 Web 和 Worker，再把数据库及同名 SQLite 辅助文件一起迁到 `quota-bowl/`。

### 新增账号

在首页点击「新增账号」，选择渠道，填写账号名称和凭据后提交。OpenCode Go 和 Command Code 使用 API Key。OpenDesign 使用 Cookie 请求头的值，并需填写工作区 ID。新增账号会自动排队进行首次采集。

### 密钥管理

进入账号详情后，可在「密钥管理」保存新凭据。

SQLite 以明文保存采集凭据，数据库及其备份都应按凭据文件保管。若旧库已有加密凭据，可让 Worker 用 `QUOTA_CREDENTIAL_PRIVATE_KEY_FILE` 指向原私钥，在下次采集时转换为明文，也可以在面板直接更新该目标的凭据。

## Docker 部署

需要运行中的 Docker Engine 和 Docker Compose 插件。部署前在项目根目录创建 `data`，并确保容器内的 `node` 用户（UID 1000）能写入该目录。然后启动服务：

```sh
docker compose up -d --build --wait
docker compose logs -f app
```

访问 <http://127.0.0.1:5555>。首次部署用 `admin` / `admin` 登录，在面板填写采集凭据。Compose 将面板发布在宿主机的 `127.0.0.1:5555`。部署在远程主机时，可用 `ssh -N -L 5555:127.0.0.1:5555 user@server` 从本机访问。

一个容器同时运行面板和采集。镜像包含 [CodexBar 0.85.0 Linux CLI](https://github.com/steipete/CodexBar/releases/tag/v0.85.0)，构建支持 `linux/amd64` 和 `linux/arm64`。首次构建需要访问 Docker Hub、npm、Debian 软件包仓库和 GitHub Releases。

Compose 将项目的 `data/` 目录挂载到容器内的 `/data`。数据库保存在宿主机的 `data/quota.sqlite`，停止或重建容器后仍会保留。更新代码后重新执行 `docker compose up -d --build --wait` 即可用原数据启动。

如果要迁入本机的数据库，先停止原来的 Web 和 Worker，用 SQLite `.backup` 生成 `backup.sqlite`。在首次启动容器前执行以下命令。`set -C` 会拒绝覆盖已存在的数据库。

```sh
docker compose build app
docker compose run --rm -T --no-deps app sh -ec 'umask 077; set -C; cat > "$QUOTA_DB"' < backup.sqlite
docker compose up -d --build --wait
```

## 开发入口

| 目录 | 内容 |
| --- | --- |
| `server/src/entrypoints/` | 本机统一启动入口，以及 Web 和 Worker 的独立入口。 |
| `server/src/modules/` | 登录会话、采集凭据和 CodexBar 适配器。 |
| `server/src/platform/` | 启动配置、HTTP API、SQLite 存储和迁移。 |
| `web/src/` | React 面板、业务组件和同源 API 客户端。 |

`npm test` 运行配置、队列、会话及采集适配器测试。目录职责和验证场景见[架构说明](docs/architecture.md)。
