---
name: reqtype-delivery
description: 修改 ReqType 的 GitHub Actions、PR 门禁或 tag 发行，排查三平台 Electron CI 失败及准备 MAS 发行时使用。
---

# ReqType 交付

输入是本仓库交付变更、PR／run 链接或拟发布版本。先读 [交付约定](../../../docs/delivery.md) 与实际工作流、`scripts/*release*.mts`、`tests/delivery.test.ts`；涉及 MAS 时再读 [上架准备](../../../docs/mac-app-store.md)。

- 保持用户选择的私有仓库。私有 Free 套餐可能拒绝服务端保护；以 API 的实际返回为准，不能通过公开仓库绕过限制。`npm run setup:git` 仅保护本机，`npm run github:protect` 成功后仍核对远端规则。
- 后续变更使用工作分支及 PR，全部 `CI required` 通过后 squash 合并。保留用户未提交文件；不要用 `git add .` 混入需求文档。
- 三个原生环境都需执行核心检查、开发版桌面回归、原生打包、发行包桌面回归；交叉打包不能替代运行证据。桌面测试只使用临时数据及独立 userData。
- 定位 CI 时先看失败 step。已完成 job 可用 `gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs` 获取日志，无需等待整个矩阵结束；下载对应 `evidence-<prefix>-<platform>-<arch>`，检查截图、错误上下文及 trace。不要只提高超时或跳过失败平台。
- CodeMirror 只挂载渲染范围内的内容；先把目标滚入视口，再验证实际文字和位置。Windows 剪贴板可能将 LF 转为 CRLF，比较其文本可规范化换行，文件无损保存断言仍比较原文。
- 发布前确认应用／lockfile／tag 版本一致、提交已合入 main、tag 未存在。tag 发布会重新跑三平台；手动 Release 工作流只验证。发布须在用户授权范围内，不因使用 Skill 自动获得发布权限。
- 验收检查三份 ZIP、清单提交与 SHA-256，确认 GitHub Release 实际存在。失败若尚未发布可重跑；已存在的 Release 不自动覆盖，已发布 tag 不移动。
- 普通 darwin ZIP 是未签名桌面包；MAS 还需要产品沙箱适配、专用 Electron 构建及真实签名设备验证，不能仅添加证书变量就宣称支持上架。

修改交付行为时维护 DELIVERY 用例、运行类型检查和工作流 lint，并通过实际 PR／Actions 检查目标平台。报告链接、真实通过范围和仍受账号或签名限制的部分，避免把配置成功写成运行通过。
