# 验收入口

## 本机已安装实例

独立仓库：`/home/lsp/dsh-app-server`。Linux 客户端通过 deb 安装，程序为 `/opt/DSH Remote/dsh-remote`，应用菜单名称 DSH Remote。

服务端插件通过正常 `dsh plugin` 安装至专用 profile：`/home/lsp/dsh-app-server/.acceptance/home/profiles/app-server`。工作目录和新建项目目录均位于 `.acceptance/`，不会写入原 Harness 仓库。该目录被 Git 忽略，不随源码上传。

用户服务 `dsh-app-server-acceptance.service` 已启用，用户 Linger 已开启，监听 `0.0.0.0:3080`。本机配置保存在忽略的 `.acceptance/server.json`，管理脚本和操作方法见 [服务管理](server-management.md)。此实例没有预置真实模型密钥；可在连接后的 Harness 模型设置中配置自己的供应商凭据。自动化用的 mock 模型与此实例隔离。

```bash
systemctl --user status dsh-app-server-acceptance.service
journalctl --user -u dsh-app-server-acceptance.service -n 100 --no-pager
ss -ltnp 'sport = :3080'
```

本机日志中有启动链接。将根地址和其中的 `token` 值分别填入客户端，不要将日志或令牌上传到 GitHub。服务端重启后使用新的启动令牌。

Windows 安装 v0.3.0 Release 的 `dsh-remote-0.3.0-win-x64.exe` 后，可在可信局域网或 VPN 中直接填写 `http://这台Linux主机的局域网IP:3080/`，Token 单独输入。HTTP 不加密令牌、会话或 GUI 中输入的模型密钥；不要向公网暴露端口。旧版 v0.2.0 不支持远程 HTTP。本版按用户要求未运行自动化测试，不能将此前 Linux QA 记录当作本版测试结果。

也可继续使用 SSH 隧道：

```powershell
ssh -N -L 3080:127.0.0.1:3080 lsp@<这台Linux主机的SSH地址>
```

客户端填写 `http://127.0.0.1:3080/`。若 Windows 本机端口被占用，改用 `13080`。本机已配置全 IPv4 接口监听，但没有修改防火墙或路由器端口映射，也没有关闭证书校验。

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

快捷命令位于 `~/.local/bin/dsh-server`：`dsh-server status`、`dsh-server port`、`dsh-server logs`、`dsh-server restart`。若当前 shell 找不到命令，使用绝对路径或将 `~/.local/bin` 加入 PATH。

新版本本地插件更新先运行 `npm run pack:server`，再运行 `node scripts/install-local.mjs`，最后重启服务。安装脚本保留已有 profile overlay 和模型凭据。停止服务不删除 Session；不要删除 `.acceptance/`，除非确定不再需要验收数据。
