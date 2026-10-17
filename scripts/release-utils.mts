import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
export function validateVersion(version: unknown): string {
  if(typeof version!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.test(version))throw new Error('应用版本必须是合法 SemVer');
  return version;
}
export function validateTag(tag:string,version:string) {
  validateVersion(version);if(tag!==`v${version}`)throw new Error(`版本不一致：tag ${tag}，package.json ${version}`);return tag;
}
export function archiveName(version:string,platform:string,arch:string) {
  validateVersion(version);if(!['darwin','win32'].includes(platform)||!['arm64','x64'].includes(arch)||platform==='win32'&&arch!=='x64')throw new Error('不支持的发行平台');
  return `ReqType-${version}-${platform==='darwin'?'macos':'windows'}-${arch}-unsigned.zip`;
}
export const expectedArchives=(version:string)=>[archiveName(version,'darwin','arm64'),archiveName(version,'darwin','x64'),archiveName(version,'win32','x64')].sort();
export async function releaseManifest(directory:string,version:string) {
  const names=(await fs.readdir(directory)).filter(name=>name.endsWith('.zip')).sort(),expected=expectedArchives(version);
  if(JSON.stringify(names)!==JSON.stringify(expected))throw new Error('发行包不完整或包含意外 ZIP，必须同时包含 macOS arm64／x64 与 Windows x64');
  const files=[];
  for(const name of names){const bytes=await fs.readFile(`${directory}/${name}`);if(!bytes.length)throw new Error('发行包为空');files.push({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  return {version,files};
}
