# 0.2.0 发布验收记录

2026-09-25，候选提交 `5030724` 的 [原生构建矩阵](https://github.com/lisp19/dsh-app-server/actions/runs/36166139860) 全部通过：Windows x64、Linux x64、macOS Intel x64、macOS Apple Silicon arm64。各平台运行 15 项测试；Windows/macOS 在打包前后均通过实际 Electron 认证、错误状态、导航隔离、服务器切换和退出行为检查。Linux 使用 apt 安装生成的 deb 后，通过真实 Harness 的完整功能和连接页体验检查。

本机还验证了 AppImage 的 extraction 模式、Linux 服务端工具写文件、模型回合落盘、实时流、目录浏览、断线恢复、关闭客户端后任务继续及重新连接的历史恢复。截图和具体步骤见 [Linux QA](qa-linux.md)。模型使用确定性 fixture；没有使用真实供应商密钥。

发行包包含本项目 MIT 许可证。后续本地安装脚本修正了同版本 tarball 路径缓存：采用内容摘要命名的副本，再交由正常 `dsh plugin` 安装；实际安装后的许可证与源文件比对一致。该修正不改变客户端或服务端插件代码。

## 发布检查

`v0.2.0` 标签的发布工作流再次执行完整原生矩阵。只有全部通过且 8 个必需发行文件齐全、非空、版本一致时才创建 Release；附带 `SHA256SUMS` 和 `release-manifest.json`。最终发布结果以 [Releases](https://github.com/lisp19/dsh-app-server/releases) 和 [发布工作流](https://github.com/lisp19/dsh-app-server/actions/workflows/release.yml) 为准。

`v0.1.0` 保留原始基线代码及产物，不属于多平台验收版本。为历史标签触发的旧 CI 在 Linux Electron 沙箱配置处失败；新工作流显式下载运行时并配置沙箱，Windows 测试同时修复了目录末尾反斜杠的参数转义。请以 0.2.0 作为明日验收版本。GitHub 将基线 Windows 文件名中的空格转换为点，基线校验文件已按实际下载名修正，二进制未更换。

## 环境与限制

- 原 Harness 仓库工作区保持无改动。
- 本仓库 `npm audit` 为零项已知漏洞；不等于独立全局 Harness 安装自动继承相同依赖覆盖。
- Linux 验收服务仅监听 loopback，处于 systemd 用户服务托管；操作方法见 [验收入口](acceptance.md)。
- Windows/macOS 的交互式安装、跨机器真实 SSH/HTTPS 部署、外部模型调用仍由部署环境验收。原生 CI 的打包后启动并不冒充这些结果。
- Windows 无发行者签名；macOS 使用 ad-hoc 签名但没有 Apple notarization。
