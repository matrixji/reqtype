# 开发与发布流程

仓库：[matrixji/reqtype](https://github.com/matrixji/reqtype)，私有，默认分支 `main`。GitHub 中的 Pull Request 对应本项目所说的 MR。

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

2026-10-17 实测 GitHub 对私有仓库设置主分支保护返回 HTTP 403，要求升级 GitHub Pro 或公开仓库。按用户选择保持私有、暂不升级，因此目前 **PR／检查通过是执行约定，GitHub 尚未强制禁止绕过**。计划限制见 [GitHub 官方说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)。

将来升级支持此能力的套餐后，以管理员身份执行 `npm run github:protect`。脚本读取 GitHub Actions 的 `CI required` App ID，要求分支最新且检查通过、必须 PR、允许 0 个审批、解决讨论、线性历史，约束管理员并拒绝强推／删除；另设 `v*` tag 更新／删除禁令。脚本失败会明确报错，不会改为公开仓库。保护规则需要先有一次 CI 检查记录；执行后应通过 API 确认两项规则实际存在。

## 检查范围

`.github/workflows/check.yml` 响应向 `main` 的 PR、合入 `main` 及手动触发。复用 `desktop-build.yml`，矩阵为：

| 系统 | runner | 架构 |
| --- | --- | --- |
| macOS 15 | `macos-15` | ARM64 |
| macOS 15 Intel | `macos-15-intel` | x64 |
| Windows | `windows-2025` | x64 |

每个环境使用 Node.js 24、Java 21 和锁定依赖，执行 `npm test`、类型检查／构建、真实 Electron 开发版桌面回归、原生打包，再运行同一套发行包桌面回归。最终 `CI required` 汇总全部环境；任一失败即失败，不跳过失败平台。

桌面回归使用临时工作区和独立 userData，不修改仓库需求。离线用例取消所有 HTTP(S) 并验证没有发出请求，覆盖 Mermaid、PlantUML JAR、公式、代码及本地插件。Windows 剪贴板按 CRLF 规范化后比较文本，保存原文仍逐字校验。CodeMirror 测试应先将目标滚入视口，不能假定长文档全部挂载。

失败保留截图、上下文和 trace；成功上传未签名 ZIP。Actions 构建及验证产物保留 7 天。所有第三方 Actions 固定到提交 SHA；PR 作业仅有读取权限、不使用发布凭据，只有发布 job 获得 `contents: write`。

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

GitHub 私有仓库的 Actions 额度和计费按账号套餐计算；本工作流不自动开通收费功能，也不定时运行。
