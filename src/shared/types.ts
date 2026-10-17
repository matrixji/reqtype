export interface AttributeDefinition { type: 'string' | 'number' | 'array' | 'boolean' | 'enum'; label?: string; description?: string; values?: string[]; items?: 'string' | 'number'; [key: string]: unknown }
export interface Link { type: string; target: string }
export interface RequirementMeta {
  id: string; key?: string; title?: string; type?: string; status?: string; priority?: string;
  tags?: string[]; links?: Link[]; attributes?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface Requirement {
  path: string; meta: RequirementMeta; title: string; body: string;
  from: number; to: number; metaFrom: number; metaTo: number; bodyFrom: number; bodyTo: number;
}
export interface Diagnostic { path: string; from: number; severity: 'error' | 'warning'; message: string; id?: string }
export interface Heading { depth: number; text: string; from: number }
export interface ParsedDocument { readOnly: boolean; path: string; moduleId?: string; title: string; requirements: Requirement[]; diagnostics: Diagnostic[]; headings: Heading[]; frontmatter?: { from: number; to: number; yamlFrom: number; yamlTo: number }; blocks: { from: number; to: number; type: string }[] }
export interface FileSnapshot { path: string; content: string; version: string }
export interface ProjectConfig {
  version: 1 | 2; id?: string; name: string; description?: string; documents: string[]; assets: string[];
  types: string[]; statuses: string[]; priorities: string[]; linkTypes: string[];
  requirement: { prefix: string; padding: number; defaultType: string; defaultPriority: string };
  workflow: { initial: string; transitions: Record<string, string[]> };
  general: { defaultView: 'document' | 'table'; spellcheck: boolean };
  exports: { defaultFormat: 'json' | 'markdown'; fileName: string; prettyJson: boolean };
  attributes?: Record<string, AttributeDefinition>;
  typeAttributes?: Record<string, string[]>;
}
export interface PlantUMLSettings { mode: 'jar' | 'server'; jarPath: string; javaPath: string; graphvizPath: string; serverUrl: string }
export interface RendererSettings { settings: PlantUMLSettings; version: string | null }
export interface ProjectSettings { config: ProjectConfig; source: string; version: string | null; renderers: RendererSettings }
export interface WorkspaceSnapshot { root: string; config: ProjectConfig; configured: boolean; files: FileSnapshot[]; warnings: string[]; notices?: string[] }
export interface MigrationEntry { path: string; kind: string; from?: number; to?: number; status: 'current' | 'pending' | 'blocked' | 'unmanaged'; steps?: string[]; message?: string; before?: string; after?: string; truncated?: boolean }
export interface MigrationPreview { token: string; entries: MigrationEntry[]; currentVersions: Record<string, number> }
export interface MigrationBackupInfo { id: string; createdAt?: string; paths: string[]; error?: string }
export interface GitFile { path: string; code: string; originalPath?: string }
export interface GitCommit { hash: string; short: string; subject: string; author: string; date: string }
export interface GitState { available: boolean; repository: boolean; branch: string; files: GitFile[]; history: GitCommit[]; error?: string }
export interface ExchangeEntry { path: string; encoding: 'utf8' | 'base64'; content: string; sha256: string }
export interface ExchangePackage { format: 'reqtype'; version: 1; exportedAt: string; files: ExchangeEntry[] }
export interface ImportPreview { token: string; name: string; entries: { path: string; status: 'new' | 'update' | 'unchanged'; bytes: number }[]; warnings: string[] }
export interface PluginContribution { id: string; title: string; extension?: string; extensions?: string[]; languages?: string[] }
export interface PluginInfo { id: string; name: string; version: string; enabled: boolean; builtin: boolean; error?: string; commands: PluginContribution[]; validators: PluginContribution[]; exporters: PluginContribution[]; importers: PluginContribution[]; renderers: PluginContribution[] }
export interface PluginSnapshot { files: FileSnapshot[]; requirements: Requirement[]; config: ProjectConfig }
export interface PluginResult { html?: string; message?: string; diagnostics?: Diagnostic[]; text?: string; files?: { path: string; content: string }[]; importPreview?: ImportPreview; edits?: { path: string; expectedSource: string; source: string }[] }
export interface TypeMigrationPreview { token: string; from: string; to: string; entries: { path: string; id: string; key?: string; title: string }[]; warnings: string[] }
export interface DesktopAPI {
  initial(): Promise<WorkspaceSnapshot | null>;
  open(create?: boolean): Promise<WorkspaceSnapshot | null>;
  refresh(): Promise<WorkspaceSnapshot>;
  save(path: string, content: string, expectedVersion: string | null): Promise<FileSnapshot>;
  projectSettings(): Promise<ProjectSettings>;
  saveProject(config: ProjectConfig, expectedVersion: string | null, renderers?: RendererSettings): Promise<WorkspaceSnapshot>;
  export(kind: 'json' | 'markdown', path?: string): Promise<string | null>;
  prepareImport(): Promise<ImportPreview | null>;
  applyImport(token: string, paths: string[]): Promise<WorkspaceSnapshot>;
  previewTypeMigration(from: string, to: string): Promise<TypeMigrationPreview>;
  applyTypeMigration(token: string): Promise<WorkspaceSnapshot>;
  previewMigrations(): Promise<MigrationPreview>;
  applyMigrations(token: string): Promise<{ snapshot: WorkspaceSnapshot; backupId: string | null }>;
  restoreMigration(id: string): Promise<WorkspaceSnapshot>;
  migrationBackups(): Promise<MigrationBackupInfo[]>;
  gitState(): Promise<GitState>;
  gitInit(): Promise<GitState>;
  gitDiff(path: string, originalPath?: string): Promise<string>;
  gitShow(hash: string): Promise<string>;
  gitCommit(paths: string[], message: string, identity?: { name: string; email: string }): Promise<{ hash: string; warning?: string }>;
  renderPlantuml(code: string, documentPath: string): Promise<string>;
  selectRendererFile(kind: 'jar' | 'java' | 'dot'): Promise<string | null>;
  renderCodeBlock(language: string, code: string, documentPath: string): Promise<PluginResult | null>;
  plugins(): Promise<PluginInfo[]>;
  pluginToggle(id: string, enabled: boolean): Promise<PluginInfo[]>;
  pluginInstall(): Promise<PluginInfo[]>;
  pluginRun(id: string, kind: 'commands' | 'validators' | 'exporters' | 'importers', action: string, snapshot: PluginSnapshot): Promise<PluginResult>;
  exportText(name: string, content: string): Promise<string | null>;
  showFolder(): Promise<void>;
  assetUrl(path: string, documentPath: string): string;
  onAction(callback: (action: string) => void): () => void;
  setDirty(dirty: boolean): void;
}
declare global { interface Window { reqtype: DesktopAPI } }
