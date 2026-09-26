# 打包与安装器

发布格式保持为 Windows x64 `.exe`、Linux x64 AppImage/deb，以及 macOS x64/arm64 dmg/zip。构建在对应系统与架构原生执行，以便核对实际 Electron 运行时及其随包许可证。

## Windows

Windows 使用 Inno Setup，将 Electron 应用目录封装为可安装、升级和卸载的 `.exe`。设计参考 VS Code 官方仓库的 [Inno Setup 脚本](https://github.com/microsoft/vscode/blob/main/build/win32/code.iss) 和 [Windows 构建任务](https://github.com/microsoft/vscode/blob/main/build/gulpfile.vscode.win32.ts)。本项目维护适合自身应用的独立脚本，固定编译器版本并核验下载完整性。

安装标识在 v1.0 及后续版本中保持稳定。v0.x 的 NSIS 安装使用另一套标识，迁移时先退出并卸载旧版，再安装新版，保留应用用户数据。不能把新安装器的覆盖安装等同于对旧版 NSIS 的自动迁移。

Windows 发布检查须执行实际安装器的静默安装、升级/重装、已安装应用启动与卸载，确认程序、快捷方式和卸载注册清理，同时保留用户数据。这些是发布门槛；通过与否以候选提交的原生 Windows 检查记录为准。

## Linux

AppImage 使用对固定版本打包工具的受控适配，检查预期文件与内容后移除六个旧版 GPL/LGPL 库及自动添加 `--no-sandbox` 的启动行为。工具版本或内容变化必须失败并要求重新审查，不能悄然套用旧适配。Electron sandbox 应保持启用；宿主系统需要满足其运行条件。

该处理不代表整个 AppImage 或 Electron 运行时都采用 MIT。发布前仍须检查最终 AppImage 的实际文件、启动行为、运行时与随包许可；deb 同样需要最终包检查。

AppImage 运行时包含有独立许可条件的代码，其中 libappimage 的 `light_elf.h` 带有 GPL-2.0-only 声明。发布同时提供 AppImageKit、libappimage、squashfuse 和 XZ 四份对应源码 `.tar.gz`，并提供 [appimage-runtime-sources.json](../licenses/appimage-runtime-sources.json)，记录运行时摘要、源码版本、下载地址、摘要和许可依据。移除旧版桌面库不改变这些运行时代码的许可证。

禁止无特权用户命名空间的 Linux 安全策略可能阻止直接启动 AppImage；这种情况下优先安装 deb，不要添加 `--no-sandbox`。CI 在隔离目录提取 AppImage、配置 setuid sandbox helper 后验证 AppRun；这不代表已验证每种发行版的 FUSE 和用户命名空间策略。

## 许可证与验收

本项目自有代码采用 MIT。Inno Setup、Electron、Chromium、AppImage 运行时和其他随包组件各自保留原有许可证。构建工具的许可证、构建中生成或复制的代码、最终运行时文件需要分别核对，不能仅依据 npm 依赖分类判断是否分发。

许可材料见 [第三方声明](../THIRD_PARTY_NOTICES.md)。构建命令和功能检查见 [开发指南](development.md)。未经最终产物审查和原生平台检查，不应宣称发布已完成。

## 发布资产

`scripts/release-assets.mjs` 要求完整的 16 项资产：7 个桌面安装/分发包、1 个服务端插件包、4 个 AppImage 运行时源码包，以及 `LICENSE.txt`、`THIRD_PARTY_NOTICES.txt`、`npm-inventory.json` 和 `appimage-runtime-sources.json`。任何必需文件缺失或为空都会阻止生成发布清单。

发布流程另生成 `SHA256SUMS` 和 `release-manifest.json`，记录上述 16 项资产的摘要，manifest 还记录大小。AppImage 对应源码与运行时清单同样纳入校验；转发或镜像发布时应保留这些源码及许可材料。
