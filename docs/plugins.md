# 插件开发 v1

ReqType 支持用户显式安装的本地可信 JavaScript 插件。每个启用的插件由独立 Electron utility process 承载，用于故障和生命周期管理；这不构成安全沙箱。工作区中的代码不会因打开目录而自动执行。

## 文件与清单

```text
my-plugin/
├── plugin.json
└── index.cjs
```

```json
{
  "id": "example.requirement-tools",
  "name": "需求辅助工具",
  "version": "1.0.0",
  "apiVersion": 1,
  "main": "index.cjs"
}
```

ID 使用小写字母开头，允许小写字母、数字、点及短横线。入口支持 `.cjs`、`.mjs` 和 `.js`。插件目录不能包含符号链接；安装时不复制 `.git` 或 `node_modules`，第三方依赖应打包进入口或作为相对模块随插件提供。

在插件视图选择文件夹安装，显式启用后加载入口。停用会终止宿主进程并拒绝尚未完成的调用。当前 API 为 1，执行超过 10 秒会停止插件并显示错误；再次停用／启用可重启。覆盖升级和插件市场尚未实现。

## 扩展接口

入口导出 `activate(api)`，可以返回 Promise。以下注册函数接收带唯一 `id` 和用户可读 `title` 的对象：

| 注册函数 | 回调 | 返回值 |
| --- | --- | --- |
| `registerCommand` | `run(snapshot)` | `{ message?, edits? }` |
| `registerValidator` | `validate(snapshot)` | 诊断数组 |
| `registerExporter` | `export(snapshot)` | 字符串，配合 `extension` |
| `registerImporter` | `import(input, snapshot)` | `{ path, content }[]`，配合 `extensions` |

快照包含 `files`、`requirements`、`config`。文件包含工作区相对路径、当前会话内容及磁盘版本；条目包含稳定元数据、正文、标题、文档路径和源区间。快照可能包含未保存编辑，插件应优先使用传入文本。

诊断形状为 `{ path, from, severity: 'warning' | 'error', message, id? }`，其中 `from` 是原始文本的 UTF-16 偏移。入向关系可通过其他条目的 `meta.links` 计算。

命令若返回修改，格式为：

```js
{
  edits: [{ path: 'modules/a.md', expectedSource: original, source: updated }],
  message: '已更新条目'
}
```

只有当前会话文本仍等于 `expectedSource` 才会应用；修改进入编辑缓冲区，仍需用户保存。首版仅修改已有文档，不能通过该结果创建或删除文件。撤销针对当前文档事务，不提供跨文档的一次性组合撤销。

导入输入为 `{ name, text }`。适配器返回相对路径及文本，核心统一检查、生成预览并处理文件落盘。适配器应遵守 `snapshot.config.documents`，不能硬编码所有工作区都使用 `modules/`。

## 最小命令示例

```js
exports.activate = api => {
  api.registerCommand({
    id: 'count',
    title: '统计条目',
    run(snapshot) {
      return { message: `共 ${snapshot.requirements.length} 个条目` };
    }
  });
};
```

可运行的完整示例是 [内置需求工具箱](../plugins/quality/index.cjs)，包含命令、校验器、CSV 导出和按行文本导入四种扩展。

## Markdown 代码块渲染器

API 1 还提供 `registerCodeBlock`，用于给自定义围栏语言添加本地静态预览：

```js
exports.activate = api => {
  api.registerCodeBlock({
    id: 'badge', title: '状态卡片', languages: ['badge'],
    render({ language, code, documentPath }) {
      const text = code.replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
      return `<strong>${text}</strong>`;
    }
  });
};
```

在 Markdown 中使用 `badge` 围栏语言即可触发已启用的渲染器。内置工具箱提供 `decision` 卡片，内容为带有 `title`、可选 `status`、`reason` 的 JSON 对象。

渲染器在插件进程中接收 `{ language, code, documentPath }`，返回 HTML 字符串；单次输入与输出限 1 MB，沿用插件的 10 秒超时。返回内容会清理脚本、事件属性、样式和外部嵌入，网络图片显示本地化提示。错误时保留代码。自带 Mermaid／PlantUML／数学渲染和已知代码高亮优先于插件；自定义语言应采用独立名称。

渲染器及所需资源应全部打包在本地插件目录，当前安装不复制 `node_modules`；请先将依赖打包到入口或资源目录。渲染器启停与插件一致，回到文档视图时生效。它不扩展需求元数据语法或执行文档内的 JavaScript。
