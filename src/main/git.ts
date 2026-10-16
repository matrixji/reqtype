import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GitState } from '../shared/types';
import { safePath } from './workspace';

const exec = promisify(execFile);
async function git(root: string, args: string[], env?: NodeJS.ProcessEnv) {
  try { return (await exec('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000, env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', ...env } })).stdout; }
  catch (cause) { const error = cause as Error & { stderr?: string }; throw new Error(error.stderr?.trim() || error.message); }
}
export async function gitState(root: string): Promise<GitState> {
  root = await fs.realpath(root);
  const empty: GitState = { available: true, repository: false, branch: '', files: [], history: [] };
  try { await git(root, ['--version']); } catch (cause) { return { ...empty, available: false, error: (cause as Error).message }; }
  let top: string;
  try { top = (await git(root, ['rev-parse', '--show-toplevel'])).trim(); } catch { return empty; }
  const branch = await git(root, ['symbolic-ref', '--short', 'HEAD']).then(x => x.trim()).catch(() => 'detached HEAD');
  const tokens = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])).split('\0');
  const files: GitState['files'] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    const code = token.slice(0, 2), name = token.slice(3);
    const relative = path.relative(root, path.join(top, name)).split(path.sep).join('/');
    const original = /[RC]/.test(code) ? tokens[++index] : undefined;
    if (!relative.startsWith('../')) files.push({ path: relative, code, originalPath: original ? path.relative(root, path.join(top, original)).split(path.sep).join('/') : undefined });
  }
  const output = await git(root, ['log', '-30', '-z', '--format=%H%x00%h%x00%s%x00%an%x00%aI']).catch(() => '');
  const fields = output.split('\0');
  const history: GitState['history'] = [];
  for (let i = 0; i + 4 < fields.length; i += 5) history.push({ hash: fields[i].trim(), short: fields[i + 1], subject: fields[i + 2], author: fields[i + 3], date: fields[i + 4] });
  return { available: true, repository: true, branch, files, history };
}
export async function initGit(root: string) { await git(root, ['init', '-b', 'main']); return gitState(root); }
export async function gitDiff(root: string, relative: string, original?: string) {
  await safePath(root, relative);
  if (original) await safePath(root, original);
  const names = original ? [relative, original] : [relative];
  const [work, staged] = await Promise.all([git(root, ['diff', '--no-ext-diff', '--no-textconv', '--', ...names]), git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', ...names])]);
  if (!work && !staged) {
    try { const bytes = await fs.readFile(await safePath(root, relative)); return bytes.includes(0) ? '二进制文件' : `新文件：${relative}\n\n${bytes.toString('utf8').slice(0, 200000)}`; }
    catch { return '没有可显示的文本差异'; }
  }
  return [staged && `── 暂存区 ──\n${staged}`, work && `── 工作区 ──\n${work}`].filter(Boolean).join('\n');
}
export async function gitShow(root: string, hash: string) {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error('无效的提交 ID');
  return git(root, ['show', '--no-ext-diff', '--no-textconv', '--format=fuller', '--stat', '--patch', hash, '--', '.']);
}
export async function commitFiles(root: string, paths: string[], message: string, identity?: { name: string; email: string }) {
  if (!message.trim() || !paths.length) throw new Error('请填写提交说明并选择文件');
  for (const relative of paths) await safePath(root, relative);
  const status = await gitState(root);
  const allowed = new Set(status.files.flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])]));
  if (paths.some(x => !allowed.has(x))) throw new Error('文件状态已变化，请刷新后提交');
  const gitDirectory = path.resolve(root, (await git(root, ['rev-parse', '--git-dir'])).trim());
  const temporary = path.join(gitDirectory, `reqtype-index-${randomUUID()}`);
  const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: temporary };
  if (identity?.name.trim() && identity.email.trim()) Object.assign(env, { GIT_AUTHOR_NAME: identity.name.trim(), GIT_COMMITTER_NAME: identity.name.trim(), GIT_AUTHOR_EMAIL: identity.email.trim(), GIT_COMMITTER_EMAIL: identity.email.trim() });
  try {
    try { await git(root, ['read-tree', 'HEAD'], env); } catch { await git(root, ['read-tree', '--empty'], env); }
    await git(root, ['add', '-A', '--', ...paths], env);
    await git(root, ['commit', '-m', message], env);
    const hash = (await git(root, ['rev-parse', 'HEAD'])).trim();
    let warning: string | undefined;
    try { await git(root, ['reset', '-q', 'HEAD', '--', ...paths]); }
    catch { warning = '提交已完成，但选中文件的暂存区未同步，请在 Git 工具中检查状态'; }
    return { hash, warning };
  } finally { await fs.rm(temporary, { force: true }); await fs.rm(temporary + '.lock', { force: true }); }
}
