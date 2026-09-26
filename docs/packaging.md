# 打包与安装器

支持 Windows x64 `.exe`、Linux x64 AppImage/deb，以及 macOS x64/arm64 dmg/zip。构建在对应系统与架构原生执行。

## Windows

Windows 使用 Inno Setup 封装 Electron 应用目录，支持安装、升级和卸载。编译器版本及下载摘要固定在许可清单中。参考：[VS Code Inno Setup 脚本](https://github.com/microsoft/vscode/blob/main/build/win32/code.iss)、[Windows 构建任务](https://github.com/microsoft/vscode/blob/main/build/gulpfile.vscode.win32.ts)。

v1.0 起使用稳定的 Inno Setup 安装标识。v0.x 的 NSIS 安装标识不同，迁移时先退出并卸载旧版，再安装新版，保留应用用户数据。

Windows CI 使用实际安装器检查静默安装、升级/重装、已安装应用启动、卸载及用户数据保留。

## Linux

AppImage 打包适配固定版本的构建工具，不附带其六个旧版桌面库，也不添加 `--no-sandbox`。工具版本和内容校验不匹配时构建失败。Electron sandbox 保持启用。

AppImage 和 Electron 运行时保留各自组件的许可证。

AppImage 运行时包含有独立许可条件的代码，其中 libappimage 的 `light_elf.h` 带有 GPL-2.0-only 声明。发布同时提供 AppImageKit、libappimage、squashfuse 和 XZ 四份对应源码 `.tar.gz`，并提供 [appimage-runtime-sources.json](../licenses/appimage-runtime-sources.json)，记录运行时摘要、源码版本、下载地址、摘要和许可依据。移除旧版桌面库不改变这些运行时代码的许可证。

禁止无特权用户命名空间的 Linux 安全策略可能阻止直接启动 AppImage，此时优先安装 deb，不要添加 `--no-sandbox`。CI 验证提取后的 AppRun 和 setuid sandbox helper；FUSE 和用户命名空间配置取决于宿主发行版。

## 许可证

本项目自有代码采用 MIT。Inno Setup、Electron、Chromium、AppImage 运行时和其他随包组件各自保留原有许可证。构建工具的许可证、构建中生成或复制的代码、最终运行时文件需要分别核对，不能仅依据 npm 依赖分类判断是否分发。

桌面包不包含 DSH 依赖或 GUI 副本，GUI 在连接后从原生服务获取。根 npm 清单覆盖本项目锁定的依赖；服务器从所选 npm 渠道安装的 DSH 和 profile 单独审计。分发完整服务器安装时，保留对应依赖的版权、许可和适用的源码资料。

许可材料见 [第三方声明](../THIRD_PARTY_NOTICES.md)，构建命令见 [开发指南](development.md)。

## 发布资产

`scripts/release-assets.mjs` 要求完整的 16 项资产：7 个桌面安装/分发包、1 个服务端插件包、4 个 AppImage 运行时源码包，以及 `LICENSE.txt`、`THIRD_PARTY_NOTICES.txt`、`npm-inventory.json` 和 `appimage-runtime-sources.json`。任何必需文件缺失或为空都会阻止生成发布清单。

发布流程另生成 `SHA256SUMS` 和 `release-manifest.json`，记录上述 16 项资产的摘要，manifest 还记录大小。AppImage 对应源码与运行时清单同样纳入校验；转发或镜像发布时应保留这些源码及许可材料。
