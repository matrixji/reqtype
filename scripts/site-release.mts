import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { archiveName, validateTag, validateVersion } from './release-utils.mts';

export interface SiteArtifact { file:string; platform:'macos'|'windows'; arch:'arm64'|'x64'; kind:'archive'; sha256:string; }
export interface SiteManifest { version:string; channel:'stable'|'beta'; title:string; notes:string; artifacts:SiteArtifact[]; site?:{description:string}; }
export interface GithubRelease { tag_name:string; name:string|null; body:string|null; draft:boolean; prerelease:boolean; }
export interface ReleaseFile {name:string;size:number;sha256:string;}
export const targets=[['macos','arm64'],['macos','x64'],['windows','x64']] as const;

export function siteOrigin(value:string) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('官网地址必须是 HTTPS origin，本机测试允许 HTTP');
  return url;
}
export function notesDescription(notes:string) {
  const paragraph=notes.split(/\r?\n\s*\r?\n/).find(part=>part.trim()&&!/^\s*#{1,6}\s/.test(part)&&!/^\s*\*?\*?Full Changelog/i.test(part))??notes;
  const plain=paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/<[^>]*>/g,'').replace(/^[\s#>*-]+/gm,'').replace(/[`*_]/g,'').replace(/\s+/g,' ').trim();
  if(!plain)throw new Error('Release Notes 没有可用于官网介绍的内容');
  return plain.length<=1000?plain:plain.slice(0,999).replace(/[\uD800-\uDBFF]$/,'')+'…';
}
export function siteManifest(release:GithubRelease,version:string,files:ReleaseFile[]):SiteManifest {
  validateVersion(version);validateTag(release.tag_name,version);
  if(version.includes('+')||version.length>80)throw new Error('官网 API 不支持版本 build 元数据或超过 80 字符的版本');
  if(release.draft||release.prerelease!==version.includes('-'))throw new Error('GitHub Release 尚未发布或预发布标记不匹配');
  const title=release.name?.trim()||`ReqType ${release.tag_name}`,notes=release.body??'';
  if(title.length>160||!notes.trim()||notes.length>20000)throw new Error('Release 标题或 Notes 超出官网 API 范围');
  if(files.length!==3)throw new Error('官网发行必须包含三个原生平台文件');
  const artifacts=targets.map(([platform,arch])=>{
    const file=archiveName(version,platform==='macos'?'darwin':'win32',arch),source=files.find(entry=>entry.name===file);
    if(!source||source.size<=0||!/^[a-f0-9]{64}$/.test(source.sha256))throw new Error(`缺少已校验发行包：${file}`);
    return {file,platform,arch,kind:'archive' as const,sha256:source.sha256};
  });
  return {version,channel:release.prerelease?'beta':'stable',title,notes,artifacts,...release.prerelease?{}:{site:{description:notesDescription(notes)}}};
}

function sameRelease(actual:any,manifest:SiteManifest,sizes:Map<string,number>) {
  if(actual?.version!==manifest.version||actual.channel!==manifest.channel||actual.title!==manifest.title||actual.notes!==manifest.notes||actual.artifacts?.length!==manifest.artifacts.length)throw new Error('官网已存在该版本，但版本描述或产物清单不一致，禁止覆盖');
  for(const expected of manifest.artifacts){const file=actual.artifacts.find((entry:any)=>entry.file===expected.file);if(!file||file.platform!==expected.platform||file.arch!==expected.arch||file.kind!==expected.kind||file.sha256!==expected.sha256||file.size!==sizes.get(expected.file))throw new Error(`官网产物与发行包不一致：${expected.file}`);}
}

export async function deploySite(input:{origin:string;token:string;directory:string;manifest:SiteManifest}) {
  const origin=siteOrigin(input.origin),{manifest,token}=input;
  if(token.length<32)throw new Error('官网发布 Token 未配置或不足 32 字符');
  const files=await Promise.all(manifest.artifacts.map(async artifact=>{const file=path.join(input.directory,artifact.file),stat=await fs.stat(file);if(!stat.isFile()||stat.size<=0)throw new Error('官网发行文件为空');return {name:artifact.file,file,size:stat.size};}));
  const sizes=new Map(files.map(file=>[file.name,file.size]));
  async function json(route:string) {const response=await fetch(new URL(route,origin),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`官网读取失败 HTTP ${response.status}`);return response.json() as Promise<any>;}
  const query=(platform:string,arch:string,version:string)=>'/api/updates/check?'+new URLSearchParams({platform,arch,version,channel:manifest.channel});
  async function existing() {
    if(manifest.channel==='stable'){const state=await json('/api/releases');return state.releases.find((release:any)=>release.version===manifest.version);}
    const results=await Promise.all(targets.map(([platform,arch])=>json(query(platform,arch,'0.0.0-0'))));
    if(!results.some(result=>result.latestVersion===manifest.version))return undefined;
    if(!results.every(result=>result.latestVersion===manifest.version&&result.release&&result.download))throw new Error('官网 beta 平台状态不完整，禁止重发相同版本');
    return {...results[0].release,channel:'beta',artifacts:results.map((result,index)=>({...result.download,file:result.download.file,platform:targets[index][0],arch:targets[index][1],kind:'archive'}))};
  }
  async function verify(actual:any) {
    sameRelease(actual,manifest,sizes);
    if(manifest.channel==='stable'){
      const state=await json('/api/site');
      if(state.latest?.version===manifest.version){
        if(state.site?.description!==manifest.site?.description)throw new Error('官网首页描述与 Release Notes 摘要不一致');
        for(const artifact of manifest.artifacts){const download=state.downloads?.[`${artifact.platform}-${artifact.arch}`];if(download?.version!==manifest.version||download.sha256!==artifact.sha256||download.file!==artifact.file)throw new Error('官网平台下载指针未更新');}
      }
    }
  }
  const prior=await existing();
  if(prior){await verify(prior);return {alreadyPublished:true,reconciled:false};}
  const updates=await Promise.all(targets.map(([platform,arch])=>json(query(platform,arch,manifest.version))));
  if(updates.some(update=>update.available))throw new Error('官网已有更高版本，禁止回退或上传旧版本');
  const boundary=`reqtype-${crypto.randomUUID()}`;
  const field=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n`);
  const headers=files.map(file=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  const closing=Buffer.from(`--${boundary}--\r\n`),length=field.length+closing.length+files.reduce((sum,file,index)=>sum+headers[index].length+file.size+2,0);
  async function* body(){yield field;for(let index=0;index<files.length;index++){yield headers[index];yield*createReadStream(files[index].file);yield Buffer.from('\r\n');}yield closing;}
  try {
    const response=await fetch(new URL('/api/admin/releases',origin),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':String(length)},body:Readable.toWeb(Readable.from(body())) as ReadableStream<Uint8Array>,duplex:'half',redirect:'error',signal:AbortSignal.timeout(20*60*1000)} as RequestInit&{duplex:'half'});
    if(!response.ok)throw new Error(`官网发布失败 HTTP ${response.status}`);
    const result=await response.json() as any;
    if(result.ok!==true)throw new Error('官网发布响应无效');
    await verify(result.release);await verify(await existing());
    return {alreadyPublished:false,reconciled:false};
  } catch(error) {
    // 结果不明确时只读核对；不自动重发 POST，也不覆盖同版本。
    try {const actual=await existing();if(actual){await verify(actual);return {alreadyPublished:true,reconciled:true};}}catch{}
    throw new Error(`${(error as Error).message}。请核对官网状态后重跑部署 job；本次不会自动重复上传。`);
  }
}
