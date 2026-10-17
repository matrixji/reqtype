import { isMap, parseDocument, stringify, visit } from 'yaml';
import { assertFormatVersion, FORMATS } from './formats';
import type { ProjectConfig } from '../shared/types';

export const defaultConfig = (name = '我的需求项目'): ProjectConfig => ({
  version: FORMATS.project.current, name, description: '', documents: ['modules'], assets: ['assets'],
  types: ['need', 'requirement', 'test'], statuses: ['draft', 'reviewed', 'approved', 'retired'],
  priorities: ['low', 'normal', 'high', 'critical'], linkTypes: ['satisfies', 'verifies', 'depends_on'], attributes: { owner: { type: 'string' } }, typeAttributes: { need: ['owner'], requirement: ['owner'], test: ['owner'] },
  requirement: { prefix: 'REQ', padding: 3, defaultType: 'requirement', defaultPriority: 'normal' },
  workflow: { initial: 'draft', transitions: { draft: ['reviewed'], reviewed: ['draft', 'approved'], approved: ['reviewed', 'retired'], retired: ['draft'] } },
  general: { defaultView: 'document', spellcheck: false },
  exports: { defaultFormat: 'json', fileName: '{project}-{date}', prettyJson: true },
});
export function validateRelativePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /[<>:"|?*\x00-\x1F]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || ['.git', 'node_modules'].includes(part.toLowerCase()))) throw new Error(`不允许的项目路径：${String(value)}`);
}
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: unknown, empty = false): value is string[] => Array.isArray(value) && (empty || value.length > 0) && value.every(x => typeof x === 'string' && x.trim() === x && x.length > 0) && new Set(value).size === value.length;
export function parseConfig(source: string): ProjectConfig {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error(`项目配置无效：${(doc.errors[0] ?? doc.warnings[0]).message}`);
  visit(doc, { Alias() { throw new Error('项目配置不支持 YAML 别名'); } });
  const value = doc.toJS({ maxAliasCount: 0 });
  if (!object(value)) throw new Error('项目配置必须是映射');
  assertFormatVersion('project', value.version);
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('项目配置必须包含非空 name');
  const defaults = defaultConfig(value.name);
  for (const field of ['requirement', 'workflow', 'general', 'exports']) if (value[field] !== undefined && !object(value[field])) throw new Error(`项目配置 ${field} 必须是映射`);
  const config: ProjectConfig = { ...defaults, ...value,
    requirement: { ...defaults.requirement, ...value.requirement },
    workflow: value.workflow ? { ...defaults.workflow, ...value.workflow } : defaults.workflow,
    general: { ...defaults.general, ...value.general }, exports: { ...defaults.exports, ...value.exports },
  };
  for (const field of ['documents', 'assets', 'types', 'statuses', 'priorities', 'linkTypes'] as const) {
    if (!strings(config[field])) throw new Error(`项目配置 ${field} 必须是非空且不重复的字符串列表`);
  }
  for (const path of [...config.documents, ...config.assets]) validateRelativePath(path);
  if (config.id !== undefined && (typeof config.id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(config.id))) throw new Error('项目 id 必须是 UUID');
  if (config.description !== undefined && typeof config.description !== 'string') throw new Error('项目说明必须是文本');
  // Older projects can use custom lists without defining the new defaults yet.
  if (!value.requirement?.defaultType && !config.types.includes(config.requirement.defaultType)) config.requirement.defaultType = config.types[0];
  if (!value.requirement?.defaultPriority && !config.priorities.includes(config.requirement.defaultPriority)) config.requirement.defaultPriority = config.priorities[0];
  if (!value.workflow && JSON.stringify(config.statuses) !== JSON.stringify(defaults.statuses)) config.workflow = { initial: config.statuses.includes('draft') ? 'draft' : config.statuses[0], transitions: Object.fromEntries(config.statuses.map(status => [status, config.statuses.filter(x => x !== status)])) };
  const req = config.requirement;
  if (typeof req.prefix !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,31}$/u.test(req.prefix)) throw new Error('需求前缀须为 1–32 位字母、数字、下划线、点或连字符，并以字母或数字开头');
  if (!Number.isInteger(req.padding) || req.padding < 1 || req.padding > 9) throw new Error('编号位数须为 1–9 的整数');
  if (!config.types.includes(req.defaultType) || !config.priorities.includes(req.defaultPriority)) throw new Error('默认类型和优先级必须在对应列表内');
  if (!config.statuses.includes(config.workflow.initial) || !object(config.workflow.transitions)) throw new Error('工作流须指定有效初始状态和转换映射');
  for (const [status, targets] of Object.entries(config.workflow.transitions)) if (!config.statuses.includes(status) || !strings(targets, true) || targets.some(target => !config.statuses.includes(target) || target === status)) throw new Error(`状态转换无效：${status}`);
  for (const status of config.statuses) if (!Object.hasOwn(config.workflow.transitions, status)) throw new Error(`缺少状态转换定义：${status}（终态使用 []）`);
  if (!['document', 'table'].includes(config.general.defaultView) || typeof config.general.spellcheck !== 'boolean') throw new Error('通用设置无效');
  if (!['json', 'markdown'].includes(config.exports.defaultFormat) || typeof config.exports.prettyJson !== 'boolean' || typeof config.exports.fileName !== 'string' || !config.exports.fileName.trim() || /[/\\<>:"|?*\x00-\x1F]/.test(config.exports.fileName) || /\{(?!project\}|date\}|module\})/.test(config.exports.fileName)) throw new Error('导出设置无效，文件名支持 {project}、{date}、{module}');
  if (config.attributes !== undefined && !object(config.attributes)) throw new Error('attributes 必须是属性定义映射');
  for (const [key, def] of Object.entries(config.attributes ?? {})) if (!object(def) || !['string', 'number', 'array', 'boolean', 'enum'].includes(def.type) || (def.type === 'enum' && !strings(def.values)) || (def.type === 'array' && def.items !== undefined && !['string','number'].includes(def.items)) || (def.label !== undefined && typeof def.label !== 'string') || (def.description !== undefined && typeof def.description !== 'string') || !key.trim() || key.length > 80 || ['__proto__','constructor','prototype'].includes(key)) throw new Error(`属性定义无效：${key}`);
  if (config.version === 1) {
    if (Object.values(config.attributes ?? {}).some(def => def.type === 'array') || value.typeAttributes !== undefined) throw new Error('按类型属性与数组需要项目格式 v2，请先检查并升级数据格式');
    delete config.typeAttributes;
  } else {
    config.typeAttributes = value.typeAttributes ?? Object.fromEntries(config.types.map(type => [type, Object.keys(config.attributes ?? {})]));
    if (!object(config.typeAttributes)) throw new Error('typeAttributes 必须是类型到属性列表的映射');
    for (const [type, names] of Object.entries(config.typeAttributes!)) if (!config.types.includes(type) || !strings(names, true) || names.some(name => !Object.hasOwn(config.attributes ?? {}, name))) throw new Error(`类型属性定义无效：${type}`);
  }
  return config;
}

// Update owned fields through YAML nodes; unrelated extension fields/comments survive.
export function patchProjectConfig(source: string, config: ProjectConfig): string {
  parseConfig(stringify(config));
  const doc = parseDocument(source || 'version: 1\nname: New project\n');
  const merge = (parts: string[], value: unknown) => {
    const old = doc.getIn(parts, true);
    if (isMap(old) && object(value)) for (const [key, child] of Object.entries(value)) merge([...parts, key], child);
    else if (JSON.stringify(doc.getIn(parts)) !== JSON.stringify(value)) doc.setIn(parts, value);
  };
  for (const field of ['version', 'id', 'name', 'description', 'documents', 'assets', 'types', 'statuses', 'priorities', 'linkTypes', 'requirement', 'general', 'exports'] as const) if (config[field] !== undefined) merge([field], config[field]);
  // Removed transitions/attribute definitions must actually disappear; preserve unknown settings elsewhere.
  for (const field of ['workflow', 'attributes', 'typeAttributes'] as const) {
    const current = doc.get(field, true);
    if (field === 'workflow' && isMap(current)) { merge(['workflow', 'initial'], config.workflow.initial); const map = doc.getIn(['workflow', 'transitions'], true); if (isMap(map)) for (const pair of [...map.items]) if (!Object.hasOwn(config.workflow.transitions, String(pair.key))) map.delete(pair.key); merge(['workflow', 'transitions'], config.workflow.transitions); }
    else if ((field === 'attributes' || field === 'typeAttributes') && isMap(current)) { for (const pair of [...current.items]) if (!Object.hasOwn(config[field] ?? {}, String(pair.key))) current.delete(pair.key); merge([field], config[field] ?? {}); }
    else if (config[field] !== undefined) merge([field], config[field]);
  }
  const output = doc.toString({ lineWidth: 0 });
  return source.includes('\r\n') ? output.replace(/\r?\n/g, '\r\n') : output;
}
export const statusOptions = (config: ProjectConfig, current = 'draft') => [current, ...config.workflow.transitions[current] ?? []].filter((value, index, all) => all.indexOf(value) === index);
export function assertTransition(config: ProjectConfig, from: string, to: unknown) {
  if (typeof to !== 'string' || !statusOptions(config, from).includes(to)) throw new Error(`工作流不允许 ${from} → ${String(to)}`);
}
export function exportFileName(config: ProjectConfig, kind: 'json' | 'markdown', document = 'document.md', date = new Date()) {
  const safe = (text: string) => text.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '') || 'project';
  const stem = config.exports.fileName.replace(/\{project\}/g, safe(config.name)).replace(/\{date\}/g, date.toISOString().slice(0, 10)).replace(/\{module\}/g, safe(document.split('/').pop()?.replace(/\.md$/i, '') || 'document'));
  return safe(stem) + (kind === 'json' ? '.reqtype.json' : '.md');
}

export function attributesForType(config: ProjectConfig, type: string) {
  const names = config.version === 1 ? Object.keys(config.attributes ?? {}) : Object.hasOwn(config.typeAttributes ?? {},type) ? config.typeAttributes![type] : [];
  return Object.fromEntries(names.filter(name => Object.hasOwn(config.attributes ?? {}, name)).map(name => [name, config.attributes![name]]));
}
export function validAttribute(value: unknown, definition: NonNullable<ProjectConfig['attributes']>[string]) {
  if (definition.type === 'array') return Array.isArray(value) && value.every(item => typeof item === (definition.items ?? 'string') && (typeof item !== 'number' || Number.isFinite(item)));
  if (definition.type === 'enum') return typeof value === 'string' && Boolean(definition.values?.includes(value));
  return typeof value === definition.type && (typeof value !== 'number' || Number.isFinite(value));
}
