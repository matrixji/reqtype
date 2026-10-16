import { pathToFileURL } from 'node:url';
import type { PluginContribution, PluginResult, PluginSnapshot } from '../shared/types';

type Kind = 'commands' | 'validators' | 'exporters' | 'importers' | 'renderers';
type Entry = PluginContribution & { render?: (input: { language: string; code: string; documentPath: string }) => unknown; run?: (snapshot: PluginSnapshot) => unknown; validate?: (snapshot: PluginSnapshot) => unknown; export?: (snapshot: PluginSnapshot) => unknown; import?: (input: { name: string; text: string }, snapshot: PluginSnapshot) => unknown };
const registries: Record<Kind, Map<string, Entry>> = { commands: new Map(), validators: new Map(), exporters: new Map(), importers: new Map(), renderers: new Map() };
const parent = (process as NodeJS.Process & { parentPort: { postMessage(message: unknown): void; on(event: 'message', callback: (event: { data: any }) => void): void } }).parentPort;
const register = (kind: Kind, entry: Entry) => {
  if (!entry || typeof entry.id !== 'string' || typeof entry.title !== 'string' || registries[kind].has(entry.id)) throw new Error('插件扩展标识无效或重复');
  if (kind === 'renderers' && (!Array.isArray(entry.languages) || !entry.languages.length || entry.languages.some(language => !/^[a-z0-9_+-]{1,40}$/.test(language)) || typeof entry.render !== 'function')) throw new Error('代码块渲染器须提供 languages 和 render');
  registries[kind].set(entry.id, entry);
};
async function boot() { try {
  const loaded = await import(pathToFileURL(process.argv[2]).href);
  const plugin = loaded.default ?? loaded;
  if (typeof plugin.activate !== 'function') throw new Error('插件缺少 activate(api)');
  await plugin.activate({ version: 1, registerCodeBlock: (entry: Entry) => register('renderers', entry), registerCommand: (entry: Entry) => register('commands', entry), registerValidator: (entry: Entry) => register('validators', entry), registerExporter: (entry: Entry) => register('exporters', entry), registerImporter: (entry: Entry) => register('importers', entry) });
  parent.postMessage({ ready: true, catalogue: Object.fromEntries(Object.entries(registries).map(([kind, entries]) => [kind, [...entries.values()].map(({ id, title, extension, extensions, languages }) => ({ id, title, extension, extensions, languages }))])) });
  parent.on('message', async ({ data }) => {
    try {
      const kind = data.kind as Kind;
      const entry = registries[kind]?.get(data.action);
      if (!entry) throw new Error('插件扩展不存在');
      let result: PluginResult;
      if (kind === 'validators') result = { diagnostics: await entry.validate?.(data.snapshot) as PluginResult['diagnostics'] };
      else if (kind === 'exporters') result = { text: await entry.export?.(data.snapshot) as string };
      else if (kind === 'renderers') result = { html: await entry.render?.(data.input) as string };
      else if (kind === 'importers') result = { files: await entry.import?.(data.input, data.snapshot) as PluginResult['files'] };
      else result = await entry.run?.(data.snapshot) as PluginResult ?? {};
      parent.postMessage({ requestId: data.requestId, result });
    } catch (cause) { parent.postMessage({ requestId: data.requestId, error: (cause as Error).message }); }
  });
} catch (cause) { parent.postMessage({ ready: false, error: (cause as Error).message }); } }
void boot();
