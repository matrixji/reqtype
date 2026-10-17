import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { FORMATS, assertFormatVersion, isRecord, migrateSource, type MigrationDefinition } from '../core/formats';
import { ensureModule, indexWorkspace, moduleVersion, parseDocumentSource, upgradeModuleSource } from '../core/markdown';
import { parseConfig, patchProjectConfig, validateRelativePath } from '../core/config';
import { readRendererDocument, writeRendererDocument } from '../core/rendering';
import { Workspace, applyTransaction, atomicWrite, decode, digest, exists, readJournalDocument, readOptional, safePath, writeJournalDocument } from './workspace';
import type { MigrationPreview, MigrationEntry, MigrationBackupInfo } from '../shared/types';

type MigratableKind = 'project' | 'module' | 'renderers' | 'journal';
interface Update { path: string; kind: MigratableKind; from: number; to: number; before: Buffer; bytes: Buffer; expected: string }
interface Inspection { entries: MigrationEntry[]; updates: Update[]; fingerprint: string; projectId: string | null; documents: string[] }
interface Plan { root: string; inspection: Inspection; createdAt: number }
const plans = new Map<string, Plan>();
const backupDirectory = '.reqtype/local/migrations';
const moduleDefinition = (file: string): MigrationDefinition => ({
  current: FORMATS.module.current,
  readVersion(source) { const value = moduleVersion(source); if (value === undefined) return 0; assertFormatVersion('module', value); return value; },
  validate(source) { const parsed = parseDocumentSource(file, source); if (parsed.diagnostics.some(x => x.severity === 'error')) throw new Error(parsed.diagnostics[0].message); if (!parsed.moduleId) throw new Error('缺少稳定模块 ID，迁移不会自动分配身份；请先补全模块信息'); },
  steps: [{ from: 0, to: 1, id: 'module-0-to-1', transform(source) { return ensureModule(source,parseDocumentSource(file,source).title,parseDocumentSource(file,source).moduleId!); } },
    {from:1,to:2,id:'module-1-to-2',transform(source){
      const semantics=(text:string)=>{const doc=parseDocumentSource(file,text);return JSON.stringify({module:doc.moduleId,title:doc.title,requirements:doc.requirements.map(req=>({meta:req.meta,body:req.body}))});};
      const output=upgradeModuleSource(source);if(semantics(source)!==semantics(output))throw new Error('模块迁移改变了身份、属性或正文');return output;
    }}],
});
export function migrateDataSource(kind: MigratableKind, source: string, file = 'module.md') {
  if (kind === 'module') return migrateSource(source, moduleDefinition(file));
  if (kind === 'project') return migrateSource(source, { current: FORMATS.project.current, readVersion(text) { return parseConfig(text).version; }, validate: text => { parseConfig(text); }, steps: [{ from: 1, to: 2, id: 'project-1-to-2', transform(text) { const config = parseConfig(text); return patchProjectConfig(text, { ...config, version: 2, typeAttributes: Object.fromEntries(config.types.map(type => [type, Object.keys(config.attributes ?? {})])) }); } }] });
  if (kind === 'renderers') return migrateSource(source, {
    current: FORMATS.renderers.current, readVersion: text => readRendererDocument(text).legacy ? 0 : 1,
    validate: text => { readRendererDocument(text); },
    steps: [{ from: 0, to: 1, id: 'renderers-0-to-1', transform: text => writeRendererDocument(readRendererDocument(text).value, text) }],
  });
  return migrateSource(source, {
    current: FORMATS.journal.current, readVersion: text => readJournalDocument(text).legacy ? 0 : 1,
    validate: text => { const journal = readJournalDocument(text).value; if (journal.state === 'pending' || journal.state === 'needs-attention') throw new Error('日志仍需恢复，请先打开项目完成恢复，再检查迁移'); },
    steps: [{ from: 0, to: 1, id: 'journal-0-to-1', transform: text => writeJournalDocument(readJournalDocument(text).value) + '\n' }],
  });
}
async function inspect(workspace: Workspace): Promise<Inspection> {
  const entries: MigrationEntry[] = [], updates: Update[] = [], fingerprints: string[] = [];
  let projectId: string | null = null, documents: string[] = [];
  const inspectFile = async (file: string, kind: MigratableKind) => {
    try {
    const bytes = await readOptional(await safePath(workspace.root, file));
    fingerprints.push(`${file}:${bytes ? digest(bytes) : 'missing'}`);
    if (!bytes) return;
    if (kind === 'module' && bytes.length > 8 * 1024 * 1024) throw new Error('文档超过 8 MB，请先拆分');
    const source = decode(bytes);
      if (kind === 'module' && moduleVersion(source) === undefined) {
        const parsed = parseDocumentSource(file, source);
        if (!parsed.moduleId && !parsed.requirements.length && !parsed.diagnostics.length) { entries.push({ path: file, kind, status: 'unmanaged', message: '普通 Markdown，不自动添加版本或身份' }); return; }
      }
      const result = migrateDataSource(kind, source, file);
      const changed = result.source !== source;
      entries.push({ path: file, kind, from: result.from, to: result.to, status: changed ? 'pending' : 'current', steps: result.steps,
        ...(changed ? { before: source.slice(0, 16000), after: result.source.slice(0, 16000), truncated: source.length > 16000 || result.source.length > 16000 } : {}) });
      if (changed) updates.push({ path: file, kind, from: result.from, to: result.to, before: bytes, bytes: Buffer.from(result.source), expected: digest(bytes) });
    } catch (error) { entries.push({ path: file, kind, status: 'blocked', message: (error as Error).message }); }
  };
  await inspectFile('.reqtype/project.yaml', 'project');
  if (!entries.some(entry => entry.kind === 'project' && entry.status === 'blocked')) {
    const config = await workspace.config(); projectId = config.config.id ?? null; documents = config.config.documents;
    for (const file of await workspace.paths(documents, true)) await inspectFile(file, 'module');
    const snapshot = await workspace.snapshot();
    const candidate = snapshot.files.map(file => ({ path: file.path, content: updates.find(update => update.path === file.path)?.bytes.toString('utf8') ?? file.content }));
    for (const error of indexWorkspace(candidate, updates.some(update=>update.kind==='project') ? parseConfig(updates.find(update=>update.kind==='project')!.bytes.toString('utf8')) : config.config).diagnostics.filter(error => error.severity === 'error')) {
      const row = entries.find(entry => entry.path === error.path);
      if (row) { row.status = 'blocked'; row.message = [...new Set([row.message, error.message].filter(Boolean))].join('；'); }
    }
    if (snapshot.warnings.length) entries.push({ path: '（项目扫描）', kind: 'module', status: 'blocked', message: snapshot.warnings.join('；') });
  }
  await inspectFile('.reqtype/local/renderers.json', 'renderers');
  const directory = await safePath(workspace.root, '.reqtype/local/transactions');
  if (await exists(directory)) for (const name of (await fs.readdir(directory)).sort()) if (name.endsWith('.json')) await inspectFile(`.reqtype/local/transactions/${name}`, 'journal');
  return { entries, updates, fingerprint: digest(JSON.stringify(fingerprints)), projectId, documents };
}
export async function previewMigrations(workspace: Workspace): Promise<MigrationPreview> {
  const inspection = await inspect(workspace), token = randomUUID();
  if (plans.size >= 10) plans.delete(plans.keys().next().value!);
  plans.set(token, { root: workspace.root, inspection, createdAt: Date.now() });
  return { token, entries: inspection.entries, currentVersions: Object.fromEntries(Object.entries(FORMATS).map(([kind, format]) => [kind, format.current])) };
}
interface BackupEntry { path: string; kind: MigratableKind; from: number; to: number; before: string; after: string; beforeHash: string; afterHash: string }
interface Backup { format: string; version: number; id: string; createdAt: string; projectId: string | null; documents: string[]; entries: BackupEntry[] }
function parseBackup(source: string): Backup {
  const value = JSON.parse(source);
  if (!isRecord(value) || value.format !== FORMATS.backup.id) throw new Error('不是 ReqType 迁移备份');
  assertFormatVersion('backup', value.version);
  if (typeof value.id !== 'string' || typeof value.createdAt !== 'string' || !(value.projectId === null || typeof value.projectId === 'string') || !Array.isArray(value.documents) || !Array.isArray(value.entries)) throw new Error('迁移备份结构无效');
  for (const root of value.documents) validateRelativePath(root);
  const names = new Set<string>();
  for (const entry of value.entries) {
    if (!isRecord(entry) || !['project','module','renderers','journal'].includes(entry.kind) || !Number.isSafeInteger(entry.from) || !Number.isSafeInteger(entry.to) || entry.from < 0 || entry.to <= entry.from) throw new Error('迁移备份条目无效');
    if (entry.to > FORMATS[entry.kind as MigratableKind].current) throw new Error('迁移备份包含当前应用不支持的数据版本，请使用兼容版本恢复');
    validateRelativePath(entry.path);
    const validPath = entry.kind === 'project' ? entry.path === '.reqtype/project.yaml' : entry.kind === 'renderers' ? entry.path === '.reqtype/local/renderers.json' : entry.kind === 'journal' ? /^\.reqtype\/local\/transactions\/[^/]+\.json$/.test(entry.path) : /\.md$/i.test(entry.path) && (value.documents.length === 0 || value.documents.some((root: string) => entry.path === root || entry.path.startsWith(root + '/')));
    if (!validPath || names.has(entry.path.toLowerCase())) throw new Error('迁移备份路径无效或重复'); names.add(entry.path.toLowerCase());
    for (const field of ['before', 'after'] as const) if (typeof entry[field] !== 'string' || Buffer.from(entry[field], 'base64').toString('base64') !== entry[field] || digest(Buffer.from(entry[field], 'base64')) !== entry[field + 'Hash']) throw new Error('迁移备份内容校验失败');
  }
  return value as Backup;
}
const backupPath = (id: string) => { if (!/^\d{13}-[a-f\d-]{36}$/.test(id)) throw new Error('迁移备份 ID 无效'); return `${backupDirectory}/${id}.json`; };
export async function applyMigrations(workspace: Workspace, token: string, afterWrite?: (index: number) => void | Promise<void>) {
  const plan = plans.get(token);
  if (!plan || plan.root !== workspace.root || Date.now() - plan.createdAt > 10 * 60 * 1000) throw new Error('迁移预览已过期，请重新检查');
  if (plan.inspection.entries.some(entry => entry.status === 'blocked')) throw new Error('存在不支持或损坏的格式，未修改任何文件');
  const current = await inspect(workspace);
  if (current.fingerprint !== plan.inspection.fingerprint) throw new Error('预览后项目文件已变化，请重新检查迁移');
  if (current.entries.some(entry => entry.status === 'blocked')) throw new Error('项目当前存在不支持或损坏的格式，未修改任何文件');
  if (!current.updates.length) return { snapshot: await workspace.snapshot(), backupId: null };
  const id = `${Date.now()}-${randomUUID()}`;
  const backup: Backup = { format: FORMATS.backup.id, version: FORMATS.backup.current, id, createdAt: new Date().toISOString(), projectId: current.projectId, documents: current.documents,
    entries: current.updates.map(update => ({ path: update.path, kind: update.kind, from: update.from, to: update.to, before: update.before.toString('base64'), after: update.bytes.toString('base64'), beforeHash: update.expected, afterHash: digest(update.bytes) })) };
  const bytes = Buffer.from(JSON.stringify(backup, null, 2) + '\n'); parseBackup(decode(bytes));
  await atomicWrite(await safePath(workspace.root, backupPath(id)), bytes, null);
  try { await applyTransaction(workspace.root, current.updates, afterWrite); } catch (error) { throw new Error(`迁移未完成，备份 ${id} 已保留：${(error as Error).message}`); }
  plans.delete(token);
  return { snapshot: await workspace.snapshot(), backupId: id };
}
export async function restoreMigration(workspace: Workspace, id: string) {
  const backup = parseBackup(decode(await fs.readFile(await safePath(workspace.root, backupPath(id)))));
  const project = await workspace.config();
  if (backup.id !== id || backup.projectId !== (project.config.id ?? null)) throw new Error('迁移备份不属于当前项目');
  const updates = [];
  for (const entry of backup.entries) {
    const file = await safePath(workspace.root, entry.path), bytes = await readOptional(file);
    const hash = bytes ? digest(bytes) : null;
    if (hash === entry.beforeHash) continue;
    if (hash !== entry.afterHash) throw new Error(`${entry.path} 在迁移后发生修改，恢复已阻止；未覆盖任何文件`);
    updates.push({ path: entry.path, bytes: Buffer.from(entry.before, 'base64'), expected: entry.afterHash });
  }
  if (updates.length) await applyTransaction(workspace.root, updates);
  return workspace.snapshot();
}
export async function migrationBackups(workspace: Workspace): Promise<MigrationBackupInfo[]> {
  const directory = await safePath(workspace.root, backupDirectory);
  if (!await exists(directory)) return [];
  const result: MigrationBackupInfo[] = [];
  for (const file of (await fs.readdir(directory)).sort().reverse()) if (file.endsWith('.json')) {
    const id = file.slice(0,-5);
    try { const backup = parseBackup(decode(await fs.readFile(await safePath(workspace.root, backupPath(id))))); result.push({ id, createdAt: backup.createdAt, paths: backup.entries.map(entry => entry.path) }); }
    catch (error) { result.push({ id, paths: [], error: (error as Error).message }); }
  }
  return result;
}
