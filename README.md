# DSH App Server

独立的 DeepSeek Harness 远程桌面项目：Windows、Linux、macOS Electron 客户端选择服务器地址，Linux 上的 Harness 执行 Agent、模型请求、文件与终端操作，并保存会话。客户端复用服务端提供的完整 Web GUI。退出客户端不会关闭服务器。

本项目不修改原 Harness 仓库。兼容目标为 `@deepseek-ai/dsh@0.1.7-rc.2`；客户端接入协议版本为 `1`。服务端是可安装的 Cordis bundle，客户端是独立 Electron 应用，不是原桌面程序的插件。

当前工作站的服务管理、连接方法和验收顺序见 [验收入口](docs/acceptance.md)。其他机器按下面的标准安装步骤部署。

## Linux 服务端

需要 Node.js 24 和可用的模型配置。先安装指定版本的 Harness 和其插件管理器使用的 pnpm：

```bash
npm install --global @deepseek-ai/dsh@0.1.7-rc.2 pnpm@11.28.0
export DSH_HOME="$HOME/.dsh-app-server"
dsh --profile app-server --from-default-profile web --dump-config
dsh plugin --profile app-server add /absolute/path/dsh-app-server-server-0.2.0.tgz
dsh --profile app-server --no-open --port 3080
```

`--from-default-profile web` 仅用于第一次创建 profile。后续启动不要重复该参数。插件安装会自动将 bundle 加入此 profile。模型 API key 可通过 Harness 配置或服务器进程的 `DEEPSEEK_API_KEY` 提供；不要将模型 API key 填入客户端的启动令牌栏。

启动输出包含 `http://127.0.0.1:3080/?token=...`。客户端分别填写服务器根地址和 `token` 的值。启动令牌在服务端进程重启后改变；客户端每次新连接使用新的内存会话，退出后需要再次输入令牌。只保存服务器地址，不保存令牌或认证 cookie。

### SSH 隧道

Windows PowerShell 中保持此命令运行：

```powershell
ssh -N -L 3080:127.0.0.1:3080 user@linux-server
```

Electron 中填写 `http://127.0.0.1:3080/` 和 Linux 服务端输出的启动令牌。如果本机 3080 被占用，改用 `-L 13080:127.0.0.1:3080`，客户端地址相应改为 `http://127.0.0.1:13080/`。

### HTTPS 直连

在 Linux 上保留 loopback HTTP listener，通过 HTTPS 反向代理暴露一个专用域名：

```bash
dsh --profile app-server --no-open --port 3080 --trusted-host harness.example.com
```

修改 [Caddyfile](deploy/Caddyfile) 中的域名并部署到已有 Caddy。客户端填写 `https://harness.example.com/`。代理必须保留外部 Host，并支持 WebSocket；不要把 Host 改写为 `127.0.0.1:3080`。Caddy 的 [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) 支持这两项。使用有效的系统信任证书，客户端不会跳过证书验证。

只支持根地址，不支持 `/harness/` 等子路径。远程明文 HTTP 地址会被拒绝；HTTP 只允许明确的 loopback 地址。不要使用 `dsh web --host 0.0.0.0`，该参数在此 Harness 版本中被拒绝。

需要常驻运行时，参考 [systemd 用户服务](deploy/dsh-app-server.service)。启动、安装插件和运行服务必须使用同一个账户和 `DSH_HOME`。关闭 SSH 登录终端可能结束前台服务；客户端独立生命周期不替代服务器进程托管。

## Electron 客户端

从私有仓库的 [Releases](https://github.com/lisp19/dsh-app-server/releases) 下载对应系统安装包和服务端插件，需登录获授权的 GitHub 账户。校验 `SHA256SUMS` 后安装；版本历史见 [CHANGELOG](CHANGELOG.md)。

| 系统 | 架构 | 安装格式 |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe` |
| Linux | x64 | `.AppImage`、`.deb` |
| macOS | Intel x64、Apple Silicon arm64 | `.dmg`、`.zip` |

安装包未配置发行者签名，macOS 仅作本地 ad-hoc 签名、未 notarize。遵循系统提示与组织的软件安装政策，不要关闭系统安全防护。Linux deb 使用 `sudo apt install ./dsh-remote-0.2.0-linux-x64.deb`，安装后从应用菜单启动 DSH Remote。

AppImage 下载后先执行 `chmod +x dsh-remote-0.2.0-linux-x64.AppImage`，再运行该文件。没有 FUSE 时可用 `APPIMAGE_EXTRACT_AND_RUN=1 ./dsh-remote-0.2.0-linux-x64.AppImage`；本项目验证了 extraction 模式，不要求禁用 Electron sandbox。

Windows 安装包构建命令：

```powershell
npm ci
npm run build:win
```

Linux 构建运行 `npm run build:linux`；macOS 在对应架构的 Mac 上运行 `npm run build:mac`。产物位于 `apps/electron/dist/`，文件名带版本、系统和架构。平台构建采用 [Electron Builder 的多平台方式](https://www.electron.build/docs/features/multi-platform-build/)。开发运行：

```bash
npm ci
npm start
```

连接页可切换中英文。选择服务器、输入启动令牌后连接。菜单中的“更换服务器”或“断开连接”返回连接页；切换服务器会清除旧连接的认证与浏览器存储。网络短暂中断时使用原 GUI 的自动恢复机制；认证失效后返回连接页重新输入令牌。

远程页面在 Electron sandbox 中运行，禁用 Node 集成，不加载本地 preload。连接页的 IPC 仅允许本地页面的主 frame 调用。文件上传由用户在客户端选择文件，工作区文件浏览和终端操作发生在 Linux。

## 开发与验证

```bash
npm ci
npm test
npm run prepare:integration
npm run test:integration
npm run test:electron
```

无图形桌面的 Linux 使用 `xvfb-run -a npm run test:electron`。`prepare:integration` 打包当前插件，通过正常 `dsh plugin` 安装到 `.integration/installation`。集成检查创建隔离的 Harness home、工作目录与确定性模型服务，不需要真实模型密钥；若源代码与安装包不同，会要求重新准备。

```bash
npm run pack:server
npm run build:win
```

插件包输出到 `artifacts/`。Linux 交叉构建 NSIS 安装包需要 Wine；Windows 本机构建不需要。当前验收证据见 [发布验收记录](docs/release-verification.md) 和 [Linux QA](docs/qa-linux.md)，0.1.0 基线记录见 [verification.md](docs/verification.md)。维护与发布方法见 [CONTRIBUTING](CONTRIBUTING.md)。

## 范围与限制

- 一台 Host 对应一个操作者的 Harness 权限范围，不提供多租户隔离。
- 服务器拥有会话、配置、工作区和任务；客户端不自动同步 Windows 项目目录。
- 浏览器自动化等工具仍由 Linux 插件提供，不借用 Windows 桌面程序的私有浏览器桥接。
- 原桌面程序的本机运行时安装、主机更新和账号嵌入窗口不包含在该轻量客户端中。优先使用服务端配置的模型 API key。
- 客户端限制跨源页面请求和新窗口，外部网站浏览、弹窗登录等功能不作为此版本的完整桌面集成承诺。
- 原 Harness 的模型供应商、系统工具和插件自身限制仍然适用。

目录：`packages/server` 为 Cordis 插件，`apps/electron` 为客户端，`scripts` 为可重复验证，`deploy` 为部署模板。设计与验收要求见 [design.md](docs/design.md)。
