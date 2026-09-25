# 0.1.0 基线验证与交付记录

验证日期：2026-09-25。环境：Linux x64、Node.js 24.15.0、Electron 44.0.0、Harness 0.1.7-rc.2。原仓库仅供只读参考，实现位于 `/home/lsp/dsh-app-server`。

## 已执行检查

| 命令 | 结果与范围 |
| --- | --- |
| `npm test` | 13 项通过；URL/导航/IPC、认证、取消与超时、协议检查、真实 Connection 认证及路由卸载 |
| `npm run prepare:integration` | 打包插件，通过正常 `dsh plugin` 安装到独立 profile |
| `npm run test:integration` | 实际 Harness 启动、认证、GUI HTML、会话、模型回合持久化、bash 工具在 Linux 写入校验文件 |
| `xvfb-run -a node apps/electron/tests/smoke.mjs` | 实际 Electron：错误令牌、不兼容协议、初次加载及运行期 401、隔离、导航/弹窗限制、重连、服务器切换及旧 cookie 隔离 |
| `xvfb-run -a npm run test:electron` | 实际 Electron 与 Harness：GUI 流式消息、Linux 目录浏览、WebSocket 恢复、客户端退出后任务完成、重开客户端恢复历史 |
| `WINEPREFIX=/home/lsp/dsh-app-server/.cache/wine xvfb-run -a npm run build:win` | Windows x64 NSIS 安装包交叉构建成功 |

模型测试使用已发布 Harness 的确定性 mock 模型服务器；真实 Agent、工具、持久化、HTTP RPC、WebSocket 和 GUI 均参与测试。没有调用真实外部模型服务或使用真实模型密钥。

Windows 包中的 `app.asar` 已比对主进程、连接、令牌交换、安全策略、preload 和设置页脚本，与当前源文件一致。截图位于交付目录 `screenshots/`。

## 交付文件

- `artifacts/dsh-app-server-server-0.1.0.tgz`：可安装服务端插件。
- `artifacts/DSH Remote Setup 0.1.0.exe`：Windows x64 客户端安装程序，未配置代码签名。
- `artifacts/dsh-app-server-0.1.0-source.tar.gz`：已提交源码快照，不含依赖、凭据或测试运行数据。
- `artifacts/SHA256SUMS`：上述文件的 SHA-256 校验值。

部署步骤见 [README](../README.md)。服务端与客户端为单操作者实例，不提供多租户隔离。

## 未执行的验收

- 没有原生 Windows 桌面环境：未执行安装/卸载、Windows 客户端连接 Linux、Windows 文件上传与下载的实机验证。Linux Electron 测试和交叉构建不能替代这些检查。
- HTTPS/Caddy、公网证书、SSH 隧道和 systemd 为部署模板；本次 GUI 集成使用 Linux loopback HTTP，没有部署到实际远程网络。
- GitHub Actions 工作流已提供但没有推送或运行；不能描述为 CI 通过。
- 未执行真实模型供应商联网测试。

## Windows 部署前检查

1. 在 Windows 10/11 x64 安装客户端；先比对校验值，未签名应用遵循组织的软件安装政策。
2. 在 Linux 按 README 安装插件，通过 SSH 转发或受信任 HTTPS 地址连接。
3. 验证流式对话、Linux 目录与终端、文件上传/下载、断网恢复、退出客户端后任务继续，以及重新认证后的历史恢复。
4. 更换服务器并确认旧会话不复用，最后验证卸载。这是待执行清单，不是已通过结果。
