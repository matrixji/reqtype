import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/types';

const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`reqtype:${name}`, ...args);
const api: DesktopAPI = {
  initial: () => invoke('initial'), open: create => invoke('open', create), refresh: () => invoke('refresh'),
  save: (path, content, version) => invoke('save', path, content, version),
  projectSettings: () => invoke('projectSettings'), saveProject: (config, version, renderers) => invoke('saveProject', config, version, renderers),
  export: (kind, path) => invoke('export', kind, path), prepareImport: () => invoke('prepareImport'), applyImport: (token, paths) => invoke('applyImport', token, paths),
  previewTypeMigration: (from,to) => invoke('previewTypeMigration',from,to), applyTypeMigration: token => invoke('applyTypeMigration',token),
  previewMigrations: () => invoke('previewMigrations'), applyMigrations: token => invoke('applyMigrations', token), restoreMigration: id => invoke('restoreMigration', id), migrationBackups: () => invoke('migrationBackups'),
  gitState: () => invoke('gitState'), gitInit: () => invoke('gitInit'), gitDiff: (path, original) => invoke('gitDiff', path, original), gitShow: hash => invoke('gitShow', hash), gitCommit: (paths, message, identity) => invoke('gitCommit', paths, message, identity),
  renderPlantuml: (code, documentPath) => invoke('renderPlantuml', code, documentPath), selectRendererFile: kind => invoke('selectRendererFile', kind),
  renderCodeBlock: (language, code, documentPath) => invoke('renderCodeBlock', language, code, documentPath),
  plugins: () => invoke('plugins'), pluginToggle: (id, enabled) => invoke('pluginToggle', id, enabled), pluginInstall: () => invoke('pluginInstall'), pluginRun: (id, kind, action, snapshot) => invoke('pluginRun', id, kind, action, snapshot),
  exportText: (name, content) => invoke('exportText', name, content), showFolder: () => invoke('showFolder'),
  assetUrl: (src, doc) => /^(https?:|data:)/i.test(src) ? src : `reqasset://workspace/${encodeURIComponent(doc)}?src=${encodeURIComponent(src)}`,
  onAction(callback) { const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action); ipcRenderer.on('reqtype:action', listener); return () => ipcRenderer.removeListener('reqtype:action', listener); },
  setDirty: dirty => ipcRenderer.send('reqtype:dirty', dirty),
};
contextBridge.exposeInMainWorld('reqtype', api);
