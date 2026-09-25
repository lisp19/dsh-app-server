# 明日验收入口

## 本机已安装实例

独立仓库：`/home/lsp/dsh-app-server`。Linux 客户端通过 deb 安装，程序为 `/opt/DSH Remote/dsh-remote`，应用菜单名称 DSH Remote。

服务端插件通过正常 `dsh plugin` 安装至专用 profile：`/home/lsp/dsh-app-server/.acceptance/home/profiles/app-server`。工作目录和新建项目目录均位于 `.acceptance/`，不会写入原 Harness 仓库。该目录被 Git 忽略，不随源码上传。

用户服务 `dsh-app-server-acceptance.service` 已配置为随用户服务管理器启动，监听 `127.0.0.1:3080`。此实例没有预置真实模型密钥；可在连接后的 Harness 模型设置中配置自己的供应商凭据。自动化用的 mock 模型与此实例隔离。

```bash
systemctl --user status dsh-app-server-acceptance.service
journalctl --user -u dsh-app-server-acceptance.service -n 100 --no-pager
```

本机日志中有启动链接。将根地址和其中的 `token` 值分别填入客户端，不要将日志或令牌上传到 GitHub。服务端重启后使用新的启动令牌。

在 Windows 上连接此 Linux 主机，保持 SSH 隧道运行：

```powershell
ssh -N -L 3080:127.0.0.1:3080 lsp@<这台Linux主机的SSH地址>
```

客户端填写 `http://127.0.0.1:3080/`。若 Windows 本机端口被占用，改用 `13080`。没有配置公网监听，也没有关闭证书校验。

## 验收顺序

1. 从私有 Releases 下载本机架构的安装包，对照 SHA-256 校验值，按组织安装政策安装。
2. 验证中英文连接页、错误地址/令牌反馈，再连接服务器。
3. 配置真实模型后发送消息，确认流式回复；打开 Linux 工作目录并执行一个仅在该目录写入测试文件的任务。
4. 关闭客户端，确认服务端继续运行；再次连接并检查会话历史。
5. 测试断开/恢复 SSH 隧道和菜单更换服务器；确认需要重新认证。

没有模型密钥时，仍可运行隔离的完整功能测试：

```bash
cd /home/lsp/dsh-app-server
npm run prepare:integration
npm run test:integration
DSH_ELECTRON_EXECUTABLE='/opt/DSH Remote/dsh-remote' xvfb-run -a npm run test:electron
DSH_ELECTRON_EXECUTABLE='/opt/DSH Remote/dsh-remote' xvfb-run -a node scripts/experience.mjs
```

详细结果见 [Linux QA](qa-linux.md)。自动化通过不代表已验证真实模型供应商、真实 Windows/macOS 安装交互或所有上游 GUI 功能。

## 管理与停止

```bash
systemctl --user restart dsh-app-server-acceptance.service
systemctl --user stop dsh-app-server-acceptance.service
```

新版本本地插件更新先运行 `npm run pack:server`，再运行 `node scripts/install-local.mjs`，最后重启服务。安装脚本保留已有 profile overlay 和模型凭据。停止服务不删除 Session；不要删除 `.acceptance/`，除非确定不再需要验收数据。
