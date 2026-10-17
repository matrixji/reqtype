---
reqtype: 1
module: "0eba49a5-4003-44b5-b6cf-428d062307c1"
title: "系统需求"
---

# 系统需求

首版以本地、可读文件和可追溯条目为中心。软件行为以实现和验证记录为准。

<!-- req
id: "d954ad2b-2b24-4174-a6d0-0320fc9416b0"
key: "SYS-001"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/workspace.ts"
links:
  - type: satisfies
    target: "5d32ceb4-b17f-44a5-9735-55f0bf714cc4"
-->

### 本地工作区

软件应创建或打开本地工作区，读取项目配置并发现 Markdown 模块，重启后可继续使用。

<!-- /req -->

<!-- req
id: "082e21df-b9a3-497f-aa79-a67124ff856e"
key: "SYS-002"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/core/markdown.ts"
links:
  - type: satisfies
    target: "e46f3ed1-5e41-49c4-a7ff-72ccde5af99a"
-->

### 连续块条目化

软件应将选区扩展到完整 Markdown 块边界后转换为需求，保留表格、列表和其他正文内容，首版需求块不嵌套。

<!-- /req -->

<!-- req
id: "43fe3f32-7832-419d-b059-801ad73ef9c4"
key: "SYS-003"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/renderer/Editor.tsx"
links:
  - type: satisfies
    target: "e46f3ed1-5e41-49c4-a7ff-72ccde5af99a"
-->

### 编辑与实时预览

软件应提供同一文本会话上的实时预览与源码切换，支持撤销、重做和常用 Markdown 编辑。

| 内容 | 首版呈现 |
| --- | --- |
| 标题、强调、链接 | 行内样式 |
| 表格、图片 | 就地预览，点击编辑 |
| 元数据 | 属性标记或源码 |

<!-- /req -->

<!-- req
id: "f137ed6e-f0b6-4399-a7b5-5fcddaa69aee"
key: "SYS-004"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/core/markdown.ts"
links:
  - type: satisfies
    target: "e46f3ed1-5e41-49c4-a7ff-72ccde5af99a"
-->

### 源文件保留

软件应保留未修改文本、未知元数据字段、BOM 和换行。属性面板修改应只更新对应源区间，无修改保存不得改变字节。

<!-- /req -->

<!-- req
id: "11106b67-905d-4632-9e62-6da04be2dbfe"
key: "SYS-005"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/core/markdown.ts"
links:
  - type: satisfies
    target: "80640633-668e-4198-a98c-86920060a390"
-->

### 稳定身份

模块和条目应使用稳定 UUID；可读编号独立管理，移动条目或重命名文件不得改变身份，复制为新条目应生成新 ID。

<!-- /req -->

<!-- req
id: "91a931e8-48dd-4395-8544-2bfbbd9d2202"
key: "SYS-006"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/renderer/App.tsx"
links:
  - type: satisfies
    target: "80640633-668e-4198-a98c-86920060a390"
-->

### 属性和表格视图

软件应提供条目属性、标签、自定义属性以及可检索筛选的表格视图，所有视图共享源数据。

<!-- /req -->

<!-- req
id: "286e72cf-1a34-4d9f-b39d-c6990193e87f"
key: "SYS-007"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/core/markdown.ts"
links:
  - type: satisfies
    target: "80640633-668e-4198-a98c-86920060a390"
-->

### 类型化关联

软件应支持 satisfies、verifies、depends_on 及项目定义的关联类型，按 ID 解析跨模块目标并提供反向关联。

<!-- /req -->

<!-- req
id: "6cfa465b-8663-4f93-b80c-c0a93b7a5d59"
key: "SYS-008"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/workspace.ts"
links:
  - type: satisfies
    target: "80640633-668e-4198-a98c-86920060a390"
-->

### 诊断与冲突保护

软件应诊断边界错误、重复 ID、重复编号、非法属性和断链；磁盘发生外部修改时不得静默覆盖未保存编辑。

<!-- /req -->

<!-- req
id: "74d51e06-d7c9-4cc2-a656-724faf8c2a1e"
key: "SYS-009"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/exchange.ts"
links:
  - type: satisfies
    target: "aeb6094e-e20e-4750-aaa1-43e7d05486b1"
-->

### 原生数据交换

软件应支持 Markdown 与 ReqType JSON 交换包，JSON 包应保留原始模块、项目配置和二进制附件。导入前展示文件更新与冲突。

<!-- /req -->

<!-- req
id: "99e88ffd-148c-41ba-8ee5-b7941cdd93a5"
key: "SYS-010"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/workspace.ts"
links:
  - type: satisfies
    target: "aeb6094e-e20e-4750-aaa1-43e7d05486b1"
-->

### 导入失败恢复

