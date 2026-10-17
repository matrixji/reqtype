import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { expectedArchives,releaseManifest } from '../scripts/release-utils.mts';
import { deploySite,notesDescription,siteManifest,siteOrigin,type SiteManifest } from '../scripts/site-release.mts';

const token='not-a-secret-test-token-'.repeat(2);
async function setup(t:TestContext,version='1.2.3') {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-site-client-'));t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:3}));
  for(const name of expectedArchives(version))await fs.writeFile(path.join(directory,name),Buffer.from('binary\0中文\r\n'+name));
  const files=(await releaseManifest(directory,version)).files;
  const release={tag_name:'v'+version,name:'ReqType v'+version,body:'本次修复 **标题焦点**，保留 [正文](https://example.invalid/details)。\n\n## 更新\n- 三个平台。',draft:false,prerelease:version.includes('-')};
  return {directory,files,release,manifest:siteManifest(release,version,files)};
}

async function service(t:TestContext,manifest:SiteManifest,options:{drop?:boolean;redirect?:string;unauthorized?:boolean;newer?:boolean}={}) {
  const state:{posts:number;redirected:number;release:any;site:any;errors:string[]}={posts:0,redirected:0,release:undefined,site:{description:'原有稳定版介绍'},errors:[]};
  let origin='';
  const server=createServer((request,response)=>{void(async()=>{
    const url=new URL(request.url??'/',origin);
    const reply=(code:number,value:unknown)=>{response.writeHead(code,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
    if(url.pathname==='/stolen'){state.redirected++;return reply(200,{error:'不应访问重定向目标'});}
    if(request.method==='GET'){
      if(url.pathname==='/api/releases')return reply(200,{releases:state.release?.channel==='stable'?[state.release]:[]});
      if(url.pathname==='/api/site')return reply(200,{site:state.site,latest:state.release?.channel==='stable'?state.release:null,downloads:Object.fromEntries((state.release?.channel==='stable'?state.release.artifacts:[]).map((file:any)=>[`${file.platform}-${file.arch}`,{...file,version:state.release.version}]))});
      if(url.pathname==='/api/updates/check'){
        if(options.newer)return reply(200,{available:true,latestVersion:'9.0.0'});
        const file=state.release?.artifacts.find((file:any)=>file.platform===url.searchParams.get('platform')&&file.arch===url.searchParams.get('arch'));
        const available=Boolean(file)&&url.searchParams.get('version')!==manifest.version;
        return reply(200,{available,latestVersion:state.release?.version??null,release:available?state.release:null,download:available?file:null});
      }
    }
    if(request.method==='POST'&&url.pathname==='/api/admin/releases'){
      state.posts++;
      assert.equal(request.headers.authorization,`Bearer ${token}`);
      if(options.unauthorized)return reply(401,{error:'拒绝'});
      if(options.redirect){response.writeHead(302,{Location:options.redirect});return response.end();}
      const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
      const raw=Buffer.concat(chunks);assert.equal(Number(request.headers['content-length']),raw.length);
      const form=await new Response(new Uint8Array(raw),{headers:{'Content-Type':request.headers['content-type']!}}).formData();
      const incoming=JSON.parse(form.get('manifest') as string);assert.deepEqual(incoming,manifest);
      const uploads=form.getAll('files') as File[];assert.equal(uploads.length,3);
      const artifacts=[];
      for(const artifact of incoming.artifacts){const upload=uploads.find(file=>file.name===artifact.file)!;assert.ok(upload);const bytes=Buffer.from(await upload.arrayBuffer());const sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,artifact.sha256);artifacts.push({...artifact,sha256,size:bytes.length});}
      state.release={...incoming,artifacts};if(incoming.site)state.site={...state.site,...incoming.site};
      if(options.drop)return request.socket.destroy();
      return reply(201,{ok:true,release:state.release,url:origin});
    }
    reply(404,{error:'未找到'});
  })().catch(error=>{state.errors.push(String(error));response.writeHead(500);response.end();});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));assert.deepEqual(state.errors,[]);});
  return {origin,state};
}

