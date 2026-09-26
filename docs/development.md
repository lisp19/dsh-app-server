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
node scripts/verify-upstream.mjs
npm run test:integration
node scripts/ssh-integration.mjs
npm run test:electron
node scripts/compatibility.mjs
```

`check:repository` 检查仓库发布约束，`licenses:check` 检查第三方许可清单。`scan:secrets` 使用固定版本的 Gitleaks 扫描全部可达 Git 历史，需要 Linux x64；扫描前应获取完整历史。

无图形桌面的 Linux 为 GUI 命令添加 `xvfb-run -a`。`prepare:integration` 打包当前插件，在隔离目录解析 npm `@deepseek-ai/dsh@latest`，通过官方 CLI 的默认 `web` profile 和插件安装流程准备原生运行环境。源文件变化后重新准备。安装的 `installation.json` 记录实际版本、解析时间和锁文件摘要；根 `npm ci` 不安装 DSH。集成检查使用隔离的 Harness home、工作区和确定性模型服务，不需要真实模型密钥。

原生安装与 profile 的依赖树独立于根锁文件，应分别检查许可证和安全审计结果。不得用 `next` 或测试用固定版本替代用户选择的 `latest`，也不得通过修改上游包文件来让集成测试通过。安装探针成功只代表安装完成，实际功能结果须对应本次解析的准确版本和候选提交记录。

单元检查覆盖连接设置、认证、隔离、密码保存和 SSH 行为。Electron smoke 检查实际桌面窗口。Harness 集成检查覆盖服务端认证、会话、模型回合与工具；Electron 集成检查覆盖 GUI 流式消息、目录浏览、断线恢复及客户端退出后的任务与历史。真实供应商授权和外部网络不由确定性模型测试代表。

`compatibility.mjs` 使用非回环地址连接真实原生 GUI，验证供应商测试凭据保存、刷新和服务端重启后的持久化。`verify-upstream.mjs` 对照官方 npm 归档校验关键原生包文件及安装锁摘要。验证报告和截图保存到 `artifacts/screenshots/`；Actions 每周重新解析 `latest` 并运行同一组验收，兼容性退化会使流水线失败，而不会自动打补丁或回退旧版本。

## 打包

```bash
npm run pack:server
npm run build:win
npm run build:linux
npm run build:mac
```

按目标平台选择构建命令，并在对应系统与 CPU 架构上原生构建，保证 Electron 运行时与随包版权文件匹配；脚本会拒绝跨平台/架构构建。插件包输出到 `artifacts/`，桌面包输出到 `apps/electron/dist/`。Windows 构建不需要 Wine；macOS 应在对应架构的 Mac 上构建。签名和公证需要单独配置发行凭据。

Windows `.exe` 使用 Inno Setup；Linux 保留 AppImage 和 deb，macOS 保留 dmg 和 zip。安装器身份、构建工具固定及产物审查要求见 [打包说明](packaging.md)。

用 `DSH_ELECTRON_EXECUTABLE` 指定打包后可执行文件，可对包运行 Electron 集成检查。`scripts/experience.mjs` 检查连接页交互与截图；Linux 无显示服务器时同样使用 Xvfb。

## 发布要求

发布前必须通过单元测试、Electron smoke、真实 Harness 集成和目标平台构建；Linux 还应验证打包后的客户端。Windows 须对实际 Inno Setup 安装程序执行静默安装、升级/重装、已安装客户端启动和卸载检查，并确认用户数据保留。仅启动解包目录中的程序不满足安装器检查要求。

流水线产物须核对版本、必需文件、manifest、SHA-256 摘要及最终包内许可文件。自动化检查不能代替交互式安装体验和真实远程环境检查。执行状态以对应提交的流水线记录为准。

维护流程见 [CONTRIBUTING](../CONTRIBUTING.md)。