多文件导入应保存恢复日志；中途失败或进程中断后，应能恢复原文件，并保护随后发生的外部修改。

<!-- /req -->

<!-- req
id: "c2860312-e3a9-4a88-80c9-ee688630148a"
key: "SYS-011"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/git.ts"
links:
  - type: satisfies
    target: "aeb6094e-e20e-4750-aaa1-43e7d05486b1"
-->

### 本地 Git 集成

软件应展示工作区状态、文件差异、提交和历史。提交只包含用户选择的文件，并保留未选择文件的已有暂存状态。保存文件不得自动提交。

<!-- /req -->

<!-- req
id: "82901d61-733a-4590-a170-c231e53514a6"
key: "SYS-012"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/plugins.ts"
links:
  - type: satisfies
    target: "92dd99d6-94fb-488c-9c42-721cbd1ae75e"
-->

### 本地插件

软件应支持本地插件的显式安装、启用和停用，并提供命令、校验、导入和导出扩展点。插件在独立进程运行，打开工作区不会自动执行其中的代码。

<!-- /req -->

<!-- req
id: "b08391d3-eddf-4df3-a537-4da39e08936f"
key: "SYS-013"
type: requirement
status: "reviewed"
priority: high
attributes:
  {"milestone":"v0.1","implementation":".reqtype/project.yaml","verification":"macOS 发行包实测：项目设置、编辑与保存、离线图形、完整交换及 Git；见 docs/validation.md"}
links:
  - type: satisfies
    target: "5d32ceb4-b17f-44a5-9735-55f0bf714cc4"
-->

### 工程自举

软件应能打开本工程的 requirements 工作区，编辑工程自己的需求、关联验证用例、导出交换包并通过 Git 查看变化。

<!-- /req -->

<!-- req
id: "52c7ac6f-8f0a-4b6f-9227-bcce185e71ae"
key: "SYS-014"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/renderer/ProjectPanel.tsx"
links:
  - type: satisfies
    target: "5ff767ea-8f88-461f-85e8-656cdf94a843"
-->

### 项目身份与设置

软件应提供项目设置页，将稳定项目 ID、名称、说明、文档及附件范围、需求前缀、编号位数和默认属性保存至 .reqtype/project.yaml。前缀变更只影响新建、复制及文本导入条目，不重写现有编号；设置保存应保留未知扩展配置并检测外部修改。

<!-- /req -->

<!-- req
id: "311995df-5141-42a8-882d-ff2a776a3c85"
key: "SYS-015"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/core/config.ts"
links:
  - type: satisfies
    target: "5ff767ea-8f88-461f-85e8-656cdf94a843"
-->

### 本地状态工作流

项目应配置状态列表、初始状态和每个状态允许的下一步，属性面板与表格应约束状态操作。现有条目不会因工作流设置变化自动流转。源码编辑和数据导入可设置已定义状态；首版不包含多人审批。

<!-- /req -->

<!-- req
id: "392de8f6-da5f-488d-b850-724254e3838b"
key: "SYS-016"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/main.ts"
links:
  - type: satisfies
    target: "5ff767ea-8f88-461f-85e8-656cdf94a843"
-->

### 项目通用与导出偏好

项目应设置启动视图、拼写检查、默认导出格式、文件名模板和 JSON 缩进选项。完整 JSON 交换应包含项目配置及已管理附件；单文档 Markdown 导出不携带附件。

<!-- /req -->

<!-- req
id: "af09112e-0bc3-46a1-8d43-5529c56fa5b1"
key: "SYS-017"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/renderer/markdown-view.ts"
links:
  - type: satisfies
    target: "b99e51ae-ea82-44cb-b6fc-81d055114338"
-->

### 代码块编辑与高亮

软件应为常见语言的围栏代码块提供本地语法高亮、行号、代码复制和就地编辑，保留原始围栏、语言标记及需求边界。未知语言显示可读源码。

<!-- /req -->

<!-- req
id: "b321d02d-004e-462f-b748-d08a801e5955"
key: "SYS-018"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/renderer/Editor.tsx"
links:
  - type: satisfies
    target: "b99e51ae-ea82-44cb-b6fc-81d055114338"
-->

### 技术文档扩展语法

软件应本地呈现 Mermaid、数学公式、GFM 任务列表、脚注、提示块与目录；任务勾选更新 Markdown，目录和脚注引用可定位原文。渲染库、语言包、字体和主题随应用提供。

<!-- /req -->

<!-- req
id: "a2630a2d-0195-49f9-8440-6c472ffcfc40"
key: "SYS-019"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/plugin-host.ts"
links:
  - type: satisfies
    target: "b99e51ae-ea82-44cb-b6fc-81d055114338"
-->

### 本地渲染插件与资源

