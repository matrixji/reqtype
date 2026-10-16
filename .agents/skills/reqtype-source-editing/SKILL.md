---
name: reqtype-source-editing
description: 修改 ReqType 的 Markdown 源区间、CodeMirror 实时预览、项目 YAML 保存或数据格式迁移时使用，维护源文本保留、版本保护、编辑会话与回归用例。
---

# ReqType 源文本编辑

输入是本仓库中需要修改的解析、编辑或保存行为及其实际源文件。先读根目录 `AGENTS.md` 和对应实现；按影响范围定位 `tests/core.test.ts`、`tests/project.test.ts`、格式／迁移用例及 `tests/e2e/desktop.spec.ts`；用例矩阵见 [docs/regression-cases.md](../../../docs/regression-cases.md)。

## 源数据和修改范围

- Markdown 是权威数据。领域区间按原始 UTF-16 偏移计算；CodeMirror 统一 LF，需要经 `rawOffset`／`normalizedOffset` 映射回原文，不能把规范化后的整个文档直接写回。
- 属性操作使用 YAML 节点的源区间。标量替换保留相邻注释和换行；数组、映射可重写该字段，但不得吞掉后续字段。测试需比较预期修改之外的实际字节，包含 BOM、CRLF、中文和 emoji。
- 起止标记只在顶层 HTML 节点识别；代码围栏、缩进代码与引用中的示例不能变成真实条目。
- 项目 YAML 通过节点更新保留未知扩展字段和注释；它可以规范化排版，与 Markdown 的局部保留承诺区分。配置保存同样检查磁盘版本，禁止隐式重建项目或条目 ID。

## 格式与迁移修改

涉及文件版本时先读 [数据格式契约](../../../docs/data-formats.md)。集中版本在 `src/core/formats.ts`，文件级迁移在 `src/main/migrations.ts`，事务在 `src/main/workspace.ts`，应用 userData 状态在 `src/main/state-storage.ts`。项目数据、本机状态、插件 API 与内容哈希是不同协议。

- 先检查磁盘旧文件和待写内容的版本；仅限制界面不能阻止导入或直接 IPC 降级覆盖。未来模块强制源码只读，不能先按 v1 语义建立索引。
- 使用 `tests/fixtures/formats/` 中冻结历史字节，与独立预期输出比较；该目录关闭 Git 换行转换。不能重新生成历史夹具来修正测试。身份、未知字段、BOM／CRLF、关联与附件都需验证。
- 迁移先完整校验候选项目，再绑定清单／哈希预览，首写前持久化完整原文备份；恢复前检查全部目标。已有备份必须核对原文哈希，不能因文件存在就跳过验证。保留旧夹具与 Schema，真实格式升版才增加生产迁移步骤。
- 行为修复同时补回归：`tests/formats.test.ts` 验证协议和合成多步链，`tests/migrations.test.ts` 验证真实文件、无写入／失败状态与恢复，`tests/schemas.test.ts` 离线验证 Schema 和写入器。涉及界面或桥接时补桌面操作。

## 编辑器易错点

- CodeMirror 块组件外层使用 padding，不使用垂直 margin；后者会破坏高度测量，使正文点击或输入落到需求块外。
- 组件的 `eq` 必须覆盖影响 DOM 事件的源位置。即使内容相同，移动后的 `from`／`bodyFrom` 不同也应重建事件绑定；图片加载、异步图形或插件预览完成后调用 `requestMeasure()`；截图和定位验收检查实际视口，DOM 可见不代表已滚动到目标；SVG 验证还需检查标签文字，不能只断言 SVG 存在。
- 缓存 `EditorState` 重新挂载时通过重新配置扩展绑定当前监听器，保留撤销历史。模式变化用 Compartment；来自属性面板的修改进入同一编辑历史。仅测试首次打开不足以验证会话恢复。

## 验证与成功标准

选择能暴露本次问题的源文件样例，先验证解析或补丁的不变量。涉及界面、IPC 或会话时，在真实 Electron 中操作正文、切换视图、撤销、保存并重启；点击正文后确认新增文本仍在对应需求边界内。

按根目录命令运行相关核心与桌面流程。发行包可通过 `REQTYPE_E2E_EXECUTABLE` 指定可执行程序复用桌面用例，独立启动的验证与开发版测试分别记录；macOS 运行和 Windows 交叉打包不得写成 Windows 实机通过。成功标准是预期行为成立、其余源数据保留且验证记录准确。
