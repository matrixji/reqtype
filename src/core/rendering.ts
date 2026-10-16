import { envelope, readEnvelope } from './formats';
import type { PlantUMLSettings } from '../shared/types';
export const defaultPlantuml = (): PlantUMLSettings => ({ mode: 'jar', jarPath: '', javaPath: 'java', graphvizPath: '', serverUrl: 'http://127.0.0.1:8080/plantuml' });
export function validatePlantuml(value: PlantUMLSettings): PlantUMLSettings {
  if (!value || !['jar', 'server'].includes(value.mode)) throw new Error('请选择 PlantUML 的 JAR 或 Server 模式');
  for (const field of ['jarPath', 'javaPath', 'graphvizPath', 'serverUrl'] as const) if (typeof value[field] !== 'string' || value[field].length > 2048 || /[\x00-\x1F]/.test(value[field])) throw new Error(`PlantUML ${field} 无效`);
  if (!value.javaPath.trim()) throw new Error('请设置 Java 可执行程序（通常为 java）');
  if (value.mode === 'server') { let url: URL; try { url = new URL(value.serverUrl); } catch { throw new Error('PlantUML Server 地址须为 HTTP(S) URL'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Server 地址须为 HTTP(S) 基础地址，不包含认证信息、查询或片段'); }
  return { ...value };
}

export function readRendererDocument(source: string) { return readEnvelope('renderers', JSON.parse(source), value => validatePlantuml(value as PlantUMLSettings)); }
export function writeRendererDocument(settings: PlantUMLSettings, previous?: string) {
  const old = previous ? readRendererDocument(previous) : undefined;
  return JSON.stringify(envelope('renderers', validatePlantuml({ ...old?.value, ...settings }), old?.envelope), null, 2) + '\n';
}
