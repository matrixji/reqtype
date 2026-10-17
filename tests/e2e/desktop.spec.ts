import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Workspace, digest } from '../../src/main/workspace';
import { ensureModule, makeRequirement, parseDocumentSource } from '../../src/core/markdown';

let app: ElectronApplication, page: Page, root: string, userData: string;
let pageErrors: string[];
async function launch(remember = false) {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.REQTYPE_USER_DATA = userData;
  env.REQTYPE_E2E_BACKGROUND = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.REQTYPE_E2E_EXECUTABLE;
  app = await _electron.launch({ executablePath, args: [...executablePath ? [] : ['.'], ...remember ? [] : ['--workspace=' + root]], env });
  if (executablePath) expect(await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion()}))).toEqual({packaged:true,version:JSON.parse(await fs.readFile('package.json','utf8')).version});
  page = await app.firstWindow();
  expect(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(window => ({visible:window.isVisible(),focused:window.isFocused()})))).toEqual([{visible:false,focused:false}]);
  page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('.workspace-heading h2')).toBeVisible();
}
async function saveDialog(file: string) { await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, file); }
async function openDialog(file: string) { await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, file); }
async function selectSample() { await page.locator('.file-list button').filter({ hasText: '本地保存示例' }).click(); }
async function closeApp() { await page.evaluate(() => window.reqtype.setDirty(false)); await app.close(); }

test.beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'reqtype-e2e-workspace-'));
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'reqtype-e2e-user-'));
  await Workspace.create(root);
  const sample = (await fs.readFile('examples/local-save.md', 'utf8')).replace('软件应在离线状态下将需求文档保存到用户选择的本地工作区。', '软件应在离线状态下将需求文档保存到用户选择的本地工作区。\n\n![示意](../assets/pixel.png)');
  await fs.writeFile(path.join(root, 'modules/local-save.md'), sample);
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64'));
  pageErrors = [];
  await launch();
});
test.afterEach(async ({}, info) => {
  if (page && !page.isClosed() && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('desktop.png') }).catch(() => {});
  if (app) await closeApp().catch(() => {});
  await fs.rm(root, { recursive: true, force: true }); await fs.rm(userData, { recursive: true, force: true });
  expect(pageErrors).toEqual([]);
});

