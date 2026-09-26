# Linux 服务管理

需要 Node.js 24、用户级 systemd、`patch`，以及按 [README](../README.md) 安装了插件的专用 Harness profile。以下操作均以运行服务的普通用户执行。

## 安装服务

在仓库根目录创建本机配置副本和工作区：

```bash
mkdir -p "$HOME/.config/dsh-app-server" "$HOME/workspace"
cp deploy/server.example.json "$HOME/.config/dsh-app-server/server.json"
command -v node
pwd
```

编辑配置，将示例路径替换为实际绝对路径。JSON 不会展开 `$HOME` 或 `~`。

| 字段 | 含义 |
| --- | --- |
| `node` | `command -v node` 返回的 Node.js 24 可执行文件 |
| `cli` | 本仓库绝对路径下的 `node_modules/@deepseek-ai/dsh/lib/bin.js` |
| `home` | 创建 profile 时使用的 `DSH_HOME` |
| `workspace` | 已存在的工作目录 |
| `profile` | 专用 profile 名称，例如 `app-server` |
| `service` | 用户服务名，例如 `dsh-app-server.service` |
| `host` | `127.0.0.1` 用于 SSH/本机代理；`0.0.0.0` 用于受控网络直连 |
| `port` | 固定监听端口，1–65535，例如 `3080` |
| `passwordFile` | 可选，本机固定密码文件的绝对路径 |

不使用固定密码时删除 `passwordFile` 字段，服务启动时生成随机令牌。使用固定密码时自行创建文件：单行、8–1024 个字符，无前导空白，权限为 `600`；末尾空白和换行不计入密码。不要将密码写入 JSON 或 Git。文件缺失、格式无效或权限过宽会使安装/启动失败。

```bash
node scripts/server-control.mjs "$HOME/.config/dsh-app-server/server.json" install
loginctl enable-linger "$USER"
```

`install` 应用版本固定的兼容补丁、生成监听配置、启用并重启用户服务，写入 `~/.local/bin/dsh-server`。将 `~/.local/bin` 加入 PATH。`enable-linger` 让用户服务在未登录时也能运行；系统可能要求管理员授权。

保留仓库、Node 可执行文件和本机配置目录。移动路径或修改端口、监听地址后，更新 JSON 并重新执行 `install`；仅 `restart` 不会重新生成配置。多实例可分别使用管理脚本和各自配置文件，快捷命令指向最后安装的配置。

## 日常操作

```bash
dsh-server status
dsh-server port
dsh-server logs
dsh-server restart
dsh-server stop
dsh-server start
```

`port` 显示配置及实际监听记录；没有 LISTEN 行表示端口未监听。`logs` 显示最近日志，启动 URL 中可能包含登录令牌或固定密码。仅在自己的终端查看，从中取出 `token` 值填入客户端，不要分享完整输出。固定密码与模型供应商凭据不同。

固定密码更新后重启生效，但不会撤销已经签发的认证 cookie。客户端关闭不停止服务；需要停止服务器时执行 `dsh-server stop`。

## 访问方式与适配

SSH 使用 `127.0.0.1` 监听，客户端服务器 URL 填从 SSH 主机访问的地址。HTTPS 使用专用域名和保留 Host、支持 WebSocket 的反向代理，配置模板见 [Caddyfile](../deploy/Caddyfile)。在 profile 的 `web-runtime.config.trustedHosts` 中加入代理域名，或在手动启动时传递 `--trusted-host harness.example.com`。客户端只接受根地址，证书必须受系统信任。

`0.0.0.0` 是监听地址，不是客户端地址。HTTP 直连仅用于可信 LAN/VPN；公网使用 SSH 或 HTTPS。脚本不会修改防火墙或路由器规则。

`compat/remote-settings.patch` 使远程 GUI 设置持久化到已认证的 Host；`compat/fixed-login-password.patch` 从文件读取可选固定登录密码。补丁仅支持 Harness `0.1.7-rc.2`，通过 pnpm patch 保存到指定 profile，保留首次修改前的包清单与锁文件备份。它们不更改 Host/origin 校验、客户端 sandbox 或原上游仓库。
