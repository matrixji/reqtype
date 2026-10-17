# 官网自动发布

官网为 <https://reqtype.localcloud.site>，API 契约来自旁边的 `reqtype-site` 项目 README 与 `src/releases.js`。桌面项目不复制网站的服务器配置或 Token 文件。

## 流程与说明来源

tag → 版本／main 校验 → 三平台原生检查和打包 → GitHub Release → 官网 deploy job。

`publish-release.mts` 优先读取 `release-notes/<version>.md` 中面向用户的说明，附加当前发行限制，并通过 `--generate-notes` 让 GitHub 自动补充 PR 和变更记录。缺少版本说明文件时使用项目描述与平台说明；自动生成部分仍保留。

官网部署重新下载 **已发布 GitHub Release** 的三个 ZIP、`manifest.json` 和 `SHA256SUMS.txt`，核对版本、提交与文件 SHA-256，再读取 GitHub API 中最终的 Release `name`／`body`。`title`／`notes` 使用该 Release 的标题及完整 Notes；官网按纯文本展示 Notes。首页 `site.description` 从 Notes 的首个有效段落去除基础 Markdown 标记后生成，最多 1000 字符。首页标题、tagline 和 GitHub 地址保留原值。

普通版本使用 stable channel；预发布使用 beta，不更新稳定首页介绍。当前上传的 `kind` 为 `archive`，不伪造 Electron 自动安装清单。ZIP 仍需手动下载和替换，MAS 与签名范围见 [上架准备](mac-app-store.md)。

## API 与凭据

部署使用 `POST /api/admin/releases`，Bearer Token 鉴权，multipart 包含一个 JSON `manifest` 字段和三个同名 `files` 二进制字段；文件名、平台、架构、SHA-256 与 GitHub Release 一致，按流上传。

GitHub Actions 配置：

- Repository variable `REQTYPE_SITE_URL`：官网 HTTPS origin。
- Repository secret `REQTYPE_SITE_TOKEN`：官网现有固定发布 Token，至少 32 字符，和服务端一致。
- `GH_TOKEN`：部署 job 只读 GitHub Release；GitHub 写权限仅提供给创建 Release 的 publish job。

Token 只注入 tag 发布后的独立 deploy job，不进入 PR、三平台构建、应用或前端，也不记录在日志、版本说明和 Skill。地址必须为 HTTPS origin；只允许本机 HTTP 用于测试。上传拒绝跟随重定向，避免鉴权头转发。

## 版本、失败与重跑

官网每个 channel 的版本只增不减，同版本不能覆盖或追加平台。官网原有 `0.2.0` 的历史包保留，首次流水线同步使用 `0.2.1`。网站 API 不接受 `+build` 元数据，因此本项目发布校验在构建前拒绝此类版本。

客户端上传前读取官网状态；同版本标题、Notes、三份产物和哈希均一致时直接验证并结束，不再 POST。若同版内容不同，明确失败，不能覆盖。发现官网已有更高版本时拒绝回退。

传输中断或响应丢失时，客户端先只读核对官网是否已完整提交；匹配则确认成功，不再重复上传。未能确认时将 deploy job 标为失败，并提示检查后重跑。GitHub Release 已创建时，在 Actions 中只重跑失败的 deploy job，不重跑已成功的 publish job，不移动 tag。

部署后验证官网发行记录、首页介绍与各平台下载指针。运维验收还应检查三个下载的 HEAD／Range、实际版本和哈希，确认旧版本仍能访问。

实现：[官网客户端](../scripts/site-release.mts)、[tag 部署入口](../scripts/deploy-release.mts)；回归：[HTTP 客户端测试](../tests/site-release.test.ts)。