test('SITE-001：使用真实 Release Notes 和三平台哈希，摘要有界、beta 不改稳定首页',async t=>{
  const data=await setup(t);assert.equal(data.manifest.notes,data.release.body);assert.equal(data.manifest.site?.description,'本次修复 标题焦点，保留 正文。');assert.equal(data.manifest.artifacts.length,3);
  assert.ok(notesDescription('😀'.repeat(800)).length<=1000);assert.ok(!/[\uD800-\uDBFF]$/.test(notesDescription('😀'.repeat(800))));
  assert.throws(()=>siteManifest({...data.release,draft:true},'1.2.3',data.files),/尚未发布/);
  assert.throws(()=>siteManifest({...data.release,body:'x'.repeat(20001)},'1.2.3',data.files),/范围/);
  assert.throws(()=>siteManifest({...data.release,tag_name:'v1.2.3+build'},'1.2.3+build',data.files),/build/);
  assert.throws(()=>siteManifest(data.release,'1.2.3',data.files.slice(1)),/三个/);
  for(const url of ['http://example.invalid','https://user:secret@example.invalid','https://example.invalid/path','https://example.invalid?token=x'])assert.throws(()=>siteOrigin(url));
  assert.equal(siteOrigin('https://reqtype.localcloud.site').origin,'https://reqtype.localcloud.site');
});

test('SITE-002：HTTP 流式上传精确字节，官网描述与下载更新；同版重跑不 POST，冲突拒绝',async t=>{
  const data=await setup(t),server=await service(t,data.manifest),input={...data,...server,token};
  assert.deepEqual(await deploySite(input),{alreadyPublished:false,reconciled:false});
  assert.equal(server.state.site.description,data.manifest.site?.description);
  assert.deepEqual(await deploySite(input),{alreadyPublished:true,reconciled:false});assert.equal(server.state.posts,1);
  await assert.rejects(deploySite({...input,manifest:{...data.manifest,notes:'改写旧版本'}}),/禁止覆盖/);assert.equal(server.state.posts,1);
  server.state.release.artifacts[0].sha256='0'.repeat(64);await assert.rejects(deploySite(input),/产物与发行包不一致/);assert.equal(server.state.posts,1);
});

test('SITE-003：上传已提交但响应断开，只读核对后成功，不盲目重复上传',async t=>{
  const data=await setup(t),server=await service(t,data.manifest,{drop:true});
  const result=await deploySite({...data,...server,token});assert.equal(result.reconciled,true);assert.equal(server.state.posts,1);assert.equal(server.state.release.version,'1.2.3');
});

test('SITE-004：预发布走 beta，保留稳定首页；更高版本阻止上传回退',async t=>{
  const data=await setup(t,'1.2.4-rc.1'),server=await service(t,data.manifest);
  assert.equal(data.manifest.channel,'beta');assert.equal(data.manifest.site,undefined);
  await deploySite({...data,...server,token});assert.equal(server.state.site.description,'原有稳定版介绍');
  assert.equal((await deploySite({...data,...server,token})).alreadyPublished,true);assert.equal(server.state.posts,1);
  const newer=await service(t,data.manifest,{newer:true});await assert.rejects(deploySite({...data,...newer,token}),/已有更高版本/);assert.equal(newer.state.posts,0);
});

test('SITE-005：认证失败与重定向不重试、不泄漏 Token；PR 事件不能部署',async t=>{
  const data=await setup(t);
  for(const options of [{unauthorized:true},{redirect:'/stolen'}]){
    const server=await service(t,data.manifest,options);
    await assert.rejects(deploySite({...data,...server,token}),error=>{assert.ok(!(error as Error).message.includes(token));return true;});assert.equal(server.state.posts,1);assert.equal(server.state.redirected,0);assert.equal(server.state.release,undefined);
  }
  const result=spawnSync(process.execPath,['scripts/deploy-release.mts'],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF_TYPE:'branch'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/只允许版本 tag push/);
});

test('SITE-006：部署入口拒绝错误校验文件、错误 tag 提交与被修改的 GitHub ZIP，不访问发布 API',async t=>{
  const data=await setup(t),commit='a'.repeat(40);
  await fs.writeFile(path.join(data.directory,'package.json'),JSON.stringify({version:'1.2.3'}));
  const manifest=path.join(data.directory,'manifest.json');await fs.writeFile(manifest,JSON.stringify({version:'1.2.3',files:data.files,commit}));
  const checksums=path.join(data.directory,'SHA256SUMS.txt');await fs.writeFile(checksums,'invalid');
  const env={...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v1.2.3',GITHUB_SHA:commit,GH_REPO:'example/repository',REQTYPE_SITE_URL:'http://127.0.0.1:1',REQTYPE_SITE_TOKEN:token};
  const run=()=>spawnSync(process.execPath,[path.resolve('scripts/deploy-release.mts'),data.directory],{cwd:data.directory,env,encoding:'utf8'});
  let result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/校验文件与发行包不一致/);
  await fs.writeFile(checksums,data.files.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n');
  await fs.writeFile(manifest,JSON.stringify({version:'1.2.3',files:data.files,commit:'b'.repeat(40)}));result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/不属于当前 tag 提交/);
  await fs.writeFile(path.join(data.directory,data.files[0].name),'tampered');result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/清单与下载文件哈希不一致/);
});
