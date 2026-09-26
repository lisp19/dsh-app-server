# DSH App Server

在 Windows、Linux 或 macOS 上使用 Electron 客户端，连接运行在 Linux 服务器上的 DeepSeek Harness。模型请求、Agent、终端、文件操作和会话存储都在服务器执行；关闭客户端后，服务器和任务继续运行。

本项目是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立社区项目，复用其 Web GUI、认证和运行时。感谢 DeepSeek Harness 及其贡献者；本项目不代表 DeepSeek 官方。支持的上游版本为 `@deepseek-ai/dsh@0.1.7-rc.2`，客户端发现协议为 `1`。

## 下载客户端

从 [Releases](https://github.com/lisp19/dsh-app-server/releases) 下载安装包，并核对随版本提供的 `SHA256SUMS`。

| 系统 | 架构 | 格式 |
| --- | --- | --- |
| Windows | x64 | `.exe`（Inno Setup 安装程序） |
| Linux | x64 | `.AppImage`、`.deb` |
| macOS | x64、arm64 | `.dmg`、`.zip` |

安装包未配置发行者签名，macOS 使用 ad-hoc 签名且未经公证。请遵循系统提示和组织的软件安装政策。

从 Windows v0.x 升级时，先退出客户端并卸载旧版 NSIS 安装，再安装 v1.0.0。卸载时保留用户数据；新旧安装器使用不同的安装标识。v1.0 起使用稳定的 Inno Setup 标识进行后续升级。打包方式和验证要求见 [打包说明](docs/packaging.md)。

## 安装 Linux 服务端

需要 Node.js 24、Git 和 `patch`；常驻运行还需要用户级 systemd。以下命令以运行服务的普通用户执行：

```bash
git clone https://github.com/lisp19/dsh-app-server.git
cd dsh-app-server
git checkout v1.0.0
npm ci
npm run pack:server
export DSH_HOME="$HOME/.dsh-app-server"
npm exec -- dsh --profile app-server --from-default-profile web --dump-config
npm exec -- dsh plugin --profile app-server add "$PWD/artifacts/dsh-app-server-server-1.0.0.tgz"
```

`--from-default-profile web` 仅用于第一次创建 profile。接着按 [服务管理](docs/server-management.md) 创建本机配置并安装用户服务；该步骤会应用远程模型设置和可选固定密码的兼容补丁。单独安装插件不包含这两项部署适配。

安装、启动和管理服务必须使用同一个用户、`DSH_HOME` 和 profile。上游升级需要重新验证兼容性。

## 连接与使用

推荐选择客户端内置的 SSH 传输：填写 SSH 主机、用户名及密码或私钥，核对首次连接的主机指纹；服务器 URL 填写从 SSH 主机访问的地址，例如 `http://127.0.0.1:3080/`。另行填写 app-server 的启动令牌或固定密码。详见 [SSH 连接](docs/ssh-transport.md)。

也可以使用 HTTPS 根地址直连。反向代理须保留外部 Host 并支持 WebSocket，服务端须信任该域名；模板见 [Caddyfile](deploy/Caddyfile)。不支持 `/harness/` 等子路径。HTTP 直连会明文传输令牌、会话和模型凭据，仅适用于可信局域网或 VPN。

连接后，在 Harness 的模型设置中配置供应商与凭据。模型凭据与客户端登录密码是不同的认证信息。连接页支持中英文；勾选“记住密码”后，密码使用操作系统加密保存，认证 cookie 不落盘。Linux 需要可用的安全密钥环。

服务器拥有工作区和会话，客户端不自动同步本机项目目录。本项目面向单操作者，不提供多租户隔离；服务端权限包括文件读写和命令执行。

## 开发与许可

开发、测试和打包方法见 [开发指南](docs/development.md)，模块与信任边界见 [架构](docs/architecture.md)。参与贡献请阅读 [CONTRIBUTING](CONTRIBUTING.md)，安全问题见 [SECURITY](SECURITY.md)，版本变化见 [CHANGELOG](CHANGELOG.md)。

本项目自有代码采用 [MIT License](LICENSE)。DeepSeek Harness、Electron 和其他依赖保留各自许可证；归属及随包许可说明见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
