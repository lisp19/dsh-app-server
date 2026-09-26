# 开发

需要 Node.js 24。Linux GUI 测试需要显示服务器或 Xvfb，以及 Electron 所需系统库。

## 本地运行

```bash
npm ci
npm start
```

根依赖不包含 DSH。服务端集成测试单独下载上游并创建隔离的 home 和工作区，不使用本机部署数据或真实模型密钥。

## 检查与测试

```bash
npm test
npm run check:repository
npm run licenses:check
npm run scan:secrets
npm run test:smoke --workspace apps/electron
```

`check:repository` 检查元数据、语法和文档链接；`licenses:check` 检查许可清单。`scan:secrets` 使用 Gitleaks 扫描完整 Git 历史，需要 Linux x64 和完整历史记录。

准备上游运行环境，默认使用 `latest`：

```bash
npm run prepare:integration
# 或选择 next
npm run prepare:integration -- --channel next
```

每次准备会创建新安装，并将其设为后续测试的目标。所选渠道、准确版本和锁文件摘要写入安装元数据；修改插件代码后需要重新准备。

```bash
node scripts/verify-upstream.mjs
npm run test:integration
node scripts/ssh-integration.mjs
npm run test:electron
node scripts/compatibility.mjs
```

无图形桌面的 Linux 为 GUI 命令添加 `xvfb-run -a`。

| 检查 | 覆盖范围 |
| --- | --- |
| `verify-upstream.mjs` | 实际加载的关键原生文件与官方 npm 包一致，锁文件摘要一致 |
| `test:integration` | 认证、会话、模型响应、服务端工具 |
| `ssh-integration.mjs` | 客户端 SSH 连接、主机指纹、原生设置和 WebSocket |
| `test:electron` | GUI 流式消息、目录浏览、断线恢复、退出后任务与历史 |
| `compatibility.mjs` | 非回环连接、供应商测试凭据保存、刷新与服务重启后的持久化 |

报告和截图保存在 `artifacts/screenshots/`。测试使用确定性模型和 SSH fixture，不覆盖真实供应商 OAuth、系统 OpenSSH 配置或公网环境。

## 打包

```bash
npm run pack:server
npm run build:win
npm run build:linux
npm run build:mac
```

选择与宿主系统匹配的构建命令。Windows x64、Linux x64、macOS x64/arm64 均在对应平台原生构建；脚本拒绝跨平台、跨架构打包。插件输出到 `artifacts/`，桌面包输出到 `apps/electron/dist/`。签名和公证需要单独配置发行凭据。

Windows `.exe` 使用 Inno Setup；Linux 保留 AppImage 和 deb，macOS 保留 dmg 和 zip。安装器身份、构建工具固定及产物审查要求见 [打包说明](packaging.md)。

用 `DSH_ELECTRON_EXECUTABLE` 指定打包后可执行文件，可对包运行 Electron 集成检查。`scripts/experience.mjs` 检查连接页交互与截图；Linux 无显示服务器时同样使用 Xvfb。

## 持续集成

Actions 在 main 更新、Pull Request 和手动触发时执行依赖审计、许可检查、测试及四个平台构建，每周使用 `latest` 复查上游兼容性。`next` 可通过上述本地命令单独验证。发布流水线还检查 Windows 实际安装、升级、启动和卸载，Linux 打包客户端，以及发布资产的大小和 SHA-256。上游下载或兼容性失败不会自动回退渠道或修改上游源码。

项目依赖和动态安装的原生依赖分别审计。发布步骤见 [CONTRIBUTING](../CONTRIBUTING.md)，许可材料见 [第三方声明](../THIRD_PARTY_NOTICES.md)。