插件应可注册代码块语言和静态 HTML 渲染器，受启停、错误及超时管理。预览不执行返回脚本；核心渲染不从 CDN 获取资源，网络图片提示先保存为本地附件，完整交换应检查该限制。

<!-- /req -->

<!-- req
id: "68f3e429-6327-4c37-aaec-bf275f85236b"
key: "SYS-020"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/plantuml.ts"
links:
  - type: satisfies
    target: "b99e51ae-ea82-44cb-b6fc-81d055114338"
-->

### PlantUML 后端选择

软件应支持 PlantUML 本地 JAR 和可配置 Server，默认使用随应用附带的 JAR，允许选择 Java、JAR 与可选 Graphviz 路径。JAR 支持项目内本地 include，禁止远程引用；只在明确选择 Server 后调用该服务，不在本地失败后自动联网。工具设置保存在本机。

<!-- /req -->

<!-- req
id: "b78e8872-4978-4fbe-8568-b5541b5186b8"
key: "SYS-021"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/core/formats.ts"
links:
  - type: satisfies
    target: "1b1d26de-7c32-4770-8c6b-6acd2a31e6c7"
-->

### 独立格式版本与兼容保护

项目、Markdown 模块、交换包、本机设置、恢复日志与迁移备份应分别声明格式版本。应用版本、插件 API 和文件哈希独立管理；已知旧布局兼容读取，未知未来格式拒写，未来模块按源码只读显示，不按 v1 语义建立索引。

<!-- /req -->

<!-- req
id: "d642cb52-258b-41bc-89dd-60fbe575161c"
key: "SYS-022"
type: requirement
status: draft
priority: high
attributes:
  milestone: v0.1
  implementation: "src/main/migrations.ts"
links:
  - type: satisfies
    target: "1b1d26de-7c32-4770-8c6b-6acd2a31e6c7"
-->

### 显式可恢复的数据迁移

软件应支持逐版本前向迁移、只读检查和原文预览。执行计划绑定项目、清单与文件哈希，十分钟过期；存在未保存内容、未知或损坏格式时禁止界面迁移。首写前保存完整原文及校验值，再使用可恢复文件事务；恢复不得覆盖后续编辑，重复执行无额外修改。不得重新分配 UUID、编号或关联。

<!-- /req -->

<!-- req
id: b466ed76-4bf9-48ca-91d8-6234bd2959d7
key: REQTYPE-002
title: 项目自动编号与保护
type: requirement
status: draft
priority: high
tags:
  - v0.2.0
links:
  - type: satisfies
    target: a4c21dcc-5ceb-4d96-827e-bf70b086527c
-->

### 项目自动编号与保护

新建和复制条目应使用项目配置的前缀和数字自动编号，在条目界面只读。保存和导入应阻止项目内重复及修改已有编号。项目前缀变更保留历史编号，稳定 UUID 不变。

<!-- /req -->

<!-- req
id: 1e53c58e-87e8-4420-946c-468c6222f4a0
key: REQTYPE-003
title: 可配置类型与批量迁移
type: requirement
status: draft
priority: high
tags:
  - v0.2.0
links:
  - type: satisfies
    target: a4c21dcc-5ceb-4d96-827e-bf70b086527c
-->

### 可配置类型与批量迁移

项目应支持自定义条目类型以及离线 Jira／ASPICE 参考套餐。在用类型不可删除；允许预览并将全项目某类条目迁移为另一类型，仅改类型，保留身份、编号、标题、属性、正文与关联，失败可回滚。

<!-- /req -->

<!-- req
id: 2b1642b4-7e99-4b67-9a21-4bb8dc84f764
key: REQTYPE-004
title: 按类型属性定义与表单
type: requirement
status: draft
priority: high
tags:
  - v0.2.0
links:
  - type: satisfies
    target: a4c21dcc-5ceb-4d96-827e-bf70b086527c
-->

### 按类型属性定义与表单

项目应通过 UI 定义文本、有限数值和文本／数值数组属性，并配置每种条目类型可用的定义；条目可快速选择并填写。保留高级 JSON、布尔值与枚举兼容，在用定义及绑定受到删除保护。

<!-- /req -->

<!-- req
id: c4c96618-f764-419d-96c0-86e9506e2f8d
key: REQTYPE-005
title: 独立标题与片段检索
type: requirement
status: draft
priority: high
tags:
  - v0.2.0
links:
  - type: satisfies
    target: a4c21dcc-5ceb-4d96-827e-bf70b086527c
-->

### 独立标题与片段检索

每个条目应支持元数据 title 独立标题；没有显式标题时从正文提取。表格和关联候选支持编号／标题片段匹配，CSV 导出包含标题，修改标题不重写正文。

<!-- /req -->
