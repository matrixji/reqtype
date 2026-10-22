import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, shell, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workspace, atomicWrite, decode, exists, readOptional, safePath } from './workspace';
import { applyImport, decodeExchange, exportWorkspace, prepareImport } from './exchange';
import { commitFiles, gitDiff, gitShow, gitState, initGit } from './git';
import { previewTypeMigration, applyTypeMigration } from './item-types';
import { applyMigrations, migrationBackups, previewMigrations, restoreMigration } from './migrations';
import { PluginManager } from './plugins';
import { renderPlantuml } from './plantuml';
import { saveAppState } from './state-storage';
import { AISettingsStore } from './ai-settings';
import { AIService } from './ai-service';
import { readPreferences, writePreferences } from '../core/app-state';
import { exportFileName } from '../core/config';
import type { PluginSnapshot } from '../shared/types';

if (process.env.REQTYPE_USER_DATA) app.setPath('userData', process.env.REQTYPE_USER_DATA);
const backgroundTest = process.env.REQTYPE_E2E_BACKGROUND === '1' && Boolean(process.env.REQTYPE_USER_DATA);
if (backgroundTest && process.platform === 'darwin') app.setActivationPolicy('accessory');
protocol.registerSchemesAsPrivileged([{ scheme: 'reqasset', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window: BrowserWindow;
let workspace: Workspace | undefined;
let plugins: PluginManager;
let aiSettings:AISettingsStore;
let aiService:AIService;
let dirty = false, closing = false;
let mutations: Promise<unknown> = Promise.resolve();
const current = () => { if (!workspace) throw new Error('请先打开工作区'); return workspace; };
const preferenceNotices = new Set<string>();
const withNotices = <T extends { notices?: string[] }>(snapshot: T) => ({ ...snapshot, notices: [...snapshot.notices ?? [], ...preferenceNotices] });
const settings = () => path.join(app.getPath('userData'), 'settings.json');
async function selectWorkspace(root: string, create = false) {
  const next = create ? await Workspace.create(root) : await Workspace.open(root);
  const snapshot = await next.snapshot();
  aiService?.cancelAll();
  workspace = next;
  try { const previous = await readOptional(settings()); await saveAppState(settings(), 'preferences', writePreferences(workspace.root, previous?.toString('utf8')), previous?.toString('utf8')); } catch (error) { preferenceNotices.add(`最近项目记录未更新，已保留原文件：${(error as Error).message}`); }
  return withNotices(snapshot);
}
const handle = (name: string, fn: (...args: any[]) => unknown, mutation = false) => ipcMain.handle(`reqtype:${name}`, (event, ...args) => {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的调用来源');
  if (!mutation) return fn(...args);
  const task = mutations.then(() => fn(...args)); mutations = task.catch(() => {}); return task;
});

function registerIPC() {
  handle('aiSettings',()=>aiSettings.read());
  handle('saveAISettings',(input,version)=>aiSettings.save(input,version),true);
  handle('aiStart',request=>{current();return aiService.start(request);});
  handle('aiCancel',(id:string)=>{if(typeof id==='string')aiService.cancel(id);});
  handle('initial', async () => workspace ? withNotices(await workspace.snapshot()) : null);
  handle('open', async (create: boolean) => {
    const selected = await dialog.showOpenDialog(window, { title: create ? '选择新工作区目录' : '打开需求工作区', buttonLabel: create ? '在此创建' : '打开', properties: ['openDirectory', 'createDirectory'] });
    return selected.canceled ? null : selectWorkspace(selected.filePaths[0], create);
  }, true);
  handle('refresh', async () => withNotices(await current().snapshot()));
  handle('save', (relative: string, content: string, version: string | null) => current().save(relative, content, version), true);
  handle('projectSettings', () => current().projectSettings());
  handle('saveProject', (config, version, renderers) => current().saveProject(config, version, renderers), true);
  handle('export', async (kind: string, relative?: string) => {
    const ws = current();
    if (kind !== 'json' && kind !== 'markdown') throw new Error('不支持的导出格式');
    const { config } = await ws.config();
    const target = await dialog.showSaveDialog(window, { title: '导出', defaultPath: exportFileName(config, kind, relative), filters: [{ name: kind === 'json' ? 'ReqType 项目' : 'Markdown 文档', extensions: [kind === 'json' ? 'json' : 'md'] }] });
    if (target.canceled || !target.filePath) return null;
    const bytes = kind === 'json' ? Buffer.from(JSON.stringify(await exportWorkspace(ws), null, config.exports.prettyJson ? 2 : undefined)) : await fs.readFile(await safePath(ws.root, relative!));
    await atomicWrite(target.filePath, bytes); return target.filePath;
  });
  handle('prepareImport', async () => {
    const ws = current();
    const selected = await dialog.showOpenDialog(window, { title: '导入 Markdown 或 ReqType 交换包', filters: [{ name: '需求文件', extensions: ['md', 'json'] }], properties: ['openFile'] });
    if (selected.canceled) return null;
    const file = selected.filePaths[0];
    if ((await fs.stat(file)).size > 180 * 1024 * 1024) throw new Error('导入文件过大');
    const bytes = await fs.readFile(file);
    const root = (await ws.config()).config.documents[0] ?? 'modules';
    const directory = /\.md$/i.test(root) ? path.posix.dirname(root) : root;
    const incoming = /\.md$/i.test(file) ? [{ path: path.posix.join(directory, path.basename(file)), bytes }] : decodeExchange(JSON.parse(decode(bytes)));
    return prepareImport(ws, file, incoming);
  });
  handle('applyImport', (token: string, selected: string[]) => applyImport(current(), token, selected), true);
  handle('previewTypeMigration', (from: string,to: string) => previewTypeMigration(current(),from,to));
  handle('applyTypeMigration', (token: string) => applyTypeMigration(current(),token),true);
  handle('previewMigrations', () => previewMigrations(current()));
  handle('applyMigrations', (token: string) => applyMigrations(current(), token), true);
  handle('restoreMigration', (id: string) => restoreMigration(current(), id), true);
  handle('migrationBackups', () => migrationBackups(current()));
  handle('gitState', () => gitState(current().root));
  handle('gitInit', () => initGit(current().root), true);
  handle('gitDiff', (relative: string, original?: string) => gitDiff(current().root, relative, original));
  handle('gitShow', (hash: string) => gitShow(current().root, hash));
  handle('gitCommit', (paths: string[], message: string, identity?: { name: string; email: string }) => commitFiles(current().root, paths, message, identity), true);
  handle('selectRendererFile', async (kind: string) => {
    if (!['jar', 'java', 'dot'].includes(kind)) throw new Error('无效工具类型');
    const selected = await dialog.showOpenDialog(window, { title: kind === 'jar' ? '选择 PlantUML JAR' : `选择 ${kind} 可执行程序`, properties: ['openFile'], ...(kind === 'jar' ? { filters: [{ name: 'Java Archive', extensions: ['jar'] }] } : {}) });
    return selected.canceled ? null : selected.filePaths[0];
  });
  handle('renderPlantuml', async (code: string, documentPath: string) => {
    const ws = current(), settings = (await ws.projectSettings()).renderers.settings;
    return renderPlantuml(code, settings, { root: ws.root, documentPath, bundledJar: path.join(app.isPackaged ? process.resourcesPath : app.getAppPath() + '/resources', 'plantuml/plantuml.jar') });
  });
  handle('renderCodeBlock', async (language: string, code: string, documentPath: string) => {
    if (typeof language !== 'string' || typeof code !== 'string' || code.length > 1024 * 1024 || typeof documentPath !== 'string') throw new Error('代码块输入无效或超过 1 MB');
    const plugin = plugins.list().find(plugin => plugin.enabled && !plugin.error && plugin.renderers.some(renderer => renderer.languages?.includes(language)));
    const renderer = plugin?.renderers.find(renderer => renderer.languages?.includes(language));
    if (!plugin || !renderer) return null;
    const result = await plugins.run(plugin.id, 'renderers', renderer.id, undefined, { language, code, documentPath });
    if (typeof result.html !== 'string' || result.html.length > 1024 * 1024) throw new Error('代码块渲染器须返回不超过 1 MB 的 HTML');
    return { html: result.html };
  });
  handle('plugins', () => plugins.list());
  handle('pluginToggle', (id: string, enabled: boolean) => plugins.toggle(id, enabled), true);
  handle('pluginInstall', async () => {
    const selected = await dialog.showOpenDialog(window, { title: '安装本地插件（包含 plugin.json 的目录）', properties: ['openDirectory'] });
    return selected.canceled ? plugins.list() : plugins.install(selected.filePaths[0]);
  }, true);
  handle('pluginRun', async (id: string, kind: 'commands' | 'validators' | 'exporters' | 'importers', action: string, snapshot: PluginSnapshot) => {
    let input;
    if (kind === 'importers') {
      const contribution = plugins.list().find(plugin => plugin.id === id)?.importers.find(x => x.id === action);
      const selected = await dialog.showOpenDialog(window, { title: contribution?.title ?? '插件导入', filters: [{ name: '支持的文件', extensions: contribution?.extensions ?? ['txt'] }], properties: ['openFile'] });
      if (selected.canceled) return {};
      const file = selected.filePaths[0];
      if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('插件文本输入超过 8 MB');
      input = { name: path.basename(file), text: decode(await fs.readFile(file)) };
    }
    const result = await plugins.run(id, kind, action, snapshot, input);
    if (kind === 'importers' && result.files) result.importPreview = await prepareImport(current(), input!.name, result.files.map(file => ({ path: file.path, bytes: Buffer.from(file.content) })));
    return result;
  });
  handle('exportText', async (name: string, content: string) => {
    const target = await dialog.showSaveDialog(window, { defaultPath: path.basename(name) });
    if (target.canceled || !target.filePath) return null;
    await atomicWrite(target.filePath, Buffer.from(content)); return target.filePath;
  });
  handle('showFolder', () => shell.openPath(current().root));
  ipcMain.on('reqtype:dirty', (event, value) => { if (event.sender === window.webContents) dirty = Boolean(value); });
}

app.whenReady().then(async () => {
  aiSettings=new AISettingsStore(path.join(app.getPath('userData'),'ai-settings.json'),{available:()=>safeStorage.isEncryptionAvailable(),encrypt:value=>safeStorage.encryptString(value),decrypt:value=>safeStorage.decryptString(Buffer.from(value))});
  aiService=new AIService(aiSettings,event=>{if(window&&!window.isDestroyed())window.webContents.send('reqtype:ai',event);});
  plugins = new PluginManager(path.join(app.getPath('userData'), 'plugins'), path.join(app.getAppPath(), 'plugins/quality'), path.join(__dirname, 'plugin-host.cjs'));
  await plugins.init();
  const requested = process.argv.find(arg => arg.startsWith('--workspace='))?.slice('--workspace='.length);
  let last: string | undefined;
  try { const bytes = await readOptional(settings()); if (bytes) last = readPreferences(bytes.toString('utf8')).value.lastWorkspace; } catch (error) { preferenceNotices.add(`最近项目记录无法读取，已保留原文件：${(error as Error).message}`); }
  const initial = requested ?? last ?? (await exists(path.join(app.getAppPath(), '.reqtype/project.yaml')) ? app.getAppPath() : undefined);
  let initialError: string | undefined;
  if (initial) try { await selectWorkspace(initial); } catch (cause) { initialError = (cause as Error).message; }
  // Windows 隐藏窗口仍可能将动画帧降到约 1 FPS，测试使用离屏绘制维持帧调度。
  window = new BrowserWindow({ width: 1500, height: 960, minWidth: 1050, minHeight: 680, title: 'ReqType', show: !backgroundTest, skipTaskbar: backgroundTest, backgroundColor: '#f6f7f9', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', trafficLightPosition: { x: 18, y: 17 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: !backgroundTest, offscreen: backgroundTest && process.platform === 'win32' } });
  registerIPC();
  protocol.handle('reqasset', async request => {
    try {
      const url = new URL(request.url), doc = decodeURIComponent(url.pathname.slice(1)), src = url.searchParams.get('src') ?? '';
      if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(src.split(/[?#]/)[0])) return new Response('Unsupported image', { status: 400 });
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(doc), decodeURIComponent(src.split(/[?#]/)[0])));
      return net.fetch(pathToFileURL(await safePath(current().root, relative)).href);
    } catch { return new Response('Image unavailable', { status: 404 }); }
  });
  const action = (name: string) => window.webContents.send('reqtype:action', name);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '文件', submenu: [{ label: '打开工作区…', accelerator: 'CmdOrCtrl+O', click: () => action('open') }, { label: '新建模块…', accelerator: 'CmdOrCtrl+N', click: () => action('new-module') }, { type: 'separator' }, { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => action('save') }, { label: '全部保存', accelerator: 'CmdOrCtrl+Shift+S', click: () => action('save-all') }, { type: 'separator' }, { role: 'close' }] },
    { label: '编辑', submenu: [{ label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => action('undo') }, { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => action('redo') }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '源码 / 实时预览', accelerator: 'CmdOrCtrl+/', click: () => action('toggle-source') }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]));
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { event.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); });
  window.on('close', async event => {
    if (!dirty || closing) return;
    event.preventDefault();
    const result = await dialog.showMessageBox(window, { type: 'warning', message: '还有未保存的修改', detail: '关闭后将丢失这些修改。可以返回工作区保存后再关闭。', buttons: ['继续编辑', '放弃修改并关闭'], defaultId: 0, cancelId: 0 });
    if (result.response === 1) { closing = true; window.close(); }
  });
  if (process.env.REQTYPE_DEV_URL) await window.loadURL(process.env.REQTYPE_DEV_URL); else await window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  if (initialError) void dialog.showMessageBox(window, { type: 'warning', message: '上次工作区无法打开', detail: initialError });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {aiService?.cancelAll();plugins?.close();});
