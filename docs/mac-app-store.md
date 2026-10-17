# Mac App Store 准备

当前已交付的 tag 流水线发布普通 Electron `darwin` 桌面 ZIP，未签名／公证。Mac App Store（MAS）作为后续独立发行目标，不把普通 ZIP 当作上架产物；本轮不上传 Apple 凭据或提交审核。

Electron 要求 MAS 专用构建、Apple Developer Program、App Sandbox 及相应开发／分发证书；普通 darwin 构建不能直接启用 App Sandbox。开发签名用于获授权设备上的测试，分发签名用于商店提交。参见 [Electron MAS 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)。

## 需要先完成的产品适配

以下结论来自当前代码检查，是待验证的工程工作，不表示已获得 Apple 审核结论。

| 当前实现 | MAS 准备工作与验收 |
| --- | --- |
| `src/main/main.ts` 通过普通目录对话框打开项目，最近项目只保存路径 | 引入用户目录授权与 security-scoped bookmark 的保存、恢复、失效处理和访问释放；在真正 App Sandbox 下重启后读写项目、附件和 `.git`，导入／导出到不同目录并验证撤销授权 |
| `src/main/git.ts` 启动系统 Git | 验证沙箱内可用的 Git 实现及依赖；若分发辅助程序，需处理签名、许可及授权路径，不假定终端可用就代表商店版本可用 |
| `src/main/plantuml.ts` 启动外部 Java，可使用 Graphviz | 验证签名且随包分发的离线运行时／辅助工具及其许可、体积、子进程授权；或另行确定满足离线要求的实现。不能以强制 Server 替代本地能力 |
| `src/main/plugins.ts` 使用 utility process 执行用户安装的 JS 插件 | 审查插件执行边界和分发方式；优先验证随包扩展方案，再评估用户扩展的允许范围。不能假设给程序签名后任意插件即可通过审核 |
| `scripts/package.mjs` 只承担当前桌面发行 | 增加独立 MAS 目标、父／辅助程序 entitlements、描述文件、完整签名及提交产物；在开发签名的 MAS 包上复跑真实桌面测试 |

Apple 要求 Mac App Store 应用合理沙箱化，并对引入可执行代码改变功能设有限制；插件方案需要结合具体行为审查，不能笼统承诺插件均可或均不可上架。依据 [App Review Guidelines 2.4.5、2.5.2](https://developer.apple.com/app-store/review/guidelines/)。文件持久访问参考 [App Sandbox 文件访问](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)。

## 发行配置与后续流水线

准备 Apple Team ID、最终 Bundle ID（当前开发值 `dev.reqtype.desktop` 需确认所有权）、App Store Connect 应用记录、开发及分发描述文件、应用及安装包签名证书、商店文案／图标／隐私说明。证书和密钥仅放受控凭据存储，不能提交 Git；仓库已忽略常见证书和描述文件后缀。

后续流程应先构建 MAS 开发签名包，在获授权 macOS 设备上验证沙箱、工作区重开、导入导出、插件及离线绘图，再构建分发包、上传 App Store Connect 并人工发起审核。Apple 签名与上传凭据只提供给受控发布环境；PR 不接触凭据。GitHub Release 与 MAS 的版本来源一致，但产物、签名及分发流程独立。

目录授权方案、Git／Java 子进程和插件策略均通过实测后，再启用 MAS 上传流水线。上架进度不能仅用普通桌面 CI 成功或构建出 `.pkg` 判断。
