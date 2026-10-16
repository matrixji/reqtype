import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { parseDocument as parseYaml, isMap, stringify, visit } from 'yaml';
import { assertFormatVersion, FORMATS } from './formats';
import type { Diagnostic, FileSnapshot, ParsedDocument, ProjectConfig, Requirement, RequirementMeta } from '../shared/types';

type Node = { type: string; value?: string; depth?: number; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const startOf = (node: Node) => node.position?.start.offset ?? 0;
const endOf = (node: Node) => node.position?.end.offset ?? 0;
const textOf = (node: Node): string => node.value ?? node.children?.map(textOf).join('') ?? '';
export const lineEnding = (source: string) => source.includes('\r\n') ? '\r\n' : '\n';

export function frontmatter(source: string) {
  const header = /^\uFEFF?---[ \t]*\r?\n/.exec(source);
  if (!header) return undefined;
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(source.slice(header[0].length));
  if (!closing) return undefined;
  const start = header[0].length + closing.index;
  const trailing = source.slice(0, start).endsWith('\r\n') ? 2 : 1;
  return { from: 0, to: start + closing[0].length, yamlFrom: header[0].length, yamlTo: Math.max(header[0].length, start - trailing) };
}

function readYaml(source: string): Record<string, unknown> {
  if (!source.trim()) return {};
  const doc = parseYaml(source, { keepSourceTokens: true, uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error((doc.errors[0] ?? doc.warnings[0]).message.split('\n')[0]);
  visit(doc, { Alias() { throw new Error('元数据不支持 YAML 别名'); } });
  const value: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('元数据必须是键值映射');
  return value as Record<string, unknown>;
}

export function markdownTree(source: string): Node {
  const fm = frontmatter(source);
  const masked = fm ? source.slice(0, fm.to).replace(/[^\r\n]/g, ' ') + source.slice(fm.to) : source;
  return parser.parse(masked) as Node;
}

export function parseDocumentSource(path: string, source: string): ParsedDocument {
  const result: ParsedDocument = { path, title: path.split('/').pop()?.replace(/\.md$/i, '') ?? path, requirements: [], diagnostics: [], headings: [], blocks: [], readOnly: false };
  const error = (from: number, message: string) => result.diagnostics.push({ path, from, severity: 'error', message });
  const fm = frontmatter(source);
  result.frontmatter = fm;
  if (fm) {
    try { assertModuleWritable(source); } catch (cause) { result.readOnly = true; error(0, (cause as Error).message); return result; }
    try {
      const meta = readYaml(source.slice(fm.yamlFrom, fm.yamlTo));
      if (typeof meta.title === 'string') result.title = meta.title;
      if (meta.reqtype !== undefined) { try { assertFormatVersion('module', meta.reqtype); } catch (cause) { result.readOnly = true; error(0, (cause as Error).message); return result; } }
      if (typeof meta.module === 'string' && uuid.test(meta.module)) result.moduleId = meta.module;
      else if (meta.module !== undefined) error(0, '模块 ID 必须是 UUID');
    } catch (cause) { error(0, `文档元数据：${(cause as Error).message}`); }
  }
  const tree = markdownTree(source);
  let open: { from: number; end: number; metaFrom: number; metaTo: number; meta?: RequirementMeta; invalid: boolean } | undefined;
  for (const node of tree.children ?? []) {
    const from = startOf(node), to = endOf(node);
    result.blocks.push({ from, to, type: node.type });
    if (node.type === 'heading') result.headings.push({ depth: node.depth ?? 1, text: textOf(node), from });
    if (node.type !== 'html') continue;
    const raw = source.slice(from, to);
    if (/^<!-- req(?:\r?\n|$)/.test(raw)) {
      if (open) { error(from, '需求块不支持嵌套，请先修复边界'); open.invalid = true; continue; }
      const match = /^(<!-- req\r?\n)([\s\S]*?)\r?\n-->[ \t]*$/.exec(raw);
      if (!match) { error(from, '需求起始标记不完整，或元数据含有注释终止符'); continue; }
      open = { from, end: to, metaFrom: from + match[1].length, metaTo: from + match[1].length + match[2].length, invalid: false };
      try {
        const meta = readYaml(match[2]);
        if (typeof meta.id !== 'string' || !uuid.test(meta.id)) throw new Error('条目 ID 必须是 UUID');
        for (const field of ['key', 'type', 'status', 'priority']) if (meta[field] !== undefined && typeof meta[field] !== 'string') throw new Error(`${field} 必须是字符串`);
        if (meta.tags !== undefined && (!Array.isArray(meta.tags) || meta.tags.some(x => typeof x !== 'string'))) throw new Error('tags 必须是字符串列表');
        if (meta.attributes !== undefined && (!meta.attributes || typeof meta.attributes !== 'object' || Array.isArray(meta.attributes))) throw new Error('attributes 必须是键值映射');
        if (meta.links !== undefined && (!Array.isArray(meta.links) || meta.links.some(link => !link || typeof link.type !== 'string' || typeof link.target !== 'string' || !uuid.test(link.target)))) throw new Error('links 必须包含关联类型和目标 UUID');
        open.meta = meta as RequirementMeta;
      } catch (cause) { error(from, `需求元数据：${(cause as Error).message}`); open.invalid = true; }
    } else if (/^<!-- \/req -->[ \t]*$/.test(raw)) {
      if (!open) { error(from, '结束标记没有对应的需求起始标记'); continue; }
      if (!open.invalid && open.meta) {
        const body = source.slice(open.end, from).trim();
        const bodyTree = markdownTree(body);
        const first = bodyTree.children?.find(node => node.type !== 'html');
        const title = (first ? textOf(first) : '').replace(/\s+/g, ' ').slice(0, 100) || open.meta.key || '未命名需求';
        result.requirements.push({ path, meta: open.meta, title, body, from: open.from, to, metaFrom: open.metaFrom, metaTo: open.metaTo, bodyFrom: open.end, bodyTo: from });
      }
      open = undefined;
    }
  }
  if (open) error(open.from, '需求块缺少结束标记');
  const codeRanges = result.blocks.filter(x => x.type === 'code');
  for (const match of source.matchAll(/^(?:<<<<<<< .+|=======|>>>>>>> .+)\r?$/gm)) {
    if (!codeRanges.some(x => match.index! >= x.from && match.index! < x.to)) error(match.index!, '文档包含未解决的 Git 合并标记');
  }
  if (result.requirements.length && !result.moduleId) error(0, '包含需求的文档缺少稳定模块 ID，请使用“补全模块信息”');
  if (!fm && result.headings[0]) result.title = result.headings[0].text;
  return result;
}

export function indexWorkspace(files: Pick<FileSnapshot, 'path' | 'content'>[], config: ProjectConfig) {
  const documents = files.map(file => parseDocumentSource(file.path, file.content));
  const requirements = documents.flatMap(doc => doc.requirements);
  const diagnostics = documents.flatMap(doc => doc.diagnostics);
  const ids = new Map<string, Requirement[]>(), keys = new Map<string, Requirement[]>(), modules = new Map<string, string>();
  const add = (req: Requirement, message: string, severity: Diagnostic['severity'] = 'error') => diagnostics.push({ path: req.path, from: req.from, id: req.meta.id, severity, message });
  for (const doc of documents) if (doc.moduleId) {
    if (modules.has(doc.moduleId)) diagnostics.push({ path: doc.path, from: 0, severity: 'error', message: `模块 ID 与 ${modules.get(doc.moduleId)} 重复` });
    modules.set(doc.moduleId, doc.path);
  }
  for (const req of requirements) {
    ids.set(req.meta.id, [...(ids.get(req.meta.id) ?? []), req]);
    if (req.meta.key) keys.set(req.meta.key, [...(keys.get(req.meta.key) ?? []), req]);
    for (const [field, allowed] of [['type', config.types], ['status', config.statuses], ['priority', config.priorities]] as const) {
      const value = req.meta[field] ?? (field === 'type' ? 'requirement' : field === 'status' ? 'draft' : undefined);
      if (value && !allowed.includes(value as string)) add(req, `未定义的 ${field}：${String(value)}`);
    }
    for (const [name, definition] of Object.entries(config.attributes ?? {})) {
      const value = req.meta.attributes?.[name];
      if (value === undefined) continue;
      if (definition.type === 'enum' ? !definition.values?.includes(value as string) : typeof value !== definition.type) add(req, `自定义属性 ${name} 的值不符合项目定义`);
    }
  }
  for (const [id, matches] of ids) if (matches.length > 1) matches.forEach(req => add(req, `重复的条目 ID：${id}`));
  for (const [key, matches] of keys) if (matches.length > 1) matches.forEach(req => add(req, `重复的可读编号：${key}`));
  for (const req of requirements) {
    const links = new Set<string>();
    for (const link of req.meta.links ?? []) {
      if (!config.linkTypes.includes(link.type)) add(req, `未定义的关联类型：${link.type}`);
      if (!ids.has(link.target)) add(req, `关联目标不存在：${link.target}`, 'warning');
      if ((ids.get(link.target)?.length ?? 0) > 1) add(req, `关联目标 ID 有歧义：${link.target}`);
      if (links.has(`${link.type}:${link.target}`)) add(req, '存在重复关联');
      links.add(`${link.type}:${link.target}`);
    }
  }
  return { documents, requirements, diagnostics };
}

function patchYamlField(yaml: string, field: string, value: unknown): string {
  const doc = parseYaml(yaml, { keepSourceTokens: true, uniqueKeys: true });
  if (!yaml.trim()) return `${field}: ${JSON.stringify(value)}`;
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('元数据无效，请先修复源码');
  const pair = doc.contents.items.find(pair => String((pair.key as { value?: unknown })?.value) === field);
  const range = (pair?.value as { range?: [number, number, number] } | undefined)?.range;
  const encoded = JSON.stringify(value);
  if (encoded === undefined || encoded.includes('-->')) throw new Error('属性值不能包含注释终止符');
  if (range) return yaml.slice(0, range[0]) + encoded + (yaml.slice(range[0], range[1]).endsWith('\n') ? lineEnding(yaml) : '') + yaml.slice(range[1]);
  if (pair) {
    const keyRange = (pair.key as { range: number[] }).range;
    const colon = yaml.indexOf(':', keyRange[1]);
    return yaml.slice(0, colon + 1) + ' ' + encoded + yaml.slice(colon + 1);
  }
  const eol = lineEnding(yaml);
  return yaml + (yaml.endsWith('\n') ? '' : eol) + `${field}: ${encoded}`;
}

export function moduleVersion(source: string): unknown {
  const fm = frontmatter(source); if (!fm) return undefined;
  const doc = parseYaml(source.slice(fm.yamlFrom, fm.yamlTo), { uniqueKeys: true });
  return isMap(doc.contents) && doc.has('reqtype') ? doc.get('reqtype') : undefined;
}
export function assertModuleWritable(source: string) {
  const version = moduleVersion(source);
  if (version !== undefined) assertFormatVersion('module', version);
}

export function patchRequirement(source: string, req: Requirement, field: string, value: unknown) {
  assertModuleWritable(source);
  if (field === 'id') throw new Error('稳定 ID 不可修改');
  const yaml = source.slice(req.metaFrom, req.metaTo);
  if (readYaml(yaml).id !== req.meta.id) throw new Error('条目位置已变化，请重新选择');
  return source.slice(0, req.metaFrom) + patchYamlField(yaml, field, value) + source.slice(req.metaTo);
}

export function ensureModule(source: string, title: string, moduleId: string): string {
  const fm = frontmatter(source), eol = lineEnding(source);
  if (fm) {
    let yaml = source.slice(fm.yamlFrom, fm.yamlTo);
    const meta = readYaml(yaml);
    if (meta.reqtype !== undefined) assertFormatVersion('module', meta.reqtype);
    if (meta.module !== undefined && (typeof meta.module !== 'string' || !uuid.test(meta.module))) throw new Error('已有模块 ID 无效，请修复后继续');
    if (meta.reqtype !== FORMATS.module.current) yaml = patchYamlField(yaml, 'reqtype', FORMATS.module.current);
    if (!meta.module) yaml = patchYamlField(yaml, 'module', moduleId);
    const tail = source.slice(fm.yamlTo);
    return source.slice(0, fm.yamlFrom) + yaml + (/^\r?\n/.test(tail) ? '' : eol) + tail;
  }
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  return bom + ['---', `reqtype: ${FORMATS.module.current}`, `module: "${moduleId}"`, `title: ${JSON.stringify(title)}`, '---', '', ''].join(eol) + source.slice(bom.length);
}

export function makeRequirement(body: string, meta: RequirementMeta, eol = '\n') {
  const yaml = stringify(meta, { lineWidth: 0 }).trimEnd();
  if (yaml.includes('-->')) throw new Error('元数据不能包含注释终止符');
  return `<!-- req${eol}${yaml.replace(/\n/g, eol)}${eol}-->${eol}${eol}${body}${eol}${eol}<!-- /req -->`;
}

export function wrapSelection(source: string, path: string, from: number, to: number, meta: RequirementMeta, moduleId: string) {
  const parsed = parseDocumentSource(path, source);
  if (parsed.diagnostics.some(x => x.severity === 'error' && !x.message.includes('缺少稳定模块'))) throw new Error('请先修复文档中的语法错误');
  const blocks = parsed.blocks.filter(block => block.to > from && block.from < Math.max(to, from + 1));
  if (!blocks.length) throw new Error('请先选择一个或多个完整内容块');
  const start = blocks[0].from, end = blocks.at(-1)!.to;
  if (parsed.requirements.some(req => start < req.to && end > req.from)) throw new Error('选区与已有条目重叠，需求块不能嵌套');
  const eol = lineEnding(source);
  const wrapped = source.slice(0, start) + makeRequirement(source.slice(start, end), meta, eol) + source.slice(end);
  return ensureModule(wrapped, parsed.title, moduleId);
}

export function moveRequirement(source: string, path: string, id: string, direction: -1 | 1) {
  const parsed = parseDocumentSource(path, source);
  if (parsed.diagnostics.some(x => x.severity === 'error')) throw new Error('请先修复文档诊断');
  const index = parsed.requirements.findIndex(req => req.meta.id === id);
  const other = parsed.requirements[index + direction];
  const selected = parsed.requirements[index];
  if (!selected || !other) return source;
  const [first, second] = selected.from < other.from ? [selected, other] : [other, selected];
  return source.slice(0, first.from) + source.slice(second.from, second.to) + source.slice(first.to, second.from) + source.slice(first.from, first.to) + source.slice(second.to);
}

export function nextKey(requirements: Requirement[], prefix = 'REQ', padding = 3) {
  const used = new Set(requirements.map(req => req.meta.key));
  let number = 1;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const key of used) { const match = key?.match(new RegExp(`^${escaped}-(\\d+)$`)); if (match) number = Math.max(number, Number(match[1]) + 1); }
  return `${prefix}-${String(number).padStart(padding, '0')}`;
}
