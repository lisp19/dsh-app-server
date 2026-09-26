# 开发与验证

需要 Node.js 24。Linux GUI 测试还需要显示服务器或 Xvfb，以及 Electron 所需系统库。从仓库根目录执行：

```bash
npm ci
npm start
npm test
npm run check:repository
npm run licenses:check
npm run scan:secrets
npm run test:smoke --workspace apps/electron
npm run prepare:integration
npm run test:integration
npm run test:electron
```

`check:repository` 检查仓库发布约束，`licenses:check` 检查第三方许可清单。`scan:secrets` 使用固定版本的 Gitleaks 扫描全部可达 Git 历史，需要 Linux x64；扫描前应获取完整历史。

无图形桌面的 Linux 为 GUI 命令添加 `xvfb-run -a`。`prepare:integration` 打包当前插件，通过正常插件安装流程准备 `.integration/installation`。源文件变化后重新准备。集成检查使用隔离的 Harness home、工作区和确定性模型服务，不需要真实模型密钥。

单元检查覆盖连接设置、认证、隔离、密码保存和 SSH 行为。Electron smoke 检查实际桌面窗口。Harness 集成检查覆盖服务端认证、会话、模型回合与工具；Electron 集成检查覆盖 GUI 流式消息、目录浏览、断线恢复及客户端退出后的任务与历史。真实供应商授权和外部网络不由确定性模型测试代表。

## 打包

```bash
npm run pack:server
npm run build:win
npm run build:linux
npm run build:mac
```

按目标平台选择构建命令，并在对应系统与 CPU 架构上原生构建，保证 Electron 运行时与随包版权文件匹配；脚本会拒绝跨平台/架构构建。插件包输出到 `artifacts/`，桌面包输出到 `apps/electron/dist/`。Windows 构建不需要 Wine；macOS 应在对应架构的 Mac 上构建。签名和公证需要单独配置发行凭据。

用 `DSH_ELECTRON_EXECUTABLE` 指定打包后可执行文件，可对包运行 Electron 集成检查。`scripts/experience.mjs` 检查连接页交互与截图；Linux 无显示服务器时同样使用 Xvfb。

## 发布要求

发布前必须通过单元测试、Electron smoke、真实 Harness 集成和目标平台构建；Linux 还应验证打包后的客户端。流水线产物须核对版本、必需文件、manifest 和 SHA-256 摘要。自动化启动不能代替 Windows/macOS 的交互式安装、卸载和真实远程环境检查。执行状态以对应提交的流水线记录为准。

维护流程见 [CONTRIBUTING](../CONTRIBUTING.md)。
