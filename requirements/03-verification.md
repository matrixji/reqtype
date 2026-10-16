---
reqtype: 1
module: "c004d9d7-4f26-4855-ba65-38ccac5f57e1"
title: "验证用例"
---

# 验证用例

测试条目描述验收步骤。自动化结果与平台限制记录在 docs/validation.md，不以条目状态代替实际证据。

<!-- req
id: "187fa693-06a7-4877-ad16-230a5d84d22a"
key: "TEST-001"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "d954ad2b-2b24-4174-a6d0-0320fc9416b0"
-->

### 验证工作区与保存

创建或打开工作区，编辑并保存文档，关闭应用后再次打开，确认正文、属性与模块身份保留。

<!-- /req -->

<!-- req
id: "addca5d8-2d7e-4462-a19b-65ce7be61aab"
key: "TEST-002"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "082e21df-b9a3-497f-aa79-a67124ff856e"
-->

### 验证连续内容块

选择表格中的部分文本执行转换，确认转换覆盖整张表格，已有条目不会被嵌套，源码仍完整。

<!-- /req -->

<!-- req
id: "c5363972-bfe3-430d-8ce8-00700b4c5404"
key: "TEST-003"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "43fe3f32-7832-419d-b059-801ad73ef9c4"
-->

### 验证编辑会话

编辑标题、强调、表格和图片，切换源码／实时预览，执行撤销重做，确认正文和选区行为一致；分别验证中英文输入。

<!-- /req -->

<!-- req
id: "cc134efb-0968-4325-be52-7ea3be433ddb"
key: "TEST-004"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "f137ed6e-f0b6-4399-a7b5-5fcddaa69aee"
-->

### 验证原文保留

使用带 BOM、CRLF、中文、emoji、注释和未知字段的文件；无修改保存比较字节，修改一个属性后检查差异范围。

<!-- /req -->

<!-- req
id: "2a8d79a3-7c58-457d-ad2e-474bc6076d77"
key: "TEST-005"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "286e72cf-1a34-4d9f-b39d-c6990193e87f"
-->

### 验证身份与关联

创建跨模块 satisfies 和 verifies 关联，检查反向关联；移动条目、重命名文件并重新打开，确认目标仍有效。

<!-- /req -->

<!-- req
id: "0ac1efbc-3768-4c64-aed9-e21618df8dc3"
key: "TEST-006"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "6cfa465b-8663-4f93-b80c-c0a93b7a5d59"
-->

### 验证外部冲突

保留一份未保存修改，用外部工具修改磁盘同一文件。确认软件提示冲突，保存不会静默覆盖，用户可选择处理方式。

<!-- /req -->

<!-- req
id: "4ba0f279-3e1e-415e-97da-c6e1716657f5"
key: "TEST-007"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "74d51e06-d7c9-4cc2-a656-724faf8c2a1e"
-->

### 验证完整交换

导出包含正文、属性、关联、未知字段与二进制附件的 JSON 包，导入空目录后再次导出，逐文件比较哈希。

<!-- /req -->

<!-- req
id: "69eecf10-cde9-4d83-ba1b-c6f766001df2"
key: "TEST-008"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "99e88ffd-148c-41ba-8ee5-b7941cdd93a5"
-->

### 验证导入恢复

模拟多文件导入第二次写入失败，确认旧文件恢复、新文件删除；模拟中断日志，重新打开并检查恢复结果。

<!-- /req -->

<!-- req
id: "5c54c107-b1b2-42b5-8e20-e600ecd82692"
key: "TEST-009"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "c2860312-e3a9-4a88-80c9-ee688630148a"
-->

### 验证 Git 选择提交

预先用外部工具暂存一个文件，仅在 ReqType 中提交另一个文件。确认提交内容准确，原暂存内容保持，历史和差异可读。

<!-- /req -->

<!-- req
id: "a7b0b6fe-eb43-40b8-a87a-f35949bfd6a8"
key: "TEST-010"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "82901d61-733a-4590-a170-c231e53514a6"
-->

### 验证插件生命周期

运行内置统计命令、校验器和 CSV 导出；停用插件确认命令不可用，再启用确认恢复；用文本导入插件预览条目。

<!-- /req -->

<!-- req
id: "a4cc604f-78de-4758-ba1d-dbf91d367e4d"
key: "TEST-011"
type: test
status: draft
priority: normal
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "b08391d3-eddf-4df3-a537-4da39e08936f"
-->

