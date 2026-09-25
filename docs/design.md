# DSH App Server 设计

## 目标与范围

独立项目为 Linux 上的 DeepSeek Harness 提供 app-server 插件组合，并提供可指定服务器地址的 Windows Electron 客户端。原仓库 `/home/lsp/deepseek-harness` 仅作为只读参考；实现、依赖安装、生成文件、测试数据和打包产物均位于新仓库或新仓库专用临时目录。不得向原仓库写入文件或在那里运行可能生成产物的命令。

本项目针对当前参考版本 `0.1.7-rc.2` 验证兼容性。原 Electron 主进程直接启动本机 Host，没有插件级远程 Host 替换接口，因此本项目交付独立 Electron 应用，并复用服务端提供的完整 Harness Web GUI。

## 组成

- `packages/server`：可安装的 Cordis 插件与 `dsh.bundle` 配置补丁，组合在 Harness base 和 Web bundle 之后。服务端仍由 `dsh` profile 启动。
- `apps/electron`：独立 Electron 应用，提供本地连接设置页和隔离的远程应用窗口，不启动 Harness 子进程。
- `deploy`：专用 profile 的安装步骤、HTTPS 反向代理示例和 Linux 服务管理示例。
- `tests`：新仓库内的验证代码与隔离运行数据。

服务端插件为客户端提供经过现有 Connection 认证的协议版本和运行环境信息。客户端在显示工作区前确认对端确实提供 app-server 插件及兼容协议；版本不匹配或插件缺失时返回连接页并显示原因。

## GUI 与数据流

用户在 Electron 连接页填写服务器根地址和该服务端签发的启动 token。客户端使用独立会话分区完成现有根页面 token 换 cookie 流程，再加载服务端提供的 HTML、客户端插件和静态资源。HTTP RPC 与 WebSocket 流继续使用 Harness 现有协议和连接恢复能力，不复制 Agent API 或重建聊天界面。

客户端保存服务器地址；启动 token 不写入明文配置。是否已认证以服务端响应为准，过期凭据必须重新输入。连接失败可以重试或修改地址，切换服务器必须隔离此前的认证状态。诊断不得记录 token、cookie 或带 token 的完整 URL。

加载服务器端 GUI 可使页面和 Host 插件来自同一安装版本，避免客户端随包 GUI 与服务器插件不匹配。app-server 协议版本负责检测独立客户端与服务端接入协议的兼容性。

## 服务端部署

默认保持 Harness HTTP Host 监听 Linux loopback。远程使用支持两种方式：HTTPS 反向代理到该 Host，或用户建立 SSH 本地转发后使用 loopback HTTP 地址。HTTPS 代理必须转发 WebSocket upgrade，保留浏览器看到的 Host；该 authority 通过 profile 配置加入 Connection 的 trustedHosts。HTTPS 终止由部署代理负责，客户端保持正常证书校验。

插件组合固定使用页面内目录浏览器，使作为系统服务运行的 Linux Host 不依赖桌面会话。目录和文件路径指向 Linux。服务器上的 Agent、模型 API 调用、终端、工具和 Session 存储保持正常 Harness 所有权。

这是一位操作者的远程 Harness 实例，不增加多租户用户隔离。现有 Connection 的 Host/Origin 检查和浏览器会话认证继续生效；插件新增端点必须经过同一认证。

## Electron 隔离与生命周期

远程页面禁用 Node 集成，启用 contextIsolation 和 sandbox，不暴露本地设置页的 IPC。连接页 IPC 校验发送窗口和页面来源。顶层导航限制在已选择的服务端应用范围；外部链接按明确的协议白名单处理，不允许远程页面自行创建具备本机权限的窗口或绕过证书验证。

关闭或退出 Electron 只关闭本地窗口与连接，不发送 Host shutdown 或停止任务。客户端重新连接通过现有 Session API 获取状态。原桌面程序特有的本地 Host 管理、捆绑运行时安装、自动更新与本机浏览器桥接不作为远程 Host 能力假冒提供。

## 错误处理

连接页分别呈现地址格式错误、非安全远程 HTTP、网络不可达、证书失败、认证失败、服务端插件缺失和协议版本不兼容。工作区内短暂断网使用原 GUI 的恢复机制；需要重新认证或切换服务器时回到本地连接页。中文和英文连接页文案集中管理。

## 验收证据

1. 新项目能独立安装、构建，产出可安装的服务端插件包和 Windows Electron 打包配置。
2. 通过正常 `dsh` profile 加载打包后的插件；未认证请求被拒绝，认证后能读取 app-server 协议信息。
3. Electron 指定服务器地址后显示真实 Harness GUI，能创建会话、发送消息并接收流式输出。
4. 文件操作和命令执行产生可检查的 Linux 端结果；Windows 客户端不启动本地 Harness。
5. 退出客户端后 Linux Host 与正在运行的任务继续存在；重新连接能读取会话状态。
6. 错误凭据、缺失插件、协议不兼容、断网恢复、服务器切换与远程页面权限隔离有对应验证。
7. Windows 安装包构建与 Windows 实机运行分别记录证据；Linux Electron 检查不能替代 Windows 实机验证。
8. 原仓库工作区状态与开始时一致。

模型相关验证优先使用真实 Harness 运行链与确定性模型 fixture，实际外部模型验证需使用可用的部署凭据。所有验证报告区分已执行结果与因环境缺失尚未执行的项目。
