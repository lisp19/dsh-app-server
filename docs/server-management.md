# 服务管理

需要 Linux、Node.js 24、用户级 systemd，以及已经安装 app-server 插件的 Harness profile。所有命令以服务所属用户执行，不要使用 `sudo node` 安装用户服务。

## 安装

复制 `deploy/server.example.json` 到仓库外的本机目录，或仓库忽略的 `.acceptance/server.json`。填写 Node 可执行文件、已安装 dsh 的 `lib/bin.js`、`DSH_HOME`、工作目录、profile、服务名称、监听地址和端口。使用绝对路径；`host` 为 `127.0.0.1` 或 `0.0.0.0`，`port` 为 1–65535。不要在此文件放模型密钥或启动令牌。

```bash
node scripts/server-control.mjs /absolute/path/server.json install
loginctl enable-linger "$USER"
```

第二条让用户服务在开机时启动并在退出登录后继续运行；若系统要求管理员授权，由管理员执行 `sudo loginctl enable-linger 用户名`。安装脚本启用并重启指定服务，写入 `~/.local/bin/dsh-server`。将 `~/.local/bin` 加入 PATH，或使用该命令的绝对路径。此快捷命令指向最近安装的配置；多实例可用脚本加配置路径分别管理。

配置所在目录保存生成的 systemd unit、以服务名区分的 `服务名.service.overlay.yml` 及首次替换前的 `.previous` 备份。用户 unit 位于 `~/.config/systemd/user/`。保留仓库、Node 可执行文件和配置目录；移动或升级这些路径后更新 JSON 并重新运行安装命令。安装不修改用户 profile 的 overlay 或凭据。

CLI 的 `--patch` 位于 `--no-open` 之前，由 dsh launcher 读取；overlay 将 `webserver.config.host/port` 设置为本机选定值。没有自建启动器，也没有修改 Harness 包。开启全网监听后，上游运行时将本机 IPv4 地址加入 Host 允许列表；自定义 DNS 名称需另行配置 `web-runtime.config.trustedHosts`。

## 日常操作

```bash
dsh-server status
dsh-server port
dsh-server logs
dsh-server restart
dsh-server stop
dsh-server start
```

`port` 同时显示配置地址及 `ss` 查询到的实际监听记录；只有配置行、没有 LISTEN 行代表该端口当前未监听。`logs` 显示最近 100 条日志，其中包含启动令牌，仅在自己的终端查看，不要分享完整输出。重启后使用最新令牌。

系统自带命令也可随时使用：

```bash
ss -ltnp 'sport = :3080'
systemctl --user status dsh-app-server-acceptance.service
systemctl --user is-enabled dsh-app-server-acceptance.service
loginctl show-user "$USER" -p Linger
```

修改端口或监听地址：编辑本机 JSON，再运行 `node scripts/server-control.mjs /absolute/path/server.json install`。仅 `restart` 不会重新生成配置。

## Windows 直连

安装 v0.3.0 或更高版本客户端，填写 `http://服务器的局域网IP:3080/`，Token 单独填写。`0.0.0.0` 是监听地址，不是客户端连接地址。客户端支持 HTTP，但不会跳过 HTTPS 证书验证，且仍不保存令牌。

HTTP 会明文传输令牌、会话和 GUI 中填写的模型密钥，仅用于可信局域网或 VPN。全网监听不等于已开放主机防火墙，也不保证客户端网络可达；安装脚本不修改防火墙规则、不开放路由器端口。互联网访问请使用 HTTPS 或 SSH 隧道。
