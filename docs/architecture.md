# 架构

DSH App Server 由 Electron 客户端、本项目认证网关和原生 DSH 插件组成。桌面包不包含 DSH；客户端按连接加载服务器提供的原生 Web GUI。模型、工具、文件、终端和会话持久化均由服务器上的 DSH 执行。

| 目录 | 职责 |
| --- | --- |
| `apps/electron` | 连接页、内存会话、受保护的 loopback HTTP/WebSocket 桥、加密密码保存和 SSH 转发 |
| `packages/server` | 固定密码网关、协议发现及通过公开插件 API 提供原生启动认证 |
| `deploy` | 服务与代理配置模板 |
| `scripts` | 安装所选 npm 渠道、profile 配置、运行时及服务管理 |
| `tests` | 单元、集成、打包和发布检查 |

## 连接与信任边界

客户端用固定密码向网关换取本项目的会话 cookie，检查 `/api/app-server/info` 的产品标识、协议版本 `2` 和平台后加载 GUI。网关会话与原生 DSH cookie 独立。客户端每次连接使用新的内存会话，断开时清理；远程页面启用 sandbox 和 context isolation，不提供 Node 或本地 preload。

GUI 从每次连接专属的客户端 loopback 桥加载，让原生 GUI 使用本机 origin。桥转发 HTTP 和 WebSocket，不改写上游 JavaScript；每个请求须通过主进程注入的随机私有 header 及 Host/origin 校验。上游 cookie 由连接会话提供，不传给渲染页面。

网关执行自己的固定密码认证、Host/origin 校验和内存会话管理，再将请求转发到服务器 loopback 上的原生 DSH。插件调用公开的 `connection.authenticatedUrl`，将启动 URL 写入私有临时文件；运行器通过原生认证交换获得 cookie，仅保存在服务器内存。该链路不读取 DSH 认证私有状态，不修改上游 `node_modules`。

内置 SSH 在客户端创建临时 loopback 转发端口。SSH 主机认证和 app-server 登录互相独立；主机指纹由主进程保存，密码由操作系统加密，私钥内容不持久化。

## 安装与生命周期

安装器解析 npm `@deepseek-ai/dsh` 的 `latest` 或 `next` 标签，通过官方 CLI 的 `--from-default-profile web` 和 `plugin add` 创建全新 profile。渠道由安装选项或本机配置指定，默认 `latest`；配套插件遵循该版本声明的依赖范围。安装目录的 `installation.json` 记录渠道、准确版本、解析时间和安装/profile 锁文件摘要。原生依赖不进入项目根锁文件。

systemd 启动 `scripts/serve.mjs`，由它管理原生 DSH 子进程和网关。原生监听强制为 `127.0.0.1` 动态端口，远程访问只暴露配置的网关地址。缺少必要公开能力或认证失败时，启动失败。

关闭客户端不关闭服务器。客户端不自动同步本机目录，也不提供多租户隔离。升级保留旧配置和 profile，但共享 home 不是数据快照；自定义插件需要人工迁移。更多约束见 [服务管理](server-management.md)、[SSH 连接](ssh-transport.md) 和 [安全说明](../SECURITY.md)。
