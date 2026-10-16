# 技术文档与离线渲染

ReqType 的 Markdown 面向需求、技术设计、接口说明和产品文档。正文扩展不改变条目的 UUID 或边界；代码、图形、公式和列表可包含在同一个需求块中。可在应用中打开本工程的“技术文档示例”模块体验。

## 已实现的语法

| 语法 | 编辑与呈现 |
| --- | --- |
| 围栏代码块 | 语言高亮、行号、复制、编辑按钮；未知语言显示纯文本 |
| Mermaid | `mermaid` 代码块本地绘图，可编写流程、时序、类图等 Mermaid 支持的图形 |
| PlantUML | `plantuml` 或 `puml`；可选择本地 JAR 或 Server |
| 数学公式 | `$...$` 行内、`$$` 独占行的块公式，以及 `math` 代码块；KaTeX 本地渲染 |
| GFM | 表格、删除线、自动链接、`- [ ]` / `- [x]` 任务列表；预览中可勾选任务并保存源码 |
| 脚注 | `[^api]` 引用和 `[^api]: ...` 定义，点击引用定位定义 |
| 提示块 | 引用内的 `[!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]`、`[!CAUTION]` |
| 目录 | 独占段落的 `[TOC]`，根据当前文档标题生成，可点击定位 |
| 插件代码块 | 启用的本地插件可以为自定义围栏语言返回静态 HTML 预览 |

代码高亮包含常见的 JavaScript／TypeScript、Python、Java、C／C++、C#、Go、Rust、SQL、Shell、JSON、YAML、HTML、CSS、XML 等语言。源码编辑的语言支持按需从本地打包文件加载。`title="文件名"` 可附在代码块语言之后显示标题；复制按钮只复制代码内容。

光标进入一个块后显示其源码，移出后恢复预览。顶层代码块具有完整工具栏；列表／引用内部的复杂内容可以切换源码编辑。原始 HTML 不作为任意网页执行，预览以支持的 Markdown 语法为准。

## PlantUML 后端

在“项目设置 → PlantUML 渲染”选择：

- **本地 JAR**：默认模式。应用附带 PlantUML MIT 版 JAR，路径留空即可使用，也可以选择自己的 `.jar`。需要本机 Java；可以填写 `java` 或可执行程序绝对路径。时序图可直接绘制；部分图形需要本机 Graphviz，可选择 `dot` 路径，或者在图形中使用适用的 Smetana 布局。
- **Server**：填写服务基础地址，如 `http://127.0.0.1:8080/plantuml`。应用向该地址的 SVG 接口发送编码后的图形源码，不使用任何默认公网服务器。可以连接本机或内网部署；是否可离线使用由该服务的位置决定。

本机后端、工具路径和 Server 地址保存在 `.reqtype/local/renderers.json`，不随 Git 或交换包迁移。更换电脑时重新指定本机工具。设置显式保存，与项目配置一起进行版本检查和事务写入。

JAR 模式允许项目根目录内的本地 `!include`，不允许网络引用，也不在失败后自动切到 Server。图形语法错误、Java 缺失、服务异常等会显示说明并保留源代码。单块输入上限 1 MB、图形输出 8 MB、运行超时 20 秒。

## 本地资源原则

编辑器、代码语言包、图形渲染库、公式字体和主题均随应用打包，从本地加载。核心编辑和 Mermaid／公式渲染无需联网，应用运行时不会从 CDN 下载这些资源。JAR 同样在发行包内；Java 和可选 Graphviz 使用本机安装。

图片优先放在项目附件目录，通过相对路径引用。网络图片在预览中显示“请保存为本地附件”，不会自动请求；完整 JSON 导出会要求先本地化这些图片。外部网页链接仍可由用户主动打开。单 Markdown 导出保留源文本，不自动下载或转换资源。

插件需将自己的依赖与资源放进本地插件包。它们是用户显式启用的本机代码，插件的独立进程不是权限沙箱；第三方插件的网络行为取决于其实现。代码块预览经过清理，不执行插件返回的脚本。

## 实现依据

实现使用 [CodeMirror 语言支持](https://codemirror.net/docs/ref/)、[Mermaid API](https://mermaid.js.org/config/usage)、[KaTeX 本地字体](https://katex.org/docs/font)，以及 PlantUML 的[命令行管道](https://plantuml.com/command-line)、[编码协议](https://plantuml.com/text-encoding)与[本地资源配置](https://plantuml.com/security)。具体版本以锁文件和 `resources/plantuml/source.json` 为准，发行目录附带依赖许可。
