# 架构

DSH App Server 由一个 Electron 客户端、一个 Cordis bundle 和部署适配组成。客户端展示服务器提供的 Harness Web GUI，服务器负责模型、工具、文件、终端和会话持久化。

| 目录 | 职责 |
| --- | --- |
| `apps/electron` | 连接页、认证交换、窗口隔离、加密密码保存和 SSH 转发 |
| `packages/server` | 已认证客户端发现、远程目录选择和 GUI 控件适配 |
| `compat` | 固定上游版本的远程设置与固定登录密码补丁 |
| `deploy` | 服务与代理配置模板 |
| `scripts`、`tests` | 部署管理、集成检查、打包和自动化测试 |

## 连接与信任边界

客户端先用启动令牌或固定密码交换 Harness cookie，再检查 `/api/app-server/info` 返回的产品标识、协议版本和平台。认证成功后才加载远程 GUI。每次连接创建新的内存会话，断开时清理；远程页面启用 sandbox 和 context isolation，不提供 Node 或本地 preload。

内置 SSH 在客户端创建临时 loopback 转发端口，HTTP 与 WebSocket 经 SSH 通道访问目标。SSH 主机认证和 app-server 登录互相独立。SSH 信任指纹由客户端主进程保存，密码由操作系统加密；私钥内容不持久化。

服务端插件沿用 Harness 的认证与 Host/origin 校验。兼容补丁只应用于指定 profile，支持 `0.1.7-rc.2`，不修改上游源码仓库。升级上游时必须检查补丁、发现协议和完整 GUI 链路。

## 生命周期与范围

关闭客户端不关闭服务器。常驻任务依赖服务器进程持续运行，由 systemd 等进程管理器负责。客户端不自动同步本机目录，也不提供多租户隔离；一个登录身份拥有对应服务器用户的 Harness 权限。

更多部署约束见 [服务管理](server-management.md)、[SSH 连接](ssh-transport.md) 和 [安全说明](../SECURITY.md)。
