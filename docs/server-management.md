# 服务管理

需要 Linux、Node.js 24、用户级 systemd，以及已经安装 app-server 插件的 Harness profile。所有命令以服务所属用户执行，不要使用 `sudo node` 安装用户服务。

## 安装

复制 `deploy/server.example.json` 到仓库外的本机目录，或仓库忽略的 `.acceptance/server.json`。填写 Node 可执行文件、已安装 dsh 的 `lib/bin.js`、`DSH_HOME`、工作目录、profile、服务名称、监听地址和端口。使用绝对路径；`host` 为 `127.0.0.1` 或 `0.0.0.0`，`port` 为 1–65535。端口为固定值，禁止用 0 分配随机端口；正常重启不改变客户端地址。不要在此文件放模型密钥或登录密码明文。

可选的 `passwordFile` 指向本机密码文件：单行、8–1024 个字符，无前导空白，权限为 `600`，末尾空白和换行不属于密码。文件不存在、内容无效或权限过宽时安装/启动失败，不退回随机令牌；停止服务和查询状态不依赖密码文件有效。仓库不提供默认密码；示例中的文件需要由操作者自行创建。省略 `passwordFile` 则继续使用随机启动令牌。不要将密码文件加入 Git。

```bash
node scripts/server-control.mjs /absolute/path/server.json install
loginctl enable-linger "$USER"
```

第二条让用户服务在开机时启动并在退出登录后继续运行；若系统要求管理员授权，由管理员执行 `sudo loginctl enable-linger 用户名`。安装脚本先通过 `configure-profile.mjs` 安装版本固定的兼容补丁，再启用并重启指定服务，写入 `~/.local/bin/dsh-server`。需要仓库依赖已经安装和系统提供 `patch` 命令。将 `~/.local/bin` 加入 PATH，或使用该命令的绝对路径。此快捷命令指向最近安装的配置；多实例可用脚本加配置路径分别管理。

配置所在目录保存生成的 systemd unit、以服务名区分的 `服务名.service.overlay.yml` 及首次替换前的 `.previous` 备份。用户 unit 位于 `~/.config/systemd/user/`。保留仓库、Node 可执行文件和配置目录；移动或升级这些路径后更新 JSON 并重新运行安装命令。安装不修改用户 profile 的 overlay 或凭据。

CLI 的 `--patch` 位于 `--no-open` 之前，由 dsh launcher 读取；overlay 将 `webserver.config.host/port` 设置为本机选定值。没有自建启动器；兼容补丁仅应用于专用 profile 安装的包，不修改原 Harness 仓库。开启全网监听后，上游运行时将本机 IPv4 地址加入 Host 允许列表；自定义 DNS 名称需另行配置 `web-runtime.config.trustedHosts`。

## 日常操作

```bash
dsh-server status
dsh-server port
dsh-server logs
dsh-server restart
dsh-server stop
dsh-server start
```

`port` 同时显示配置地址及 `ss` 查询到的实际监听记录；只有配置行、没有 LISTEN 行代表该端口当前未监听。`logs` 显示最近 100 条日志，其中启动链接可能包含登录密码或随机令牌，仅在自己的终端查看，不要分享完整输出。配置 `passwordFile` 后，重启仍使用同一密码；未配置时才需要获取新令牌。更换密码文件内容后重启生效；已有认证 cookie 的有效期仍由上游管理，更换密码不会撤销所有已登录会话。

系统自带命令也可随时使用：

```bash
ss -ltnp 'sport = :3080'
systemctl --user status dsh-app-server-acceptance.service
systemctl --user is-enabled dsh-app-server-acceptance.service
loginctl show-user "$USER" -p Linger
```

修改端口或监听地址：编辑本机 JSON，再运行 `node scripts/server-control.mjs /absolute/path/server.json install`。仅 `restart` 不会重新生成配置。

## Windows 直连

安装 v0.3.0 或更高版本客户端，填写 `http://服务器的局域网IP:3080/`，密码/Token 单独填写。`0.0.0.0` 是监听地址，不是客户端连接地址。客户端支持 HTTP，但不会跳过 HTTPS 证书验证。v0.4.0 可使用系统加密记住密码，也可使用内置 SSH 传输。

启用固定密码后，在现有客户端的“启动令牌 / Launch token”输入框填写该密码，不需要重装客户端。模型供应商的 API Key 是另一种凭据，请在连接后的模型设置中填写，不能替代登录密码。

## 远程模型设置兼容

上游 `0.1.7-rc.2` 的设置界面仅对 loopback 启用 Host 持久化；LAN 地址会进入 memory 模式并显示 `settings are unavailable in this browser`。`compat/remote-settings.patch` 在专用 profile 中将设置持久化指向已认证的服务端，不更改全局 `isLoopback`、Host/origin 校验或客户端 sandbox。模型提供商目录、配置和凭据仍通过上游的 `remote.settings`、`remote.llm`、`remote.credentials` 操作服务端。

`compat/fixed-login-password.patch` 让同一 profile 从 `DSH_APP_SERVER_PASSWORD_FILE` 指定的文件读取固定登录密码；系统服务只记录文件路径，不把密码放在命令行。认证交换、常量时间比较和签名 cookie 仍由原 Connection 实现负责。

两个补丁只支持已固定的 `0.1.7-rc.2`，由 pnpm `patch` / `patch-commit` 持久保存到本机 profile 的 `patches/` 和 `pnpm-workspace.yaml`，不会直接修改原 Harness 仓库。升级上游时必须重新检查适配。修改前的本机包清单与锁文件保留在 profile 的 `.app-server-backup/`。仅安装插件 tgz 不会自动应用这些部署兼容补丁；请使用本仓库的服务安装脚本。

HTTP 会明文传输令牌、会话和 GUI 中填写的模型密钥，仅用于可信局域网或 VPN。全网监听不等于已开放主机防火墙，也不保证客户端网络可达；安装脚本不修改防火墙规则、不开放路由器端口。互联网访问请使用 HTTPS 或 SSH 隧道。
