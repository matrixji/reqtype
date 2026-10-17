import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { stringify } from 'yaml';
import { defaultPlantuml, readRendererDocument, writeRendererDocument } from '../core/rendering';
import { attributesForType, defaultConfig, parseConfig, patchProjectConfig, validateRelativePath } from '../core/config';
import { assertModuleWritable, ensureModule, indexWorkspace, makeRequirement, moduleVersion, parseDocumentSource } from '../core/markdown';
import { envelope, isRecord, readEnvelope } from '../core/formats';
import type { FileSnapshot, ProjectConfig, ProjectSettings, RendererSettings, WorkspaceSnapshot } from '../shared/types';

export const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const ignored = new Set(['.git', '.reqtype', '.agents', 'node_modules', 'dist', 'dist-electron', 'release', 'test-results', 'playwright-report']);
export async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }

export async function safePath(root: string, relative: string) {
  validateRelativePath(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`不操作符号链接：${relative}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return current;
}

export async function readOptional(file: string): Promise<Buffer | null> {
  try { return await fs.readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function atomicWrite(file: string, bytes: Uint8Array, expected?: string | null, newMode=0o644) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const current = await readOptional(file);
  if (expected !== undefined && (current ? digest(current) : null) !== expected) throw new Error('文件已被外部修改，请先处理冲突后再保存');
  if (current?.equals(bytes)) return;
  const mode = current ? (await fs.stat(file)).mode : newMode;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.reqtype-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', mode);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    const latest = await readOptional(file);
    if (expected !== undefined && (latest ? digest(latest) : null) !== expected) throw new Error('保存期间文件被外部修改，已保留磁盘版本');
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

export interface TransactionEntry { path: string; before: string | null; after: string; expected: string | null; written: string }
export interface Journal { state: 'pending' | 'done' | 'rolled-back' | 'needs-attention'; entries: TransactionEntry[]; errors?: string[] }

export function readJournalDocument(source: string) {
  return readEnvelope('journal', JSON.parse(source), value => {
    if (!isRecord(value) || !['pending', 'done', 'rolled-back', 'needs-attention'].includes(value.state) || !Array.isArray(value.entries) || value.entries.length > 10000 || value.errors !== undefined && (!Array.isArray(value.errors) || value.errors.some((error: unknown) => typeof error !== 'string'))) throw new Error('无效的恢复日志');
    const paths = new Set<string>();
    for (const entry of value.entries) {
      if (!isRecord(entry)) throw new Error('恢复日志条目无效');
      validateRelativePath(entry.path);
      if (paths.has(entry.path.toLowerCase())) throw new Error('恢复日志路径重复'); paths.add(entry.path.toLowerCase());
      for (const field of ['after', 'before'] as const) if (!(field === 'before' && entry[field] === null) && (typeof entry[field] !== 'string' || Buffer.from(entry[field], 'base64').toString('base64') !== entry[field])) throw new Error('恢复日志内容不是规范 Base64');
      if (entry.expected !== (entry.before === null ? null : digest(Buffer.from(entry.before, 'base64'))) || entry.written !== digest(Buffer.from(entry.after, 'base64'))) throw new Error('恢复日志哈希与内容不匹配');
    }
    return value as Journal;
  });
}
export const writeJournalDocument = (journal: Journal, previous: Record<string, any> = {}) => JSON.stringify(envelope('journal', journal, previous));

async function rollback(root: string, journal: Journal) {
  const errors: string[] = [];
  for (const entry of [...journal.entries].reverse()) {
    try {
      const file = await safePath(root, entry.path), current = await readOptional(file);
      const hash = current ? digest(current) : null;
      if (hash === entry.expected) continue;
      if (hash !== entry.written) throw new Error('检测到额外修改，未自动覆盖');
      if (entry.before === null) await fs.unlink(file);
      else await atomicWrite(file, Buffer.from(entry.before, 'base64'), entry.written);
    } catch (cause) { errors.push(`${entry.path}：${(cause as Error).message}`); }
  }
  journal.state = errors.length ? 'needs-attention' : 'rolled-back';
  journal.errors = errors;
  return errors;
}

export async function recoverTransactions(root: string) {
  const directory = await safePath(root, '.reqtype/local/transactions');
  const warnings: string[] = [];
  if (!await exists(directory)) return warnings;
  for (const name of await fs.readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const file = await safePath(root, `.reqtype/local/transactions/${name}`);
    try {
      const source = await fs.readFile(file, 'utf8'), document = readJournalDocument(source), journal = document.value;
      if (journal.state === 'pending') {
        if (document.legacy) {
          const backup = await safePath(root, `.reqtype/local/legacy-journals/${digest(source)}.json`), previous = await readOptional(backup);
          if (previous && digest(previous) !== digest(source)) throw new Error('旧恢复日志原文备份校验失败，未执行回滚');
          if (!previous) await atomicWrite(backup, Buffer.from(source), null);
        }
        const errors = await rollback(root, journal);
        await atomicWrite(file, Buffer.from(writeJournalDocument(journal, document.envelope)), digest(source));
        warnings.push(errors.length ? `导入恢复需要检查 ${file}：${errors.join('；')}` : '已恢复上次中断的导入，原文件已还原');
      } else if (journal.state === 'needs-attention') warnings.push(`导入恢复有未解决问题：${file}`);
    } catch (cause) { warnings.push(`恢复日志 ${name}：${(cause as Error).message}`); }
  }
  return warnings;
}

export async function applyTransaction(root: string, updates: { path: string; bytes: Buffer; expected: string | null }[], afterWrite?: (index: number) => void | Promise<void>) {
  for (const update of updates) {
    const current = await readOptional(await safePath(root, update.path));
    if ((current ? digest(current) : null) !== update.expected) throw new Error(`${update.path} 已变化，请重新预览导入`);
  }
  const journal: Journal = { state: 'pending', entries: [] };
  for (const update of updates) {
    const current = await readOptional(await safePath(root, update.path));
    journal.entries.push({ path: update.path, before: current?.toString('base64') ?? null, after: update.bytes.toString('base64'), expected: update.expected, written: digest(update.bytes) });
  }
  const journalFile = await safePath(root, `.reqtype/local/transactions/${Date.now()}-${randomUUID()}.json`);
  await atomicWrite(journalFile, Buffer.from(writeJournalDocument(journal)));
  try {
    for (const [index, update] of updates.entries()) {
      await atomicWrite(await safePath(root, update.path), update.bytes, update.expected);
      await afterWrite?.(index);
    }
    journal.state = 'done';
    await atomicWrite(journalFile, Buffer.from(writeJournalDocument(journal)));
  } catch (cause) {
    const errors = await rollback(root, journal);
    await atomicWrite(journalFile, Buffer.from(writeJournalDocument(journal)));
    throw new Error(`导入失败：${(cause as Error).message}。${errors.length ? `恢复需检查 ${journalFile}` : '已恢复导入前的文件'}`);
  }
}

export class Workspace {
  root: string;
  recoveryWarnings: string[] = [];
  constructor(root: string) { this.root = root; }
  static async open(root: string, options: { recover?: boolean } = {}) {
    const real = await fs.realpath(root);
    if (!(await fs.stat(real)).isDirectory()) throw new Error('请选择一个目录');
    const workspace = new Workspace(real);
    workspace.recoveryWarnings = options.recover === false ? [] : await recoverTransactions(real);
    return workspace;
  }
  static async create(root: string) {
    const workspace = await Workspace.open(root);
    const file = await safePath(workspace.root, '.reqtype/project.yaml');
    if (!await exists(file)) {
      await atomicWrite(file, Buffer.from(stringify({ ...defaultConfig(path.basename(workspace.root)), id: randomUUID() }, { lineWidth: 0 })), null);
      const body = makeRequirement('软件应在离线状态下保存需求文档。', { id: randomUUID(), key: 'REQ-001', type: 'requirement', status: 'draft', priority: 'normal' },'\n',2);
      const welcome = ensureModule(`# 我的需求\n\n从这里开始。选中一段内容，可以转换为需求条目。\n\n${body}\n`, '我的需求', randomUUID());
      const target = await safePath(workspace.root, 'modules/welcome.md');
      if (!await exists(target)) await atomicWrite(target, Buffer.from(welcome), null);
      for (const [name, additions] of [['.gitignore', '.reqtype/cache/\n.reqtype/local/\n'], ['.gitattributes', '*.md text eol=lf\n*.yaml text eol=lf\n']] as const) {
        const target = await safePath(workspace.root, name), previous = await readOptional(target);
        const text = previous ? decode(previous) : '';
        const missing = additions.split('\n').filter(line => line && !text.split(/\r?\n/).includes(line));
        if (missing.length) await atomicWrite(target, Buffer.from(text + (text && !text.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n'), previous ? digest(previous) : null);
      }
    }
    return workspace;
  }
  async config(): Promise<{ configured: boolean; config: ProjectConfig }> {
    const bytes = await readOptional(await safePath(this.root, '.reqtype/project.yaml'));
    return bytes ? { configured: true, config: parseConfig(decode(bytes)) } : { configured: false, config: { ...defaultConfig(path.basename(this.root)), documents: [] } };
  }
  async projectSettings(): Promise<ProjectSettings> {
    const bytes = await readOptional(await safePath(this.root, '.reqtype/project.yaml'));
    const rendererBytes = await readOptional(await safePath(this.root, '.reqtype/local/renderers.json'));
    const renderers = { settings: rendererBytes ? readRendererDocument(decode(rendererBytes)).value : defaultPlantuml(), version: rendererBytes ? digest(rendererBytes) : null };
    return { config: bytes ? parseConfig(decode(bytes)) : defaultConfig(path.basename(this.root)), source: bytes ? decode(bytes) : '', version: bytes ? digest(bytes) : null, renderers };
  }
  async saveProject(input: ProjectConfig, expected: string | null, renderers?: RendererSettings): Promise<WorkspaceSnapshot> {
    const previous = await this.projectSettings();
    if (previous.version !== expected) throw new Error('项目配置已被外部修改，请重新载入设置后再保存');
    if (previous.config.id && input.id !== previous.config.id) throw new Error('项目稳定 ID 不允许修改');
    if (input.version !== previous.config.version) throw new Error('项目格式版本只能通过数据格式迁移升级，不能直接更改');
    const config = parseConfig(stringify({ ...input, id: previous.config.id ?? randomUUID() }));
    const before = await this.snapshot(), beforeIndex = indexWorkspace(before.files, previous.config);
    for (const name of Object.keys(previous.config.attributes ?? {})) if (!Object.hasOwn(config.attributes ?? {}, name) && beforeIndex.requirements.some(req => Object.hasOwn(req.meta.attributes ?? {}, name))) throw new Error(`自定义属性 ${name} 仍被条目使用，请先迁移后再移除定义`);
    for (const type of previous.config.types) if (!config.types.includes(type) && beforeIndex.requirements.some(req => (req.meta.type ?? 'requirement') === type)) throw new Error(`条目类型 ${type} 仍被条目使用，请先迁移后再删除`);
    for (const req of beforeIndex.requirements) { const type = req.meta.type ?? 'requirement'; const old = attributesForType(previous.config,type), next = attributesForType(config,type); for (const name of Object.keys(old)) if (!Object.hasOwn(next,name) && Object.hasOwn(req.meta.attributes ?? {},name)) throw new Error(`属性 ${name} 仍被 ${type} 条目使用，不能移除类型绑定`); }
    const oldErrors = new Set(beforeIndex.diagnostics.filter(x => x.severity === 'error').map(x => `${x.path}:${x.id}:${x.message}`));
    const problems = indexWorkspace(before.files, config).diagnostics.filter(x => x.severity === 'error' && !oldErrors.has(`${x.path}:${x.id}:${x.message}`));
    if (problems.length) throw new Error(`设置会使现有条目无效：${problems[0].message}。请先迁移使用这些定义的条目`);
    const source = patchProjectConfig(previous.source, config);
    parseConfig(source);
    const updates = [{ path: '.reqtype/project.yaml', bytes: Buffer.from(source), expected }];
    if (renderers) { const settings = renderers.settings; if (previous.renderers.version !== renderers.version) throw new Error('本机渲染设置已被外部修改，请重新载入'); updates.push({ path: '.reqtype/local/renderers.json', bytes: Buffer.from(writeRendererDocument(settings, await readOptional(await safePath(this.root, '.reqtype/local/renderers.json')).then(bytes => bytes ? decode(bytes) : undefined))), expected: renderers.version }); }
    await applyTransaction(this.root, updates.filter(update => digest(update.bytes) !== update.expected));
    return this.snapshot();
  }
  async paths(roots: string[], markdownOnly: boolean) {
    const files = new Set<string>();
    const walk = async (relative: string) => {
      const file = relative ? await safePath(this.root, relative) : this.root;
      let stat;
      try { stat = await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for (const entry of await fs.readdir(file, { withFileTypes: true })) {
          if (ignored.has(entry.name) || entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          await walk(relative ? `${relative}/${entry.name}` : entry.name);
        }
      } else if (stat.isFile() && (!markdownOnly || /\.md$/i.test(relative))) files.add(relative);
    };
    for (const root of roots.length ? roots : ['']) await walk(root);
    return [...files].sort();
  }
  async snapshot(): Promise<WorkspaceSnapshot> {
    const { configured, config } = await this.config();
    const paths = await this.paths(config.documents, true);
    const notices = this.recoveryWarnings.filter(message => message.startsWith('已恢复上次中断的导入'));
    const files: FileSnapshot[] = [], warnings = this.recoveryWarnings.filter(message => !notices.includes(message));
    const folded = new Map<string, string>();
    for (const relative of paths) {
      const previous = folded.get(relative.toLowerCase());
      if (previous && previous !== relative) warnings.push(`${previous} 与 ${relative} 存在跨平台路径大小写冲突`);
      folded.set(relative.toLowerCase(), relative);
      try {
        const bytes = await fs.readFile(await safePath(this.root, relative));
        if (bytes.length > 8 * 1024 * 1024) { warnings.push(`${relative} 超过 8 MB，未载入编辑器`); continue; }
        files.push({ path: relative, content: decode(bytes), version: digest(bytes) });
      } catch (cause) { warnings.push(`${relative}：${(cause as Error).message}`); }
    }
    return { root: this.root, config, configured, files, warnings, notices };
  }
  async save(relative: string, content: string, expected: string | null): Promise<FileSnapshot> {
    if (!/\.md$/i.test(relative)) throw new Error('编辑器只保存 Markdown 文件');
    const { config, configured } = await this.config();
    if (configured && !config.documents.some(root => relative === root || relative.startsWith(root + '/'))) throw new Error('文件路径不在项目配置的文档目录中');
    if (expected === null && (await this.paths(config.documents, true)).some(existing => existing !== relative && existing.toLowerCase() === relative.toLowerCase())) throw new Error('文件路径与已有文档存在大小写冲突');
    if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error('文档超过 8 MB，请拆分模块');
    const target = await safePath(this.root, relative), old = await readOptional(target);
    if (old) assertModuleWritable(decode(old));
    assertModuleWritable(content);
    if(old&&moduleVersion(decode(old))!==undefined&&moduleVersion(decode(old))!==moduleVersion(content))throw new Error('模块格式版本只能通过数据格式迁移修改，不能直接升降级');
    const snapshot = await this.snapshot(), before = indexWorkspace(snapshot.files, config);
    const previous = new Map(before.requirements.map(req => [req.meta.id, req]));
    for (const req of parseDocumentSource(relative, content).requirements) {
      const original = previous.get(req.meta.id);
      if (original?.meta.key && original.meta.key !== req.meta.key) throw new Error('可读编号由项目自动生成，已有编号不允许修改');
      if (!original) { const prefix=config.requirement.prefix+'-', suffix=req.meta.key?.startsWith(prefix) ? req.meta.key.slice(prefix.length) : ''; if (!suffix || !/^\d+$/.test(suffix) || !Number.isSafeInteger(Number(suffix)) || Number(suffix)<1) throw new Error('新条目须使用项目前缀和自动生成的正整数编号'); }
    }
    const oldErrors = new Set(before.diagnostics.filter(d=>d.severity==='error').map(d=>`${d.path}:${d.id}:${d.message}`));
    const candidate = snapshot.files.filter(file=>file.path!==relative).concat({path:relative,content,version:''});
    const newErrors = indexWorkspace(candidate,config).diagnostics.filter(d=>d.severity==='error' && !oldErrors.has(`${d.path}:${d.id}:${d.message}`));
    if(newErrors.length)throw new Error(`保存会产生项目错误：${newErrors[0].message}`);
    await atomicWrite(target, Buffer.from(content), expected);
    return { path: relative, content, version: digest(content) };
  }
}
