/** Data versions are independent of the application version and file content hashes. */
export const FORMATS = {
  project: { name: '项目配置', id: 'reqtype.project', current: 1 },
  module: { name: 'Markdown 模块', id: 'reqtype.module', current: 1 },
  exchange: { name: '交换包', id: 'reqtype', current: 1 },
  renderers: { name: '本机渲染设置', id: 'reqtype.renderers', current: 1 },
  journal: { name: '文件恢复日志', id: 'reqtype.transaction', current: 1 },
  preferences: { name: '最近项目设置', id: 'reqtype.preferences', current: 1 },
  plugins: { name: '插件启用设置', id: 'reqtype.plugin-state', current: 1 },
  backup: { name: '迁移备份', id: 'reqtype.migration-backup', current: 1 },
} as const;
export type FormatKind = keyof typeof FORMATS;
export class FormatVersionError extends Error {
  constructor(public kind: FormatKind, public found: unknown) {
    super(`${FORMATS[kind].name}格式版本 ${String(found)} 不受支持，当前支持 v${FORMATS[kind].current}；已阻止修改，请使用支持该版本的应用`);
    this.name = 'FormatVersionError';
  }
}
export const isRecord = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function assertFormatVersion(kind: FormatKind, value: unknown): asserts value is 1 {
  if (!Number.isSafeInteger(value) || value !== FORMATS[kind].current) throw new FormatVersionError(kind, value);
}
export function readEnvelope<T>(kind: 'renderers' | 'journal' | 'preferences' | 'plugins', input: unknown, validate: (payload: unknown) => T): { value: T; legacy: boolean; envelope: Record<string, any> } {
  if (kind === 'plugins' && Array.isArray(input)) return { value: validate(input), legacy: true, envelope: {} };
  if (!isRecord(input)) throw new Error(`${FORMATS[kind].name}必须是对象`);
  // Unversioned layouts shipped by 0.1.0 are the only recognized legacy v0.
  if (!Object.hasOwn(input, 'format') && !Object.hasOwn(input, 'version')) return { value: validate(input), legacy: true, envelope: {} };
  if (input.format !== FORMATS[kind].id) throw new Error(`${FORMATS[kind].name}格式标识无效`);
  assertFormatVersion(kind, input.version);
  return { value: validate(input.payload), legacy: false, envelope: input };
}
export function envelope(kind: 'renderers' | 'journal' | 'preferences' | 'plugins', payload: unknown, previous: Record<string, any> = {}) {
  return { ...previous, format: FORMATS[kind].id, version: FORMATS[kind].current, payload };
}

export interface MigrationStep { from: number; to: number; id: string; transform(source: string): string }
export interface MigrationDefinition { current: number; readVersion(source: string): number; steps: readonly MigrationStep[]; validate(source: string): void }
/** A deterministic forward-only chain. Future versions never enter a transformer. */
export function migrateSource(source: string, definition: MigrationDefinition) {
  let version = definition.readVersion(source);
  if (!Number.isSafeInteger(version) || version < 0 || version > definition.current) throw new Error(`无法迁移格式版本 ${version} → ${definition.current}`);
  const steps = new Map<number, MigrationStep>();
  for (const step of definition.steps) {
    if (!Number.isSafeInteger(step.from) || step.from < 0 || step.to !== step.from + 1 || steps.has(step.from)) throw new Error('迁移步骤必须唯一且逐版本递增');
    steps.set(step.from, step);
  }
  const originalVersion = version, applied: string[] = [];
  definition.validate(source);
  while (version < definition.current) {
    const step = steps.get(version);
    if (!step) throw new Error(`缺少 v${version} → v${version + 1} 的迁移步骤`);
    source = step.transform(source);
    if (definition.readVersion(source) !== step.to) throw new Error(`迁移 ${step.id} 未生成目标版本`);
    definition.validate(source); applied.push(step.id); version = step.to;
  }
  return { source, from: originalVersion, to: version, steps: applied };
}
