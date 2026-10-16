import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseConfig, validateRelativePath } from '../core/config';
import { indexWorkspace, markdownTree } from '../core/markdown';
import type { ExchangePackage, ImportPreview } from '../shared/types';
import { Workspace, safePath, digest, decode, readOptional, applyTransaction } from './workspace';

interface PendingImport { root: string; entries: { path: string; bytes: Buffer; expected: string | null }[] }
const plans = new Map<string, PendingImport>();
const allowedPath = (relative: string) => {
  validateRelativePath(relative);
  if ((relative.startsWith('.') && relative !== '.reqtype/project.yaml') || relative.split('/').some(x => ['.agents', '.env'].includes(x))) throw new Error(`交换包不允许此路径：${relative}`);
};

function localReferences(document: string, source: string, remoteImage?: (url: string) => void) {
  const tree = markdownTree(source), definitions = new Map<string, string>(), references: string[] = [];
  const collect = (node: any) => { if (node.type === 'definition') definitions.set(node.identifier, node.url); for (const child of node.children ?? []) collect(child); };
  collect(tree);
  const walk = (node: any) => {
    if (['image', 'imageReference', 'link', 'linkReference'].includes(node.type)) {
      const url = node.url ?? definitions.get(node.identifier);
      if (url && ['image', 'imageReference'].includes(node.type) && /^(?:https?:|\/\/)/i.test(url)) remoteImage?.(url);
      if (url && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) {
        const reference = decodeURIComponent(url.split(/[?#]/)[0]);
        if (reference && !/\.md$/i.test(reference)) { const relative = path.posix.normalize(path.posix.join(path.posix.dirname(document), reference)); allowedPath(relative); references.push(relative); }
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return [...new Set(references)];
}

export async function exportWorkspace(workspace: Workspace): Promise<ExchangePackage> {
  const snapshot = await workspace.snapshot();
  const errors = indexWorkspace(snapshot.files, snapshot.config).diagnostics.filter(x => x.severity === 'error');
  if (errors.length) throw new Error(`导出前请修复 ${errors.length} 个错误：${errors[0].message}`);
  if (snapshot.warnings.length) throw new Error(`导出前请处理工作区警告：${snapshot.warnings[0]}`);
  const paths = [...snapshot.files.map(x => x.path), ...await workspace.paths(snapshot.config.assets, false)];
  const unique = new Map<string, string>();
  for (const relative of paths) { const existing = unique.get(relative.toLowerCase()); if (existing && existing !== relative) throw new Error(`跨平台路径大小写冲突：${existing} / ${relative}`); unique.set(relative.toLowerCase(), relative); }
  const included = new Set(paths);
  for (const file of snapshot.files) for (const reference of localReferences(file.path, file.content, url => { throw new Error(`${file.path} 使用网络图片 ${url}，请先保存为本地附件再导出完整交换包`); })) if (!included.has(reference)) throw new Error(`${file.path} 引用的附件 ${reference} 缺失或未包含在 assets 配置中`);
  if (snapshot.configured) paths.unshift('.reqtype/project.yaml');
  const files: ExchangePackage['files'] = [];
  let total = 0;
  for (const relative of [...new Set(paths)]) {
    allowedPath(relative);
    const bytes = await fs.readFile(await safePath(workspace.root, relative));
    total += bytes.length;
    if (total > 128 * 1024 * 1024) throw new Error('工作区超过 128 MB，请缩小附件目录后导出');
    const encoding = /\.(md|ya?ml)$/i.test(relative) ? 'utf8' as const : 'base64' as const;
    files.push({ path: relative, encoding, content: encoding === 'utf8' ? decode(bytes) : bytes.toString('base64'), sha256: digest(bytes) });
  }
  return { format: 'reqtype', version: 1, exportedAt: new Date().toISOString(), files };
}

export function decodeExchange(input: unknown) {
  const bundle = input as ExchangePackage;
  if (!bundle || bundle.format !== 'reqtype' || bundle.version !== 1 || !Array.isArray(bundle.files) || bundle.files.length > 10000) throw new Error('不是受支持的 ReqType v1 交换包');
  const names = new Set<string>();
  let total = 0;
  return bundle.files.map(entry => {
    allowedPath(entry.path);
    const folded = entry.path.toLowerCase();
    if (names.has(folded)) throw new Error(`交换包有重复或大小写冲突的路径：${entry.path}`);
    names.add(folded);
    if (!['utf8', 'base64'].includes(entry.encoding) || typeof entry.content !== 'string') throw new Error(`文件编码无效：${entry.path}`);
    const bytes = Buffer.from(entry.content, entry.encoding === 'utf8' ? 'utf8' : 'base64');
    if (entry.encoding === 'base64' && bytes.toString('base64') !== entry.content) throw new Error(`附件 Base64 无效：${entry.path}`);
    if (digest(bytes) !== entry.sha256) throw new Error(`内容校验失败：${entry.path}`);
    total += bytes.length;
    if (total > 128 * 1024 * 1024) throw new Error('交换包解码后超过 128 MB');
    return { path: entry.path, bytes };
  });
}

export async function prepareImport(workspace: Workspace, name: string, incoming: { path: string; bytes: Buffer }[]): Promise<ImportPreview> {
  const snapshot = await workspace.snapshot();
  const configEntry = incoming.find(x => x.path === '.reqtype/project.yaml');
  const config = configEntry ? parseConfig(decode(configEntry.bytes)) : snapshot.config;
  const roots = [...config.documents, ...config.assets, ...snapshot.config.documents, ...snapshot.config.assets];
  const entries: PendingImport['entries'] = [];
  const warnings: string[] = [];
  const names = new Set<string>();
  const existingPaths = [...snapshot.files.map(x => x.path), ...await workspace.paths(snapshot.config.assets, false)];
  for (const entry of incoming) {
    allowedPath(entry.path);
    if (existingPaths.some(existing => existing !== entry.path && existing.toLowerCase() === entry.path.toLowerCase())) throw new Error(`导入路径与已有文件存在大小写冲突：${entry.path}`);
    if (names.has(entry.path.toLowerCase())) throw new Error(`重复路径：${entry.path}`);
    names.add(entry.path.toLowerCase());
    if ((configEntry || snapshot.configured) && entry.path !== '.reqtype/project.yaml' && roots.length && !roots.some(root => entry.path === root || entry.path.startsWith(root + '/'))) throw new Error(`文件不在配置的文档或附件目录中：${entry.path}`);
    if (/\.md$/i.test(entry.path) && entry.bytes.length > 8 * 1024 * 1024) throw new Error(`文档超过 8 MB：${entry.path}`);
    const previous = await readOptional(await safePath(workspace.root, entry.path));
    entries.push({ ...entry, expected: previous ? digest(previous) : null });
  }
  const candidate = new Map(snapshot.files.map(x => [x.path, x.content]));
  for (const entry of entries) if (/\.md$/i.test(entry.path)) candidate.set(entry.path, decode(entry.bytes));
  const diagnostics = indexWorkspace([...candidate].map(([path, content]) => ({ path, content })), config).diagnostics;
  warnings.push(...diagnostics.map(x => `${x.path}：${x.message}`));
  const known = new Set([...snapshot.files.map(x => x.path), ...await workspace.paths(snapshot.config.assets, false), ...incoming.map(x => x.path)]);
  for (const [file, source] of candidate) for (const reference of localReferences(file, source, url => warnings.push(`${file}：网络图片 ${url} 不会自动下载，请保存为本地附件`))) if (!known.has(reference)) warnings.push(`${file}：附件 ${reference} 缺失或未纳入当前交换范围`);
  if (configEntry) warnings.push('包含项目配置：应用后可能改变类型定义和扫描目录，请确认文件范围');
  if (/\.md$/i.test(name)) warnings.push('单文件 Markdown 导入不携带附件；包含附件的完整交换请使用 JSON 工作区包');
  const token = randomUUID();
  if (plans.size > 10) plans.clear();
  plans.set(token, { root: workspace.root, entries });
  return { token, name: path.basename(name), entries: entries.map(x => ({ path: x.path, bytes: x.bytes.length, status: x.expected === digest(x.bytes) ? 'unchanged' : x.expected === null ? 'new' : 'update' })), warnings };
}

export async function applyImport(workspace: Workspace, token: string, selected: string[]) {
  const plan = plans.get(token);
  if (!plan || plan.root !== workspace.root) throw new Error('导入预览已失效，请重新选择文件');
  if (!selected.length) throw new Error('请选择要导入的文件');
  if (selected.some(relative => !plan.entries.some(x => x.path === relative))) throw new Error('导入选择不属于当前预览');
  const entries = plan.entries.filter(entry => selected.includes(entry.path));
  const current = await workspace.snapshot();
  const configEntry = entries.find(x => x.path === '.reqtype/project.yaml');
  const config = configEntry ? parseConfig(decode(configEntry.bytes)) : current.config;
  if (current.configured || configEntry) for (const entry of entries) if (entry.path !== '.reqtype/project.yaml' && ![...config.documents, ...config.assets].some(root => entry.path === root || entry.path.startsWith(root + '/'))) throw new Error(`${entry.path} 不在导入后的目录配置中，请同时选择相应项目配置`);
  const candidate = new Map(current.files.map(file => [file.path, file.content]));
  for (const entry of entries) if (/\.md$/i.test(entry.path)) candidate.set(entry.path, decode(entry.bytes));
  const errors = indexWorkspace([...candidate].map(([path, content]) => ({ path, content })), config).diagnostics.filter(x => x.severity === 'error');
  if (errors.length) throw new Error(`导入会产生错误：${errors[0].path}：${errors[0].message}`);
  await applyTransaction(workspace.root, entries.filter(entry => entry.expected !== digest(entry.bytes)));
  plans.delete(token);
  return workspace.snapshot();
}
