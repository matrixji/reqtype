# 开发与发布流程

仓库：[matrixji/reqtype](https://github.com/matrixji/reqtype)，公开，使用 Apache-2.0，默认分支 `main`。GitHub 中的 Pull Request 对应本项目所说的 MR。

## 分支与合并

首次克隆后执行 `npm ci` 与 `npm run setup:git`。钩子拒绝向 `main` 推送，允许工作分支和 tag；它属于本机配置，每个克隆都需要安装，可以被绕过，不能替代服务端保护。

```sh
git switch main
git pull --ff-only
git switch -c feature/change-name
# 修改、回归并提交
git push -u origin feature/change-name
gh pr create --base main
# 检查通过且完成 review 后
gh pr merge --squash --delete-branch
```

仓库只允许 squash 合并，合并后自动删除远程工作分支。当前为单人维护，流程不要求作者无法提供的自我审批。

服务端保护要求 PR、分支已更新、`CI required` 成功、讨论解决与线性历史，约束管理员并禁止 main 强推／删除。单人维护时允许 0 个审批，避免要求作者自我审批。另设 `v*` tag 更新／删除禁令，允许创建新版本 tag。公开仓库的规则可用性见 [GitHub 官方说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)。

维护规则时，以管理员身份执行 `npm run github:protect`。脚本读取 GitHub Actions 的 `CI required` App ID，配置上述主分支及 tag 规则。保护规则需要先有一次 CI 检查记录；执行后通过 API 确认两项规则实际存在。脚本失败会明确报错，不更改仓库可见性。

## 检查范围

`.github/workflows/check.yml` 响应向 `main` 的 PR、合入 `main` 及手动触发。复用 `desktop-build.yml`，矩阵为：

| 系统 | runner | 架构 |
| --- | --- | --- |
| macOS 15 | `macos-15` | ARM64 |
| macOS 15 Intel | `macos-15-intel` | x64 |
| Windows | `windows-2025` | x64 |

每个环境使用 Node.js 24、Java 21 和锁定依赖，执行 `npm test`、类型检查／构建、真实 Electron 开发版桌面回归、原生打包，再运行同一套发行包桌面回归。最终 `CI required` 汇总全部环境；任一失败即失败，不跳过失败平台。

桌面回归使用临时工作区和独立 userData，不修改仓库需求。离线用例取消所有 HTTP(S) 并验证没有发出请求，覆盖 Mermaid、PlantUML JAR、公式、代码及本地插件。Windows 剪贴板按 CRLF 规范化后比较文本，保存原文仍逐字校验。CodeMirror 测试应先将目标滚入视口，不能假定长文档全部挂载。PlantUML 断言按 JAR 的 20 秒后端截止时间另加 5 秒界面余量等待，并检查图中标签；不使用通用 5 秒断言作为 JAR 启动上限。

失败保留截图、上下文和 trace；成功上传未签名 ZIP。Actions 构建及验证产物保留 7 天。所有第三方 Actions 固定到提交 SHA；PR 作业仅有读取权限、不使用发布凭据，只有发布 job 获得 `contents: write`。

桌面回归默认后台运行：启动器设置 `REQTYPE_E2E_BACKGROUND=1` 并提供独立 `REQTYPE_USER_DATA`，应用创建隐藏窗口，macOS 使用 accessory 激活策略，测试核对窗口不可见、未聚焦。仅此测试模式关闭后台计时节流，截图和渲染断言继续工作。需要验证操作系统焦点、输入法或原生对话框时另行安排前台验收，不在日常回归中反复抢占桌面。相关 API 见 [Electron 页面可见性](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility)。

Windows 的隐藏窗口在关闭后台节流后仍出现每次点击约 2 秒的双帧稳定等待，因此测试窗口启用 Electron [离屏绘制](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)；普通应用启动保持正常绘制方式。判断此类问题时查看 trace 中动作等待的实际耗时，不能仅凭总时间认定测试挂起。

## tag 与 Release

先通过 PR 修改 `package.json` 和 `package-lock.json` 的应用版本并完成合并，再从同步后的 `main` 创建 tag：

```sh
git switch main
git pull --ff-only
# 示例：应用版本已为 0.2.0，且该 tag 尚不存在
git tag -a v0.2.0 -m 'ReqType v0.2.0'
git push origin v0.2.0
```

`release.yml` 要求严格 SemVer、tag 与两份版本文件完全一致，且提交已包含在 `origin/main`。随后重新执行三平台完整构建和两套桌面回归，成功后才发布。`v0.2.1-rc.1` 等预发布版本会标记 prerelease。

资产包括 `ReqType-<version>-macos-arm64-unsigned.zip`、`macos-x64-unsigned.zip`、`windows-x64-unsigned.zip`，以及 `manifest.json` 与 `SHA256SUMS.txt`。清单记录精确字节大小、哈希、版本和提交。必须齐备三个 ZIP；缺失、多余或空 ZIP 会中止发布。

ZIP 为解压运行的桌面预览包，尚未进行 Apple 公证或 Windows 签名；MAS 另见[上架准备](mac-app-store.md)。运行程序无需 Node.js；本地 Git 功能仍需系统 Git，PlantUML JAR 需本机 Java 21。图形、公式、字体及 JAR 随包提供，首次安装后渲染不依赖 CDN。

手动运行 `Release` 工作流用于构建演练，永不创建 Release。版本校验失败先修正版本／合并；不要移动已有 tag。桌面构建失败时，在尚未创建 Release 的前提下可重跑失败 job。发布脚本拒绝覆盖已存在的 Release；若发布过程中留下部分资产，应人工核对后处理，不能用移动 tag 修补已发行内容。后续修复使用新版本。

`LICENSE` 与 `NOTICE` 随应用放入 `app.asar`；第三方声明为其中的 `dist/THIRD_PARTY_NOTICES.txt`，Electron 与 PlantUML 的许可另随原资源保留。仓库中的 `private: true` 只控制 npm 发布。

工作流使用 GitHub 标准托管 runner，不自动开通收费功能，也不定时运行。