### 验证工程自举

通过实际桌面界面打开工程需求，修改 SYS-013 属性并保存，查看 Git 差异；导出 JSON 并验证在空工作区重建。

<!-- /req -->

<!-- req
id: "09f37dd9-affd-4679-9f8f-ff06aa2dc79b"
key: "TEST-012"
type: test
status: draft
priority: high
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "52c7ac6f-8f0a-4b6f-9227-bcce185e71ae"
-->

### 验证项目设置与编号

修改项目前缀与编号位数，新建条目并重启，确认新编号使用设置、旧编号与稳定 ID 保持。用外部工具修改配置后保存应被阻止，移除仍在使用的定义也应被阻止。

<!-- /req -->

<!-- req
id: "c43e7138-3caa-47a0-96c3-14707ecb5b36"
key: "TEST-013"
type: test
status: draft
priority: high
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "311995df-5141-42a8-882d-ff2a776a3c85"
  - type: verifies
    target: "392de8f6-da5f-488d-b850-724254e3838b"
-->

### 验证工作流与导出偏好

草稿条目不能直接跳到已批准；从属性面板改为已评审，再从表格改为已批准，保存并重启确认状态保留。确认默认视图、拼写检查、导出文件名模板与 JSON 排版设置生效。

<!-- /req -->

<!-- req
id: "1fffce5f-5c36-4483-ae78-2917a55812ba"
key: "TEST-014"
type: test
status: draft
priority: high
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "af09112e-0bc3-46a1-8d43-5529c56fa5b1"
  - type: verifies
    target: "b321d02d-004e-462f-b748-d08a801e5955"
-->

### 验证离线技术文档

阻止 HTTP(S) 请求后打开含代码、Mermaid、公式、任务、脚注、提示块和目录的需求。确认渲染、代码复制与编辑、任务保存和目录定位正常，且没有网络资源请求。

<!-- /req -->

<!-- req
id: "61983c86-fa2e-4dad-a1c5-27432a77d5cc"
key: "TEST-015"
type: test
status: draft
priority: high
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "a2630a2d-0195-49f9-8440-6c472ffcfc40"
-->

### 验证代码块插件

启用包含自定义代码块渲染器的本地插件，确认文档显示静态预览；停用后保留可读代码。错误或超时不得丢失源文本，网络图片须提示本地化。

<!-- /req -->

<!-- req
id: "ee15f44e-cc73-47e5-92aa-dec692eae07a"
key: "TEST-016"
type: test
status: draft
priority: high
attributes:
  milestone: v0.1
links:
  - type: verifies
    target: "68f3e429-6327-4c37-aaec-bf275f85236b"
-->

### 验证 PlantUML 双后端

实际调用随应用附带的 JAR 绘制时序图，验证项目内 include，确认远程 include 未发出请求。使用本地 HTTP 服务检查 Server 编码与 SVG 处理；切换工具设置后重启保留，交换包不包含本机工具路径。

<!-- /req -->

<!-- req
id: "21366aff-0108-41b4-9b40-d927ed6772a7"
key: "TEST-017"
type: test
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "tests/formats.test.ts"
links:
  - type: verifies
    target: "b78e8872-4978-4fbe-8568-b5541b5186b8"
-->

### 验证格式契约与未来版本拒写

使用冻结夹具覆盖源文本、BOM、CRLF、未知扩展、身份与关联保留；离线编译 Schema 并校验当前写入器。未来配置、模块、交换包、本机状态、日志和备份均须受到保护，直接文件 IPC 与导入也不能隐式降级。

<!-- /req -->

<!-- req
id: "94cd87eb-c7f7-4e6e-9778-54a4a13ad3bf"
key: "TEST-018"
type: test
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "tests/migrations.test.ts"
links:
  - type: verifies
    target: "d642cb52-258b-41bc-89dd-60fbe575161c"
-->

### 验证迁移预览、恢复与回归维护

在临时项目验证预览零写入、备份早于首写、过期或变更计划拒绝、失败回滚、日志恢复、重复执行、损坏备份和后续人工编辑保护、附件与交换往返；在真实 Electron 中回归升级和恢复操作。每次修改相关行为时同步维护对应自动化用例与回归矩阵。

<!-- /req -->