test('界面编辑、属性撤销、关联、新条目与重启保存', async () => {
  await page.getByRole('button', { name: '条目表格', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索需求' }).fill('SYS-001');
  await expect(page.locator('.requirements-table tbody tr')).toHaveCount(2);
  await page.locator('.table-key').filter({ hasText: 'SYS-001' }).click();
  await expect(page.locator('.inspector-identity h2')).toHaveText('SYS-001');
  await expect(page.locator('img[alt="示意"]')).toBeVisible();
  await expect.poll(() => page.locator('img[alt="示意"]').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  const original = await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8');
  await page.getByLabel('优先级', { exact: true }).selectOption('critical');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8')).toBe(original.replace('priority: high', 'priority: "critical"'));
  await page.getByLabel('优先级', { exact: true }).selectOption('low');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('优先级', { exact: true })).toHaveValue('critical');
  await page.getByRole('button', { name: '条目表格', exact: true }).click();
  await page.locator('.table-key').filter({ hasText: 'SYS-001' }).click();
  await page.getByLabel('优先级', { exact: true }).selectOption('normal');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('优先级', { exact: true })).toHaveValue('critical');
  await page.getByLabel('关联类型', { exact: true }).selectOption('depends_on');
  await page.getByLabel('关联目标', { exact: true }).selectOption('8c21e6a7-5528-44d7-9aec-1fa7178d9098');
  await page.getByRole('button', { name: '添加关联', exact: true }).click();
  await expect(page.locator('.relation-card')).toHaveCount(2);
  await page.getByText('自定义属性', { exact: true }).click();
  await page.getByText('高级：属性 JSON', {exact:true}).click();
  const attributesField = page.getByLabel('属性 JSON', { exact: true });
  const values = JSON.parse(await attributesField.inputValue()); values.owner = '工程作者';
  await attributesField.fill(JSON.stringify(values, null, 2)); await attributesField.press('Tab');
  await page.getByRole('button', { name: '新建条目', exact: true }).click();
  await expect(page.locator('.inspector-identity h2')).toHaveText('REQ-002');
  const body = page.locator('.cm-line').filter({ hasText: /^软件应…$/ });
  await body.click(); await page.keyboard.insertText('通过桌面界面维护工程需求。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => (await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8')).includes('通过桌面界面维护工程需求')).toBe(true);
  const saved = parseDocumentSource('modules/local-save.md', await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8'));
  expect(saved.requirements).toHaveLength(4); expect(saved.requirements[1].meta.links).toHaveLength(2); expect(saved.diagnostics).toEqual([]);
  expect(saved.requirements[3].body).toContain('通过桌面界面维护工程需求。');
  await page.getByRole('button', { name: '新建模块', exact: true }).click();
  await page.getByLabel('模块名称', { exact: true }).fill('中文新模块');
  await page.getByLabel('相对工作区的文件路径', { exact: true }).fill('modules/中文新模块.md');
  await page.getByRole('button', { name: '创建模块', exact: true }).click();
  await expect(page.locator('.file-list button').filter({ hasText: '中文新模块' })).toBeVisible();
  await page.locator('.cm-line').filter({ hasText: '在这里编写需求背景' }).click({ clickCount: 3 });
  await page.getByRole('button', { name: '选区转条目', exact: true }).click();
  await expect(page.locator('.inspector-identity h2')).toHaveText('REQ-003');
  await page.getByRole('button', { name: '复制条目', exact: true }).click();
  await expect(page.locator('.inspector-identity h2')).toHaveText('REQ-004');
  await page.getByRole('button', { name: '上移条目', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => parseDocumentSource('modules/中文新模块.md', await fs.readFile(path.join(root, 'modules/中文新模块.md'), 'utf8')).requirements.map(req => req.meta.key)).toEqual(['REQ-004', 'REQ-003']);
  await closeApp(); await launch(true);
  await expect(page.locator('.file-list button').filter({ hasText: '中文新模块' })).toBeVisible();
  await page.getByRole('button', { name: '条目表格', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索需求' }).fill('通过桌面界面维护');
  await expect(page.locator('.requirements-table tbody tr')).toHaveCount(1);
});

test('导航完成前聚焦标题表单，延后定位不得抢走焦点或改写正文', async () => {
  const file=path.join(root,'modules/local-save.md');
  const before=parseDocumentSource('modules/local-save.md',await fs.readFile(file,'utf8')).requirements.find(req=>req.meta.key==='SYS-001')!;
  await page.setViewportSize({width:1050,height:684});
  await page.getByRole('button',{name:'条目表格',exact:true}).click();
  // 在导航挂载表单的同一轮 DOM 更新中聚焦，稳定覆盖快速开始编辑的交互。
  await page.evaluate(() => {
    const observer=new MutationObserver(() => {
      const input=document.querySelector<HTMLInputElement>('input[aria-label="条目标题"]');
      if(input){input.focus();observer.disconnect();}
    });
    observer.observe(document.body,{childList:true,subtree:true});
    const button=[...document.querySelectorAll<HTMLButtonElement>('.table-key')].find(button=>button.textContent?.includes('SYS-001'))!;
    button.click();
  });
  const title=page.getByLabel('条目标题',{exact:true});
  await expect(title).toBeFocused();
  await expect(page.locator('.cm-line').filter({hasText:'软件应在离线状态下将需求文档保存到用户选择的本地工作区。'})).toBeInViewport();
  await expect(title).toBeFocused();
  await page.keyboard.insertText('焦点保护后的独立标题');await title.press('Tab');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(async()=>parseDocumentSource('modules/local-save.md',await fs.readFile(file,'utf8')).requirements.find(req=>req.meta.id===before.meta.id)?.meta.title).toBe('焦点保护后的独立标题');
  const after=parseDocumentSource('modules/local-save.md',await fs.readFile(file,'utf8')).requirements.find(req=>req.meta.id===before.meta.id)!;
  expect(after.body).toBe(before.body);expect(after.meta.key).toBe(before.meta.key);
});

test('外部修改冲突保护与显式保留本地版本', async () => {
  await selectSample();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const original = await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8');
  await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n本地未保存修改。\n');
  const external = original + '\n外部工具修改。\n';
  await fs.writeFile(path.join(root, 'modules/local-save.md'), external);
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
  await expect(page.locator('.conflict-banner')).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('外部修改冲突');
  expect(await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8')).toBe(external);
  await page.getByRole('button', { name: '保留本地编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => (await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8')).includes('本地未保存修改。')).toBe(true);
  expect(await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8')).not.toContain('外部工具修改。');
});

test('交换预览、插件生命周期和本地 Git 提交', async () => {
  await selectSample();
  const bundlePath = path.join(userData, 'workspace.json');
  await saveDialog(bundlePath);
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '保存并导出工作区 JSON', exact: true }).click();
  await expect.poll(async () => fs.access(bundlePath).then(() => true).catch(() => false)).toBe(true);
  const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
  const file = bundle.files.find((file: { path: string }) => file.path === 'modules/local-save.md');
  file.content = file.content.replace('priority: high', 'priority: low'); file.sha256 = digest(file.content);
  const projectFile = bundle.files.find((file: { path: string }) => file.path === '.reqtype/project.yaml');
  projectFile.content = projectFile.content.replace('prefix: REQ', 'prefix: IMPORT'); projectFile.sha256 = digest(projectFile.content);
  await fs.writeFile(bundlePath, JSON.stringify(bundle));
  await openDialog(bundlePath);
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '导入 Markdown / JSON', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '应用所选 2 个文件', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await fs.readFile(path.join(root, 'modules/local-save.md'), 'utf8')).toContain('priority: low');
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByLabel('需求前缀', { exact: true })).toHaveValue('IMPORT');
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByRole('button', { name: '统计需求', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('共 4 个条目');
  await page.evaluate(() => window.reqtype.setDirty(true));
  await app.evaluate(({ app, dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); app.quit(); });
  await expect.poll(() => app.windows().length).toBe(1);
  await page.getByRole('button', { name: '统计需求', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('共 4 个条目');
  await page.evaluate(() => window.reqtype.setDirty(false));
  const csvPath = path.join(userData, 'export.csv'); await saveDialog(csvPath);
  await page.getByRole('button', { name: '条目表格 CSV', exact: true }).click();
  await expect.poll(async () => fs.readFile(csvPath, 'utf8').catch(() => '')).toContain('SYS-001');
  expect(await fs.readFile(csvPath,'utf8')).toContain('标题');
  await page.getByRole('button', { name: '停用 需求工具箱', exact: true }).click();
  await expect(page.getByRole('button', { name: '统计需求', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '启用 需求工具箱', exact: true }).click();
  await expect(page.getByRole('button', { name: '统计需求', exact: true })).toBeEnabled();
  const textPath = path.join(userData, 'lines.txt'); await fs.writeFile(textPath, '离线可以保存。\nTODO 补充验证条件。\n'); await openDialog(textPath);
  await page.getByRole('button', { name: '按行导入文本', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '应用所选 1 个文件', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '检查待完善内容', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 项提示');
  const localPlugin = path.join(userData, 'custom-plugin'); await fs.mkdir(localPlugin);
  await fs.writeFile(path.join(localPlugin, 'plugin.json'), JSON.stringify({ id: 'test.local', name: '外部示例插件', version: '1.0.0', apiVersion: 1, main: 'index.cjs' }));
  await fs.writeFile(path.join(localPlugin, 'index.cjs'), 'exports.activate = api => api.registerCommand({ id: "hello", title: "运行外部命令", run() { return { message: "外部插件已运行" }; } });');
  await openDialog(localPlugin);
  await page.getByRole('button', { name: '从文件夹安装插件', exact: true }).click();
  await page.getByRole('button', { name: '启用 外部示例插件', exact: true }).click();
  await page.getByRole('button', { name: '运行外部命令', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('外部插件已运行');
  await page.getByRole('button', { name: 'Git 版本', exact: true }).click();
  await page.getByRole('button', { name: '初始化 Git 仓库', exact: true }).click();
  await expect(page.getByLabel('选择 modules/local-save.md')).toBeVisible();
  await page.getByLabel('选择 modules/local-save.md').check();
  await page.getByLabel('提交说明', { exact: true }).fill('通过 ReqType 提交初始需求');
  await page.getByText('提交身份（可选）', { exact: true }).click();
  await page.getByLabel('提交者姓名').fill('ReqType UI Test'); await page.getByLabel('提交者邮箱').fill('ui@reqtype.local');
  await page.getByRole('button', { name: '提交所选 1 个文件', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('通过 ReqType 提交初始需求');
  const result = await promisify(execFile)('git', ['-C', root, 'ls-tree', '-r', '--name-only', 'HEAD']);
  expect(result.stdout.trim()).toBe('modules/local-save.md');
});

test('项目设置、编号默认值、状态流转与导出偏好可持久化', async () => {
  const original = await fs.readFile(path.join(root, 'modules/welcome.md'), 'utf8');
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await page.getByLabel('需求前缀', { exact: true }).fill('PRJ');
  await page.getByLabel('retired 可转为 draft', { exact: true }).uncheck();
  await page.getByLabel('编号位数', { exact: true }).fill('4');
  await page.getByLabel('默认优先级', { exact: true }).selectOption('high');
  await page.getByLabel('打开项目时显示', { exact: true }).selectOption('table');
  await page.getByLabel('编辑器拼写检查', { exact: true }).check();
  await page.getByLabel('导出文件名模板', { exact: true }).fill('{project}-{module}');
  await page.getByLabel('JSON 使用缩进排版', { exact: true }).uncheck();
  await page.getByLabel('PlantUML 后端', { exact: true }).selectOption('server');
  await page.getByLabel('PlantUML Server 地址', { exact: true }).fill('http://127.0.0.1:18080/plantuml');
  await page.getByRole('button', { name: '保存项目设置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('项目设置已保存');
  expect(await fs.readFile(path.join(root, 'modules/welcome.md'), 'utf8')).toBe(original);
  await selectSample();
  await page.getByRole('button', { name: '新建条目', exact: true }).click();
  await expect(page.locator('.inspector-identity h2')).toHaveText('PRJ-0001');
  await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'true');
  await expect(page.getByLabel('优先级', { exact: true })).toHaveValue('high');
  await expect.poll(() => page.getByLabel('状态', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['draft', 'reviewed']);
  await page.getByLabel('状态', { exact: true }).selectOption('reviewed');
  await page.getByRole('button', { name: '条目表格', exact: true }).click();
  await expect.poll(() => page.getByLabel('PRJ-0001 状态', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['reviewed', 'draft', 'approved']);
  await page.getByLabel('PRJ-0001 状态', { exact: true }).selectOption('approved');
  await expect.poll(() => page.getByLabel('PRJ-0001 状态', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['approved', 'reviewed', 'retired']);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const exported = path.join(userData, 'settings-export.json');
  await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async (...args: any[]) => { (globalThis as any).exportOptions = args.at(-1); return { canceled: false, filePath: target }; }; }, exported);
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '按项目设置导出', exact: true }).click();
  await expect.poll(async () => fs.readFile(exported, 'utf8').catch(() => '')).toContain('PRJ-0001');
  const exportedText = await fs.readFile(exported, 'utf8'); expect(exportedText.startsWith('{"format"')).toBe(true);
  expect(await app.evaluate(() => (globalThis as any).exportOptions.defaultPath)).toContain('-local-save.reqtype.json');
  await closeApp(); await launch(true);
  await expect(page.locator('.table-intro h1')).toContainText('全部需求');
  await expect(page.getByLabel('PRJ-0001 状态', { exact: true })).toHaveValue('approved');
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByLabel('需求前缀', { exact: true })).toHaveValue('PRJ');
  await expect(page.getByLabel('retired 可转为 draft', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('PlantUML 后端', { exact: true })).toHaveValue('server');
  await expect(page.getByLabel('PlantUML Server 地址', { exact: true })).toHaveValue('http://127.0.0.1:18080/plantuml');
  await page.getByLabel('需求前缀', { exact: true }).fill('NEXT');
  await fs.appendFile(path.join(root, '.reqtype/project.yaml'), '\n# external settings change\n');
  await page.getByRole('button', { name: '保存项目设置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('项目配置已被外部修改');
  await page.getByRole('button', { name: '重新载入设置', exact: true }).click();
  await expect(page.getByLabel('需求前缀', { exact: true })).toHaveValue('PRJ');
});

test('离线 Markdown：代码、架构图、公式、任务、脚注、提示块和本地插件', async () => {
  await page.setViewportSize({ width: 1050, height: 684 });
  const body = [
    '[TOC]', '', '## 代码示例', '', '```typescript title="API.ts"', 'export interface Service { name: string }', 'const ready = true;', '```', '',
    '## 公式', '', '返回值 $x^2$。', '', '$$', 'E=mc^2', '$$', '',
    '## 架构图', '', '```mermaid', 'flowchart LR', '  Client --> Core', '```', '',
    '## PlantUML', '', '```plantuml', '@startuml', 'Client -> Core: local', '@enduml', '```', '',
    '## 待办', '', '- [ ] 评审接口', '- [x] 确认离线方案', '',
    '## 决策', '', '```decision', '{"title":"离线优先","status":"已记录","reason":"资源随应用保存。"}', '```', '',
    '## 说明', '', '> [!IMPORTANT]', '> 不需要网络即可查看技术文档。', '', '接口说明[^api]。', '', '[^api]: 本地脚注内容。', '', '![远程资源](https://example.invalid/remote.png)', '',
  ].join('\n');
  const source = ensureModule('# 技术文档\n\n' + makeRequirement(body, {id:randomUUID(),key:'EXT-001',type:'requirement',status:'draft'}) + '\n','技术文档',randomUUID());
  await fs.writeFile(path.join(root,'modules/extensions.md'),source);
  await app.evaluate(({session}) => { (globalThis as any).remoteRequests=[]; session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{(globalThis as any).remoteRequests.push(details.url);callback({cancel:true});}); });
  await page.context().setOffline(true);
  await page.getByRole('button',{name:'更多操作',exact:true}).click();
  await page.getByRole('button',{name:'刷新工作区',exact:true}).click();
  await page.locator('.file-list button').filter({hasText:'技术文档'}).click();
  const section = async (title:string) => page.locator('.outline-list button').filter({hasText:new RegExp('^'+title+'$')}).click();
  await section('代码示例');
  const code = page.locator('.code-block[data-language=typescript]');
  await expect(code.locator('.hljs-keyword').first()).toBeVisible();
  await code.getByRole('button',{name:'复制代码块',exact:true}).click();
  await expect(code.getByRole('button',{name:'复制代码块',exact:true})).toHaveText('已复制');
  // Windows 剪贴板使用 CRLF；比较文本内容，文件原文仍由后续逐字断言验证。
  await expect.poll(async () => (await app.evaluate(({clipboard}) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe('export interface Service { name: string }\nconst ready = true;');
  await code.getByRole('button',{name:'编辑代码块',exact:true}).click();
  await page.keyboard.insertText('// 本地编辑\n');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(()=>fs.readFile(path.join(root,'modules/extensions.md'),'utf8')).toBe(source.replace('export interface Service','// 本地编辑\nexport interface Service'));
  await section('公式');
  await expect(page.locator('.inline-math .katex')).toBeVisible();
  await expect(page.locator('.katex-display')).toBeVisible();
  await section('架构图');
  await expect(page.locator('.code-block[data-language=mermaid] .diagram-preview svg')).toBeVisible();
  await expect(page.locator('.code-block[data-language=mermaid] .diagram-preview svg')).toContainText('Client');
  await expect(page.locator('.code-block[data-language=mermaid] .diagram-preview svg')).toContainText('Core');
  await section('PlantUML');
  const plantuml = page.locator('.code-block[data-language=plantuml] .diagram-preview svg');
  // 本地 JAR 的后端截止时间为 20 秒；另留 5 秒给 IPC 与视图测量。
  await expect(plantuml).toBeVisible({ timeout: 25000 });
  await expect(plantuml).toContainText('Client');
  await expect(plantuml).toContainText('Core');
  await expect(plantuml).toContainText('local');
  await section('待办');
  await page.getByRole('checkbox',{name:'切换任务 1',exact:true}).check();
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(()=>fs.readFile(path.join(root,'modules/extensions.md'),'utf8')).toContain('- [x] 评审接口');
  await section('决策');
  await expect(page.locator('.decision-card')).toContainText('离线优先');
  await page.getByRole('button',{name:'插件',exact:true}).click();
  await page.getByRole('button',{name:'停用 需求工具箱',exact:true}).click();
  await page.getByRole('button',{name:'文档',exact:true}).click();
  await section('决策');
  await expect(page.locator('.code-block[data-language=decision] pre')).toContainText('离线优先');
  await expect(page.locator('.decision-card')).toHaveCount(0);
  await page.getByRole('button',{name:'插件',exact:true}).click();
  await page.getByRole('button',{name:'启用 需求工具箱',exact:true}).click();
  await page.getByRole('button',{name:'文档',exact:true}).click();
  await section('决策');
  await expect(page.locator('.decision-card')).toContainText('离线优先');
  await section('说明');
  await expect(page.locator('.markdown-alert.alert-important')).toContainText('不需要网络');
  await expect(page.locator('.inline-footnote')).toHaveText('[api]');
  // CodeMirror 按视口挂载内容；小窗口下，章末图片尚未进入渲染范围。
  await page.locator('.cm-scroller').evaluate(scroller => scroller.scrollTo({ top: scroller.scrollHeight }));
  await expect(page.locator('.offline-resource')).toContainText('网络图片未加载');
  await page.locator('.offline-resource').scrollIntoViewIfNeeded();
  await expect(page.locator('.offline-resource')).toBeInViewport();
  expect(await app.evaluate(()=>(globalThis as any).remoteRequests)).toEqual([]);
  await section('代码示例');
  await expect(page.getByRole('navigation',{name:'文档目录'})).toBeVisible();
  await page.getByRole('navigation',{name:'文档目录'}).getByRole('button',{name:'架构图',exact:true}).click();
  await expect(page.locator('.cm-line').filter({hasText:/架构图/})).toBeInViewport();
});

test('格式迁移预览、原文备份恢复与未来模块只读', async () => {
  const legacy=await fs.readFile('tests/fixtures/formats/legacy/module.md');
  const renderers=await fs.readFile('tests/fixtures/formats/legacy/renderers.json');
  await fs.writeFile(path.join(root,'modules/legacy.md'),legacy);
  await fs.mkdir(path.join(root,'.reqtype/local'),{recursive:true});await fs.writeFile(path.join(root,'.reqtype/local/renderers.json'),renderers);
  await page.getByRole('button',{name:'项目设置',exact:true}).click();
  await page.getByRole('button',{name:'重新载入设置',exact:true}).click();
  await page.getByRole('button',{name:'检查数据格式',exact:true}).click();
  await expect(page.getByRole('button',{name:'升级所列 2 个文件',exact:true})).toBeEnabled();
  expect(await fs.readFile(path.join(root,'modules/legacy.md'))).toEqual(legacy);
  await page.locator('.format-result').filter({hasText:'modules/legacy.md'}).getByText('查看迁移前后原文').click();
  await expect(page.locator('.format-diff').first()).toContainText('reqtype: 1');
  await page.getByRole('button',{name:'升级所列 2 个文件',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('格式升级完成');
  expect(await fs.readFile(path.join(root,'modules/legacy.md'))).toEqual(await fs.readFile('tests/fixtures/formats/v1/module.md'));
  await page.getByRole('button',{name:'恢复此备份',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已恢复迁移前文件');
  expect(await fs.readFile(path.join(root,'modules/legacy.md'))).toEqual(legacy);
  expect(await fs.readFile(path.join(root,'.reqtype/local/renderers.json'))).toEqual(renderers);
  const future=await fs.readFile('tests/fixtures/formats/future/module.md');await fs.writeFile(path.join(root,'modules/future.md'),future);
  await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('button',{name:'刷新工作区',exact:true}).click();
  await page.locator('.file-list button[title="modules/future.md"]').click();
  await expect(page.getByRole('alert')).toContainText('只读');
  await expect(page.getByRole('button',{name:'源码',exact:true})).toHaveClass('active');
  await expect(page.getByRole('button',{name:'实时预览',exact:true})).toBeDisabled();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','false');
  await expect(page.getByRole('button',{name:'新建条目',exact:true})).toBeDisabled();
  const blocked=await page.evaluate(async()=>{const snapshot=await window.reqtype.refresh(),file=snapshot.files.find(file=>file.path==='modules/future.md')!;try{await window.reqtype.save(file.path,file.content.replace('reqtype: 2','reqtype: 1'),file.version);return false;}catch(error){return (error as Error).message.includes('格式版本 2');}});
  expect(blocked).toBe(true);expect(await fs.readFile(path.join(root,'modules/future.md'))).toEqual(future);
});

test('未来本机偏好和插件状态保留原文，插件不会意外自动启用',async()=>{
  await closeApp();
  const preferences=JSON.stringify({format:'reqtype.preferences',version:2,payload:{lastWorkspace:'/future'}});
  const pluginState=JSON.stringify({format:'reqtype.plugin-state',version:2,payload:{disabled:[]}});
  await fs.writeFile(path.join(userData,'settings.json'),preferences);
  const directory=path.join(userData,'plugins/test.future-state'),marker=path.join(userData,'plugin-executed');await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(userData,'plugins/disabled.json'),pluginState);
  await fs.writeFile(path.join(directory,'plugin.json'),JSON.stringify({id:'test.future-state',name:'未来状态测试插件',version:'1.0.0',apiVersion:1,main:'index.cjs'}));
  await fs.writeFile(path.join(directory,'index.cjs'),`exports.activate=()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');`);
  await launch();
  expect(await fs.readFile(path.join(userData,'settings.json'),'utf8')).toBe(preferences);
  expect((await page.evaluate(()=>window.reqtype.plugins())).every(plugin=>!plugin.enabled)).toBe(true);
  await expect.poll(()=>fs.access(marker).then(()=>true).catch(()=>false)).toBe(false);
  await page.getByRole('button',{name:'插件',exact:true}).click();
  await page.getByRole('button',{name:'启用 未来状态测试插件',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已停用插件并保留原文件');
  expect(await fs.readFile(path.join(userData,'plugins/disabled.json'),'utf8')).toBe(pluginState);
  expect(await fs.access(marker).then(()=>true).catch(()=>false)).toBe(false);
});

test('项目类型套餐、属性表单、标题检索与全项目类型迁移',async({},info)=>{
  await page.getByRole('button',{name:'项目设置',exact:true}).click();
  await page.getByText('高级：自定义属性定义 JSON',{exact:true}).click();
  const json=page.getByLabel('自定义属性定义 JSON',{exact:true}),originalDefinitions=await json.inputValue();await json.fill('{"broken":null}');await page.getByRole('button',{name:'保存项目设置',exact:true}).click();await expect(page.getByRole('status')).toContainText('属性定义无效');await json.fill(originalDefinitions);
  await page.getByRole('button',{name:'添加Jira 默认套餐',exact:true}).click();
  await page.getByRole('button',{name:'添加ASPICE 参考套餐',exact:true}).click();
  await page.getByLabel('新条目类型',{exact:true}).fill('产品需求');
  await page.getByRole('button',{name:'添加条目类型',exact:true}).click();
  for(const [name,title,type] of [['effort','工作量','number'],['platforms','支持平台','array'],['note','说明','string']]) {
    await page.getByLabel('新属性标识',{exact:true}).fill(name);await page.getByLabel('新属性名称',{exact:true}).fill(title);await page.getByLabel('新属性数据类型',{exact:true}).selectOption(type);
    await page.getByRole('button',{name:'添加属性定义',exact:true}).click();
    await page.getByLabel(`产品需求 使用属性 ${name}`,{exact:true}).check();await page.getByLabel(`Story 使用属性 ${name}`,{exact:true}).check();
  }
  await page.getByRole('button',{name:'保存项目设置',exact:true}).click();await expect(page.getByRole('status')).toContainText('项目设置已保存');
  await page.getByRole('button',{name:'条目表格',exact:true}).click();await page.locator('.table-key').getByText('SYS-001',{exact:true}).click();
  await expect(page.getByLabel('可读编号',{exact:true})).toHaveAttribute('readonly','');
  await page.getByLabel('条目标题',{exact:true}).fill('跨模块产品标题匹配');await page.getByLabel('条目标题',{exact:true}).press('Tab');
  await page.getByLabel('条目类型',{exact:true}).selectOption('产品需求');await page.getByText('自定义属性',{exact:true}).click();
  await page.getByLabel('选择自定义属性',{exact:true}).selectOption('effort');await page.getByRole('button',{name:'添加属性',exact:true}).click();await page.getByLabel('工作量',{exact:true}).fill('8.5');await page.getByLabel('工作量',{exact:true}).press('Tab');
  await page.getByLabel('选择自定义属性',{exact:true}).selectOption('platforms');await page.getByRole('button',{name:'添加属性',exact:true}).click();await page.getByRole('button',{name:'添加支持平台项',exact:true}).click();await page.getByLabel('支持平台 第 1 项',{exact:true}).fill('macOS');await page.getByLabel('支持平台 第 1 项',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'添加支持平台项',exact:true}).click();await page.getByLabel('支持平台 第 2 项',{exact:true}).fill('Windows');await page.getByLabel('支持平台 第 2 项',{exact:true}).press('Tab');
  await page.getByLabel('选择自定义属性',{exact:true}).selectOption('note');await page.getByRole('button',{name:'添加属性',exact:true}).click();await page.getByLabel('说明',{exact:true}).fill('通过表单填写');await page.getByLabel('说明',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.screenshot({path:info.outputPath('attribute-values.png')});
  await page.locator('.file-list button[title="modules/welcome.md"]').click();await page.getByRole('button',{name:'新建条目',exact:true}).click();
  const generated=await page.getByLabel('可读编号',{exact:true}).inputValue();expect(generated).toMatch(/^REQ-\d+$/);expect(generated).not.toBe('REQ-001');
  await page.getByLabel('条目类型',{exact:true}).selectOption('产品需求');await page.getByLabel('条目标题',{exact:true}).fill('第二个产品条目');await page.getByLabel('条目标题',{exact:true}).press('Tab');await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByLabel('关联目标搜索',{exact:true}).fill('产品标题');await expect(page.getByLabel('关联目标',{exact:true}).locator('option')).toHaveCount(2);await expect(page.getByLabel('关联目标',{exact:true})).toContainText('跨模块产品标题匹配');
  await page.getByRole('button',{name:'条目表格',exact:true}).click();await page.getByLabel('搜索需求',{exact:true}).fill('产品标题');await expect(page.locator('.requirements-table tbody tr')).toHaveCount(1);await expect(page.locator('.table-title')).toHaveText('跨模块产品标题匹配');
  const before=await page.evaluate(()=>window.reqtype.refresh());
  await page.getByRole('button',{name:'项目设置',exact:true}).click();await expect(page.getByRole('button',{name:'删除类型 产品需求',exact:true})).toBeDisabled();
  await page.getByLabel('迁移原类型',{exact:true}).selectOption('产品需求');await page.getByLabel('迁移目标类型',{exact:true}).selectOption('Story');await page.getByRole('button',{name:'预览类型迁移',exact:true}).click();
  await expect(page.getByLabel('类型迁移预览',{exact:true})).toContainText('2 个条目');await page.getByRole('button',{name:'迁移全部 2 个条目',exact:true}).click();await expect(page.getByRole('status')).toContainText('迁移为 Story');
  const after=await page.evaluate(()=>window.reqtype.refresh());
  for(const file of before.files)expect(after.files.find(next=>next.path===file.path)!.content).toBe(file.content.replaceAll('type: "产品需求"','type: "Story"'));
  const migrated=after.files.flatMap(file=>parseDocumentSource(file.path,file.content).requirements).find(req=>req.meta.key==='SYS-001')!;
  expect(migrated.title).toBe('跨模块产品标题匹配');expect(migrated.meta.attributes).toMatchObject({effort:8.5,platforms:['macOS','Windows'],note:'通过表单填写'});
  await expect(page.getByRole('button',{name:'删除类型 产品需求',exact:true})).toBeEnabled();await page.getByRole('button',{name:'删除类型 产品需求',exact:true}).click();await page.getByRole('button',{name:'保存项目设置',exact:true}).click();await expect(page.getByRole('status')).toContainText('项目设置已保存');
  await closeApp();await launch(true);await page.getByRole('button',{name:'条目表格',exact:true}).click();await page.getByLabel('搜索需求',{exact:true}).fill('产品标题');await expect(page.locator('.requirements-table tbody tr')).toHaveCount(1);await expect(page.locator('.table-title')).toHaveText('跨模块产品标题匹配');
  await page.getByRole('button',{name:'项目设置',exact:true}).click();await page.getByRole('heading',{name:'条目类型与套餐',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('project-types.png')});
});

test('旧项目显式升级 v2 启用类型属性，原文备份可恢复为 v1',async()=>{
  const settings=await page.evaluate(()=>window.reqtype.projectSettings()),legacy={...settings.config,version:1};delete legacy.typeAttributes;
  const {stringify}=await import('yaml'),source=stringify(legacy),configFile=path.join(root,'.reqtype/project.yaml');await fs.writeFile(configFile,source);
  const files=(await page.evaluate(()=>window.reqtype.refresh())).files;
  await page.getByRole('button',{name:'项目设置',exact:true}).click();await page.getByRole('button',{name:'重新载入设置',exact:true}).click();
  await expect(page.locator('.settings-card').filter({has:page.getByRole('heading',{name:'自定义属性定义',exact:true})})).toContainText('当前项目格式 v1');
  await page.getByRole('button',{name:'检查数据格式',exact:true}).click();await expect(page.getByRole('button',{name:'升级所列 1 个文件',exact:true})).toBeEnabled();expect(await fs.readFile(configFile,'utf8')).toBe(source);
  await page.getByRole('button',{name:'升级所列 1 个文件',exact:true}).click();await expect(page.getByRole('status')).toContainText('格式升级完成');
  const upgraded=await page.evaluate(()=>window.reqtype.projectSettings());expect(upgraded.config.version).toBe(2);expect(upgraded.config.id).toBe(settings.config.id);for(const type of upgraded.config.types)expect(upgraded.config.typeAttributes![type]).toEqual(['owner']);
  await expect(page.getByLabel('新属性标识',{exact:true})).toBeVisible();await page.getByRole('button',{name:'恢复此备份',exact:true}).click();await expect(page.getByRole('status')).toContainText('已恢复迁移前文件');expect(await fs.readFile(configFile,'utf8')).toBe(source);
  for(const file of files)expect(await fs.readFile(path.join(root,file.path),'utf8')).toBe(file.content);
});
