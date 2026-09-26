# Linux 服务管理

需要 Node.js 24、npm、网络访问及用户级 systemd。先按 [README](../README.md) 执行 `npm ci` 和 `npm run pack:server`，无需预先安装 DSH。所有操作使用运行服务的普通用户。

## 安装服务

```bash
mkdir -p "$HOME/.config/dsh-app-server" "$HOME/workspace"
cp deploy/server.example.json "$HOME/.config/dsh-app-server/server.json"
command -v node
pwd
```

编辑配置，将路径替换为实际绝对路径。JSON 不展开 `$HOME` 或 `~`。

| 字段 | 含义 |
| --- | --- |
| `node` | Node.js 24 可执行文件的绝对路径 |
| `home` | 专用 DSH home，保存 profile、凭据和会话 |
| `workspace` | 已存在的工作目录 |
| `profile` | 初始 profile 基础名，例如 `app-server`；安装后写入带代际后缀的名称 |
| `upstreamChannel` | 可选，上游 npm 渠道：`latest`（默认）或 `next` |
| `service` | 用户服务名，例如 `dsh-app-server.service` |
| `commandName` | 可选，生成的管理命令名，默认 `dsh-server`；并行实例可使用 `dsh-server-next` |
| `host` | 网关监听地址：SSH/本机代理用 `127.0.0.1`，受控网络直连用 `0.0.0.0` |
| `port` | 网关固定监听端口，1–65535，例如 `3080` |
| `trustedHosts` | 可选，允许访问网关的域名数组 |
| `passwordFile` | 可选，当前用户拥有且权限为 `600` 的固定密码文件绝对路径 |
| `pluginTarball` | 可选，本项目插件包绝对路径；默认使用 `artifacts/` 中当前项目版本的包 |

`cli`、`installation`、`upstreamVersion` 和 `resolvedAt` 由安装器管理，无需手动填写。不指定 `passwordFile` 时自动创建 `home/.app-server-password` 并复用已有密码。自备文件须包含单行 8–1024 字符密码，无前导空白；末尾空白和换行会被去除。不要把密码写入 JSON 或 Git。

```bash
node scripts/server-control.mjs "$HOME/.config/dsh-app-server/server.json" install
loginctl enable-linger "$USER"
```

`install` 在 `home/.app-server-installations/` 下安装未修改的 DSH，通过官方 CLI 创建 `web` profile 并添加插件。安装目录中的 `installation.json` 保存 `channel`、准确版本、解析时间和锁文件 SHA-256。systemd 运行 `scripts/serve.mjs`，由它管理原生 DSH 和外部网关。

将 `~/.local/bin` 加入 PATH 后可使用 `dsh-server`（或配置的 `commandName`）。`enable-linger` 让用户服务在未登录时运行，系统可能要求管理员授权。仓库、Node 可执行文件、本机配置及安装目录需要保留。多个实例应分别使用独立的配置、服务名、home、端口和命令名。

## 选择上游渠道

渠道优先级：安装命令的 `--channel` > JSON 的 `upstreamChannel` > `latest`。

```bash
dsh-server install --channel next
dsh-server install --channel latest
```

两条命令分别切换到 npm `next` 和 `latest`，并立即安装、重启服务。安装成功后，渠道写入本机 JSON，后续 `dsh-server install` 沿用该选择。渠道不存在或下载失败会报错，不会自动回退。配套原生插件使用所选 DSH 声明的依赖范围，不独立选择渠道。

仅准备运行环境、不配置 systemd 时，也可直接使用安装器：

```bash
node scripts/install-upstream.mjs --directory /absolute/new-installation \
  --home /absolute/dsh-home --profile app-server \
  --plugin /absolute/dsh-app-server-server-1.1.0.tgz --channel next
```

安装目录和 profile 必须尚不存在；插件路径应替换为实际构建的包。`configure-profile.mjs CONFIG [--channel latest|next]` 可为已有配置创建新的安装代际，但不管理 systemd。

## 日常操作与密码

```bash
dsh-server status
dsh-server port
dsh-server logs
dsh-server restart
dsh-server stop
dsh-server start
```

`port` 显示网关配置和实际监听记录；无 LISTEN 行表示未监听。`logs` 显示最近服务日志。客户端登录使用配置指向的固定密码文件内容；在自己的终端读取，不分享密码、完整日志或 profile。原生启动认证凭据不用于客户端登录。

`start`、`restart` 不下载上游，也不接受 `--channel`。只修改 JSON 中的渠道不会改变运行版本，需执行 `install`。修改网关地址、端口或信任域名后重启；移动仓库或 Node 路径需重新生成服务。修改密码文件后重启生效，同时清除网关内存会话。关闭客户端不停止服务器。

## 升级与恢复

升级或切换渠道前停止服务，备份本机 JSON、密码文件、完整 DSH home 和工作区。获取项目版本、执行 `npm ci` 和 `npm run pack:server` 后运行 `install`，它会重新解析所选渠道。

安装器创建全新安装/profile，保存原配置为 `server.json.previous`，保留旧安装和旧 profile，并仅复制旧 profile 的 `cordis.patch.yml` 配置 overlay。此 overlay 是官方配置机制，不是源代码补丁。自定义插件依赖不会自动迁移；应检查 overlay 是否引用未安装插件，通过官方 CLI 将所需插件添加到新 profile 后验证。

新旧版本共享 home，会话、凭据等数据格式可能变化。从较新的 `next` 切回较旧的 `latest` 可能需要数据迁移；两个渠道并不保证版本先后关系。回滚时停止服务，恢复备份的配置、home 和对应应用版本/服务文件，再启动。再次运行 `install` 会下载渠道当时的版本，而非还原旧版。`.previous` 随后续安装更新，不能代替独立备份。

## 网络访问

SSH 推荐网关监听 `127.0.0.1`，客户端填写从 SSH 主机访问的网关根地址。HTTPS 使用专用域名和保留 Host、支持 WebSocket 的反向代理，模板见 [Caddyfile](../deploy/Caddyfile)；将域名写入本机 JSON 的 `trustedHosts`。客户端只接受根地址，证书须受系统信任。

`0.0.0.0` 是监听地址，不是客户端地址。HTTP 直连仅用于可信 LAN/VPN；公网使用 SSH 或 HTTPS。原生 DSH 始终仅监听服务器 loopback，不能直接将其端口暴露到公网。脚本不修改防火墙或路由器规则。
