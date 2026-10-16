import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readPluginState, readPreferences } from '../core/app-state';
import { atomicWrite, digest, exists, readOptional } from './workspace';
/** Global local preferences are upgraded only on a corresponding user action. */
export async function saveAppState(file: string, kind: 'plugins' | 'preferences', next: string, previous?: string) {
  const old = previous === undefined ? undefined : (kind === 'plugins' ? readPluginState(previous) : readPreferences(previous));
  const expected = previous === undefined ? null : digest(previous), bytes = await readOptional(file);
  if ((bytes ? digest(bytes) : null) !== expected) throw new Error('本机设置已被外部修改，请重新加载，原文件未覆盖');
  if (old?.legacy) {
    const backup = path.join(path.dirname(file), '.format-backups', `${path.basename(file)}.v0.${expected}.json`);
    if (await exists(backup)) { if (digest(await fs.readFile(backup)) !== expected) throw new Error('旧格式备份校验失败，已停止设置升级'); }
    else await atomicWrite(backup, Buffer.from(previous!), null);
  }
  await atomicWrite(file, Buffer.from(next), expected);
}
