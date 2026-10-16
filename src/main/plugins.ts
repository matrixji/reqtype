import { utilityProcess, type UtilityProcess } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, exists, safePath } from './workspace';
import type { PluginInfo, PluginSnapshot, PluginResult } from '../shared/types';

interface Manifest { id: string; name: string; version: string; apiVersion: 1; main: string }
interface Running { info: PluginInfo; directory: string; process?: UtilityProcess; pending: Map<string, { resolve: (value: PluginResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> }
export class PluginManager {
  entries = new Map<string, Running>();
  disabled = new Set<string>();
  constructor(public directory: string, public builtin: string, public worker: string) {}
  async manifest(directory: string): Promise<Manifest> {
    const value = JSON.parse(await fs.readFile(await safePath(directory, 'plugin.json'), 'utf8')) as Manifest;
    if (!value || !/^[a-z][a-z0-9.-]{1,80}$/.test(value.id) || typeof value.name !== 'string' || typeof value.version !== 'string' || value.apiVersion !== 1 || typeof value.main !== 'string' || !/\.(cjs|mjs|js)$/.test(value.main)) throw new Error('插件清单无效，要求 apiVersion: 1');
    await safePath(directory, value.main);
    return value;
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    try { this.disabled = new Set(JSON.parse(await fs.readFile(path.join(this.directory, 'disabled.json'), 'utf8'))); } catch { /* 首次运行 */ }
    const directories = [{ directory: this.builtin, builtin: true }];
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) directories.push({ directory: path.join(this.directory, entry.name), builtin: false });
    for (const item of directories) {
      try {
        const manifest = await this.manifest(item.directory);
        if (this.entries.has(manifest.id)) continue;
        const info: PluginInfo = { id: manifest.id, name: manifest.name, version: manifest.version, enabled: !this.disabled.has(manifest.id), builtin: item.builtin, commands: [], validators: [], exporters: [], importers: [], renderers: [] };
        const running: Running = { info, directory: item.directory, pending: new Map() };
        this.entries.set(info.id, running);
        if (info.enabled) await this.start(running);
      } catch (cause) {
        const id = `invalid-${path.basename(item.directory)}`;
        this.entries.set(id, { directory: item.directory, pending: new Map(), info: { id, name: path.basename(item.directory), version: '?', enabled: false, builtin: item.builtin, commands: [], validators: [], exporters: [], importers: [], renderers: [], error: (cause as Error).message } });
      }
    }
  }
  async start(entry: Running) {
    try {
      const manifest = await this.manifest(entry.directory);
      await new Promise<void>((resolve, reject) => {
        const child = utilityProcess.fork(this.worker, [path.join(entry.directory, manifest.main)], { serviceName: `ReqType · ${manifest.name}`, stdio: 'pipe', execArgv: [] });
        entry.process = child;
        let ready = false;
        const timer = setTimeout(() => { child.kill(); reject(new Error('插件启动超时')); }, 10000);
        child.on('message', (message: any) => {
          if (!message || typeof message !== 'object') return;
          if ('ready' in message) {
            clearTimeout(timer);
            if (!message.ready) { child.kill(); reject(new Error(message.error)); }
            else { ready = true; Object.assign(entry.info, message.catalogue, { error: undefined }); resolve(); }
          } else {
            const pending = entry.pending.get(message.requestId);
            if (!pending) return;
            clearTimeout(pending.timer); entry.pending.delete(message.requestId);
            if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
          }
        });
        child.on('exit', code => {
          clearTimeout(timer);
          if (entry.process !== child) return;
          for (const pending of entry.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('插件进程已退出')); }
          entry.pending.clear(); entry.process = undefined;
          if (entry.info.enabled && ready) entry.info.error = `插件进程已退出（${code}）`;
          if (!ready) reject(new Error(`插件启动失败（${code}）`));
        });
      });
    } catch (cause) { entry.info.error = (cause as Error).message; }
  }
  list() { return [...this.entries.values()].map(x => x.info); }
  async toggle(id: string, enabled: boolean) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('插件不存在');
    entry.info.enabled = enabled;
    if (enabled) { this.disabled.delete(id); if (!entry.process) await this.start(entry); }
    else {
      this.disabled.add(id);
      const child = entry.process; entry.process = undefined; child?.kill();
      for (const pending of entry.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('插件已停用')); }
      entry.pending.clear();
    }
    await atomicWrite(path.join(this.directory, 'disabled.json'), Buffer.from(JSON.stringify([...this.disabled])));
    return this.list();
  }
  async install(directory: string) {
    const manifest = await this.manifest(directory);
    if (this.entries.has(manifest.id) || await exists(path.join(this.directory, manifest.id))) throw new Error('相同 ID 的插件已安装，请使用新的插件 ID 或版本目录');
    const destination = path.join(this.directory, manifest.id);
    await fs.cp(directory, destination, { recursive: true, filter: async source => {
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw new Error('插件目录不能包含符号链接');
      return !['node_modules', '.git'].includes(path.basename(source));
    } });
    const entry: Running = { directory: destination, pending: new Map(), info: { id: manifest.id, name: manifest.name, version: manifest.version, enabled: false, builtin: false, commands: [], validators: [], exporters: [], importers: [], renderers: [] } };
    this.entries.set(manifest.id, entry);
    this.disabled.add(manifest.id);
    await atomicWrite(path.join(this.directory, 'disabled.json'), Buffer.from(JSON.stringify([...this.disabled])));
    return this.list();
  }
  async run(id: string, kind: 'commands' | 'validators' | 'exporters' | 'importers' | 'renderers', action: string, snapshot?: PluginSnapshot, input?: { name: string; text: string } | { language: string; code: string; documentPath: string }) {
    const entry = this.entries.get(id);
    if (!entry?.process || !entry.info.enabled || entry.info.error || !entry.info[kind].some(x => x.id === action)) throw new Error('插件未启用或扩展不可用');
    return new Promise<PluginResult>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => { entry.pending.delete(requestId); entry.info.error = '执行超过 10 秒，已停止插件'; entry.process?.kill(); reject(new Error(entry.info.error)); }, 10000);
      entry.pending.set(requestId, { resolve, reject, timer });
      entry.process!.postMessage({ requestId, kind, action, snapshot, input });
    });
  }
  close() { for (const entry of this.entries.values()) { entry.info.enabled = false; entry.process?.kill(); } }
}
