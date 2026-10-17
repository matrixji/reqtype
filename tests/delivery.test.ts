import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync,spawnSync } from 'node:child_process';
import {parse} from 'yaml';
import {archiveName,expectedArchives,releaseManifest,validateTag,validateVersion} from '../scripts/release-utils.mts';

test('DELIVERY-001：tag 与应用版本严格一致，拒绝路径／shell 内容和非法 SemVer',()=>{
 for(const version of ['0.2.0','1.2.3-rc.1','1.0.0+build.1'])assert.equal(validateTag('v'+version,version),'v'+version);
 for(const version of ['01.2.3','1.2','1.2.3-01','1.2.3\n','../release','1.0.0;command'])assert.throws(()=>validateVersion(version));
 assert.throws(()=>validateTag('v0.2.1','0.2.0'),/版本不一致/);
 assert.match(archiveName('0.2.0','darwin','arm64'),/macos-arm64-unsigned.zip$/);assert.throws(()=>archiveName('0.2.0','win32','arm64'));
});

test('DELIVERY-002：发布清单必须完整，计算精确字节哈希，拒绝缺失／意外／空资产',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-release-assets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const names=expectedArchives('0.2.0');for(const name of names)await fs.writeFile(path.join(root,name),'abc');
 const manifest=await releaseManifest(root,'0.2.0');assert.equal(manifest.files.length,3);assert.ok(manifest.files.every(file=>file.size===3&&file.sha256==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
 await fs.rm(path.join(root,names[0]));await assert.rejects(releaseManifest(root,'0.2.0'),/不完整/);
 await fs.writeFile(path.join(root,names[0]),'');await assert.rejects(releaseManifest(root,'0.2.0'),/为空/);
 await fs.writeFile(path.join(root,'unexpected.zip'),'x');await assert.rejects(releaseManifest(root,'0.2.0'),/意外/);
});

test('DELIVERY-003：发行 tag 只能指向 main 已包含的提交，同时校验 lockfile',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-release-git-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git('init','-b','main');git('config','user.name','Release test');git('config','user.email','release@example.invalid');
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.2.3'}));await fs.writeFile(path.join(root,'package-lock.json'),JSON.stringify({version:'1.2.3',packages:{'':{version:'1.2.3'}}}));git('add','.');git('commit','-m','Initial');git('update-ref','refs/remotes/origin/main','HEAD');
 const script=path.resolve('scripts/release-info.mts'),env={...process.env,GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v1.2.3',GITHUB_EVENT_NAME:'push',GITHUB_OUTPUT:''};
 assert.match(execFileSync(process.execPath,[script],{cwd:root,env,encoding:'utf8'}),/"publish":true/);
 assert.notEqual(spawnSync(process.execPath,[script],{cwd:root,env:{...env,GITHUB_REF_NAME:'v1.2.4'}}).status,0);
 await fs.writeFile(path.join(root,'package-lock.json'),JSON.stringify({version:'1.2.4'}));assert.notEqual(spawnSync(process.execPath,[script],{cwd:root,env}).status,0);
 await fs.writeFile(path.join(root,'package-lock.json'),JSON.stringify({version:'1.2.3',packages:{'':{version:'1.2.3'}}}));git('checkout','-b','feature');await fs.writeFile(path.join(root,'change'),'x');git('add','.');git('commit','-m','Unmerged');assert.notEqual(spawnSync(process.execPath,[script],{cwd:root,env}).status,0);
});

test('DELIVERY-004：PR 门禁依赖全部原生桌面，只有 tag push 发布且写权限局限发布 job',async()=>{
 const read=async(file:string)=>parse(await fs.readFile('.github/workflows/'+file,'utf8'));
 const ci=await read('check.yml'),build=await read('desktop-build.yml'),release=await read('release.yml');
 assert.deepEqual(ci.on.pull_request.branches,['main']);assert.equal(ci.jobs.required.name,'CI required');assert.equal(ci.jobs.required.if,'always()');assert.equal(ci.jobs.required.needs,'desktop');
 assert.deepEqual(build.jobs.desktop.strategy.matrix.include.map((row:any)=>[row.platform,row.arch]),[['darwin','arm64'],['darwin','x64'],['win32','x64']]);
 assert.equal(ci.permissions.contents,'read');assert.equal(release.permissions.contents,'read');assert.equal(release.jobs.publish.permissions.contents,'write');
 assert.deepEqual(release.on.push.tags,['v*']);assert.match(release.jobs.publish.if,/github.event_name == 'push'.*github.ref_type == 'tag'/);assert.deepEqual(release.jobs.publish.needs,['validate','desktop']);
 assert.deepEqual(release.jobs.deploy.needs,['validate','publish']);assert.equal(release.jobs.deploy.permissions.contents,'read');assert.match(release.jobs.deploy.if,/github.event_name == 'push'.*github.ref_type == 'tag'/);
 for(const workflow of [ci,build,release])for(const [name,job] of Object.entries(workflow.jobs) as [string,any][])for(const step of job.steps??[])if(JSON.stringify(step).includes('secrets.REQTYPE_SITE_TOKEN'))assert.equal(name,'deploy');
 for(const workflow of [ci,build,release])for(const job of Object.values(workflow.jobs) as any[])for(const step of job.steps??[])if(step.uses?.startsWith('actions/'))assert.match(step.uses,/@[a-f0-9]{40}$/);
});

test('DELIVERY-005：PR 或手动分支构建不能通过发布脚本创建 Release',async()=>{
 const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
 const result=spawnSync(process.execPath,['scripts/publish-release.mts'],{encoding:'utf8',env:{...process.env,RELEASE_TAG:`v${pkg.version}`,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF_TYPE:'branch',GITHUB_REF_NAME:'main'}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/只允许版本 tag push/);
});

test('DELIVERY-006：本机推送钩子拒绝 main，允许工作分支，测试不访问远程',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-prepush-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const local=path.join(root,'local'),remote=path.join(root,'remote.git');await fs.mkdir(local);
 const git=(...args:string[])=>execFileSync('git',args,{cwd:local,stdio:'pipe'});git('init','-b','main');git('config','user.name','Hook test');git('config','user.email','hook@example.invalid');await fs.writeFile(path.join(local,'file'),'content');git('add','.');git('commit','-m','Initial');git('init','--bare',remote);
 const hook=path.resolve('.githooks'),run=(branch:string)=>spawnSync('git',['-c',`core.hooksPath=${hook}`,'push','--dry-run',remote,`HEAD:refs/heads/${branch}`],{cwd:local,encoding:'utf8'});
 assert.notEqual(run('main').status,0);assert.match(run('main').stderr,/Pull Request/);const feature=run('feature/test');assert.equal(feature.status,0,feature.stderr);
});
