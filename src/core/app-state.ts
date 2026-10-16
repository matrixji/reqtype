import { envelope, isRecord, readEnvelope } from './formats';
export function readPreferences(source: string) {
  return readEnvelope('preferences', JSON.parse(source), value => {
    if (!isRecord(value) || value.lastWorkspace !== undefined && typeof value.lastWorkspace !== 'string') throw new Error('最近项目设置无效');
    return value;
  });
}
export function writePreferences(lastWorkspace: string, previous?: string) {
  const old = previous ? readPreferences(previous) : undefined;
  return JSON.stringify(envelope('preferences', { ...old?.value, lastWorkspace }, old?.envelope), null, 2) + '\n';
}
export function readPluginState(source: string) {
  return readEnvelope('plugins', JSON.parse(source), value => {
    const payload = Array.isArray(value) ? { disabled: value } : value;
    if (!isRecord(payload) || !Array.isArray(payload.disabled) || payload.disabled.some(id => typeof id !== 'string' || !id)) throw new Error('插件启用设置无效');
    return payload as Record<string, unknown> & { disabled: string[] };
  });
}
export function writePluginState(disabled: string[], previous?: string) {
  const old = previous ? readPluginState(previous) : undefined;
  return JSON.stringify(envelope('plugins', { ...old?.value, disabled }, old?.envelope), null, 2) + '\n';
}
