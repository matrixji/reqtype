import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { validatePlantuml } from '../core/rendering';
import type { PlantUMLSettings } from '../shared/types';
import { safePath } from './workspace';

export function encodePlantuml(source: string) {
  const normal = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  return [...deflateRawSync(Buffer.from(source)).toString('base64')].map(char => char === '=' ? '0' : alphabet[normal.indexOf(char)]).join('');
}
export async function renderPlantuml(code: string, input: PlantUMLSettings, context: { root: string; documentPath: string; bundledJar: string }) {
  const settings = validatePlantuml(input);
  if (typeof code !== 'string' || Buffer.byteLength(code) > 1024 * 1024) throw new Error('PlantUML 代码块须小于 1 MB');
  const source = /^\s*@start\w+/m.test(code) ? code : `@startuml\n${code}\n@enduml`;
  let svg: string;
  if (settings.mode === 'server') {
    const target = settings.serverUrl.replace(/\/+$/, '') + '/svg/' + encodePlantuml(source);
    const response = await fetch(target, { signal: AbortSignal.timeout(20000), headers: { Accept: 'image/svg+xml' } });
    if (!response.ok) throw new Error(`PlantUML Server 返回 ${response.status}`);
    const reader = response.body?.getReader(); if (!reader) throw new Error('PlantUML Server 未返回内容');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('PlantUML 输出超过 8 MB'); } chunks.push(result.value); }
    svg = Buffer.concat(chunks).toString('utf8');
  } else {
    const jar = settings.jarPath ? path.resolve(context.root, settings.jarPath) : context.bundledJar;
    try { if (!(await fs.stat(jar)).isFile()) throw new Error(); } catch { throw new Error('找不到 PlantUML JAR，请在项目设置中选择本地 .jar 文件'); }
    const document = await safePath(context.root, context.documentPath), cwd = path.dirname(document);
    const executable = /[/\\]/.test(settings.javaPath) ? path.resolve(context.root, settings.javaPath) : settings.javaPath;
    const args = ['-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=ALLOWLIST', `-Dplantuml.allowlist.path=${context.root}`, `-Dplantuml.include.path=${context.root}`, '-Dplantuml.allowlist.url=', '-jar', jar, '-pipe', '-tsvg', '-charset', 'UTF-8', '-nometadata'];
    svg = await new Promise<string>((resolve, reject) => {
      const child = execFile(executable, args, { cwd, windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, PLANTUML_SECURITY_PROFILE: 'ALLOWLIST', ...(settings.graphvizPath ? { GRAPHVIZ_DOT: path.resolve(context.root, settings.graphvizPath) } : {}) } }, (error, stdout, stderr) => {
        if (error) reject(new Error(`PlantUML 本地渲染失败：${stderr.trim().slice(0, 600) || error.message}。请检查 Java、JAR 与图形语法`)); else resolve(stdout);
      });
      child.stdin?.on('error', () => {}); child.stdin?.end(source);
    });
  }
  if (!/<svg[\s>]/i.test(svg)) throw new Error('PlantUML 未返回 SVG 图形');
  return svg;
}
