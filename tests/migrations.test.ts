import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Workspace, digest, readJournalDocument } from '../src/main/workspace';
import { applyImport, decodeExchange, exportWorkspace, prepareImport } from '../src/main/exchange';
import { applyMigrations, migrationBackups, previewMigrations, restoreMigration } from '../src/main/migrations';
const fixture = (file:string) => fs.readFile(`tests/fixtures/formats/${file}`);
const changedPaths=['.reqtype/project.yaml','modules/legacy.md','.reqtype/local/renderers.json','.reqtype/local/transactions/old.json'];
async function setup(t:TestContext) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-migrations-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const dir of ['modules','assets','.reqtype/local/transactions']) await fs.mkdir(path.join(root,dir),{recursive:true});
  await fs.writeFile(path.join(root,'.reqtype/project.yaml'),Buffer.concat([await fixture('v1/project.yaml'),Buffer.from(`id: "${randomUUID()}"\n`)]));
  for(const [target,source] of [['modules/legacy.md','legacy/module.md'],['.reqtype/local/renderers.json','legacy/renderers.json'],['.reqtype/local/transactions/old.json','legacy/journal.json']]) await fs.writeFile(path.join(root,target),await fixture(source));
  await fs.writeFile(path.join(root,'assets/pixel.png'),Buffer.from([0,1,2,255,128]));
  const workspace=await Workspace.open(root,{recover:false});
  const originals=Object.fromEntries(await Promise.all(changedPaths.map(async file=>[file,await fs.readFile(path.join(root,file))])));
  return {root,workspace,originals};
}
async function unchanged(root:string,originals:Record<string,Buffer>) {for(const [file,bytes] of Object.entries(originals))assert.deepEqual(await fs.readFile(path.join(root,file)),bytes,file);}

test('MIG-001：预览只读，列出真实 v0 → v1，普通 Markdown 不被身份化',async t=>{
  const {root,workspace,originals}=await setup(t);await fs.writeFile(path.join(root,'modules/plain.md'),'---\nauthor: Someone\n---\n\n# 普通文档\n');
  const preview=await previewMigrations(workspace);assert.equal(preview.entries.filter(row=>row.status==='pending').length,4);
  assert.equal(preview.entries.find(row=>row.path==='modules/plain.md')?.status,'unmanaged');
  await unchanged(root,originals);assert.deepEqual(await migrationBackups(workspace),[]);
  assert.equal((await fs.readdir(path.join(root,'.reqtype/local/transactions'))).length,1);
});

test('MIG-002：首写前已有完整备份，升级保留附件，恢复精确原文且可重复执行',async t=>{
  const {root,workspace,originals}=await setup(t), asset=await fs.readFile(path.join(root,'assets/pixel.png')), config=await fs.readFile(path.join(root,'.reqtype/project.yaml'));
  const preview=await previewMigrations(workspace);
  const result=await applyMigrations(workspace,preview.token,async index=>{if(index===0){const backups=await migrationBackups(workspace);assert.equal(backups.length,1);const raw=JSON.parse(await fs.readFile(path.join(root,'.reqtype/local/migrations',backups[0].id+'.json'),'utf8'));for(const entry of raw.entries)assert.deepEqual(Buffer.from(entry.before,'base64'),originals[entry.path]);}});
  assert.ok(result.backupId);assert.deepEqual(await fs.readFile(path.join(root,'modules/legacy.md')),await fixture('v1/module.md'));
  assert.deepEqual(await fs.readFile(path.join(root,'assets/pixel.png')),asset);assert.equal((await workspace.config()).config.version,2);
  const again=await previewMigrations(workspace);assert.equal(again.entries.filter(row=>row.status==='pending').length,0);
  assert.equal((await applyMigrations(workspace,again.token)).backupId,null);
  await restoreMigration(workspace,result.backupId!);await unchanged(root,originals);
  await restoreMigration(workspace,result.backupId!);await unchanged(root,originals);
  assert.equal((await migrationBackups(workspace)).length,1);
});

test('MIG-003：未来模块／设置／日志会阻止整批迁移，不触碰旧文件',async t=>{
  for(const [file,name] of [['modules/future.md','future/module.md'],['.reqtype/local/renderers.json','future/renderers.json'],['.reqtype/local/transactions/future.json','future/journal.json']]) {
    const {root,workspace}=await setup(t);await fs.writeFile(path.join(root,file),await fixture(name));
    const before=await fs.readFile(path.join(root,'modules/legacy.md')), future=await fs.readFile(path.join(root,file));
    const preview=await previewMigrations(workspace);assert.equal(preview.entries.find(row=>row.path===file)?.status,'blocked');
    await assert.rejects(applyMigrations(workspace,preview.token),/未修改任何文件/);
    assert.deepEqual(await fs.readFile(path.join(root,'modules/legacy.md')),before);assert.deepEqual(await fs.readFile(path.join(root,file)),future);
    assert.deepEqual(await migrationBackups(workspace),[]);
  }
});

test('MIG-004：未来项目配置和损坏数据不被当作旧版迁移',async t=>{
  const {root,workspace}=await setup(t);await fs.writeFile(path.join(root,'.reqtype/project.yaml'),await fixture('future-v3/project.yaml'));
  const preview=await previewMigrations(workspace);assert.equal(preview.entries.find(row=>row.kind==='project')?.status,'blocked');
  await assert.rejects(applyMigrations(workspace,preview.token),/不支持或损坏/);
  await fs.writeFile(path.join(root,'.reqtype/project.yaml'),await fixture('v1/project.yaml'));
  await fs.writeFile(path.join(root,'modules/legacy.md'),(await fixture('legacy/module.md')).toString().replace('module: "11111111-1111-4111-8111-111111111111"',''));
  const invalid=await previewMigrations(workspace);assert.equal(invalid.entries.find(row=>row.path==='modules/legacy.md')?.status,'blocked');
});

test('MIG-005：预览后的编辑和新增文件均使计划失效，跨项目 token 拒绝',async t=>{
  for(const change of ['edit','add']) {
    const {root,workspace}=await setup(t), preview=await previewMigrations(workspace);
    await fs.appendFile(path.join(root,change==='edit'?'modules/legacy.md':'modules/new.md'),'\n外部编辑\n');
    await assert.rejects(applyMigrations(workspace,preview.token),/已变化/);assert.deepEqual(await migrationBackups(workspace),[]);
  }
  const a=await setup(t),b=await setup(t),preview=await previewMigrations(a.workspace);
  await assert.rejects(applyMigrations(b.workspace,preview.token),/预览已过期/);
});

test('MIG-006：多文件升级失败回滚，原文备份和可恢复日志保留',async t=>{
  const {root,workspace,originals}=await setup(t), preview=await previewMigrations(workspace);
  await assert.rejects(applyMigrations(workspace,preview.token,index=>{if(index===1)throw new Error('模拟磁盘故障');}),/备份 .* 已保留/);
  await unchanged(root,originals);const backups=await migrationBackups(workspace);assert.equal(backups.length,1);
  await restoreMigration(workspace,backups[0].id);await unchanged(root,originals);
  const journals=await fs.readdir(path.join(root,'.reqtype/local/transactions'));assert.ok(journals.length>1);
  assert.ok((await Workspace.open(root)).recoveryWarnings.length===0);
});

test('MIG-007：恢复不覆盖迁移后的人工修改；备份篡改／未来版本也拒绝',async t=>{
  const {root,workspace}=await setup(t), result=await applyMigrations(workspace,(await previewMigrations(workspace)).token);
  const modern=await fs.readFile(path.join(root,'.reqtype/local/renderers.json'));
  await fs.appendFile(path.join(root,'modules/legacy.md'),'\r\n迁移后的人工修改\r\n');
  await assert.rejects(restoreMigration(workspace,result.backupId!),/未覆盖任何文件/);
  assert.deepEqual(await fs.readFile(path.join(root,'.reqtype/local/renderers.json')),modern);
  const backupFile=path.join(root,'.reqtype/local/migrations',result.backupId!+'.json'), original=await fs.readFile(backupFile,'utf8'), backup=JSON.parse(original);
  backup.entries[0].before=Buffer.from('tampered').toString('base64');await fs.writeFile(backupFile,JSON.stringify(backup));
  await assert.rejects(restoreMigration(workspace,result.backupId!),/内容校验失败/);
  const futureEntry=JSON.parse(original);futureEntry.entries[0].to=3;await fs.writeFile(backupFile,JSON.stringify(futureEntry));
  await assert.rejects(restoreMigration(workspace,result.backupId!),/不支持的数据版本/);
  const future=JSON.parse(original);future.version=2;await fs.writeFile(backupFile,JSON.stringify(future));
  await assert.rejects(restoreMigration(workspace,result.backupId!),/备份格式版本 2/);
  assert.ok((await migrationBackups(workspace))[0].error);
});

test('MIG-008：备份不能越界、改写 Git 内部或通过符号链接恢复',async t=>{
  const {root,workspace}=await setup(t), result=await applyMigrations(workspace,(await previewMigrations(workspace)).token);
  const backupFile=path.join(root,'.reqtype/local/migrations',result.backupId!+'.json'), original=JSON.parse(await fs.readFile(backupFile,'utf8'));
  for(const target of ['../escape.md','.git/config']) {const backup=structuredClone(original);backup.entries[0].path=target;await fs.writeFile(backupFile,JSON.stringify(backup));await assert.rejects(restoreMigration(workspace,result.backupId!),/不允许|路径无效/);}
  await fs.writeFile(backupFile,JSON.stringify(original));await fs.rename(path.join(root,'modules'),path.join(root,'saved-modules'));await fs.symlink(path.join(root,'saved-modules'),path.join(root,'modules'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(restoreMigration(workspace,result.backupId!),/符号链接/);
});

test('MIG-009：磁盘保存和导入不能把未来模块降成 v1，普通损坏元数据仍可修复',async t=>{
  const {root,workspace}=await setup(t), file='modules/future.md', future=await fixture('future/module.md');await fs.writeFile(path.join(root,file),future);
  await assert.rejects(workspace.save(file,(await fixture('v1/module.md')).toString(),digest(future)),/格式版本 2/);assert.deepEqual(await fs.readFile(path.join(root,file)),future);
  const incoming=(await fixture('v1/module.md')).toString().replaceAll('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444').replaceAll('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555').replaceAll('33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666').replaceAll('OLD-','NEW-');
  const preview=await prepareImport(workspace,'future.md',[{path:file,bytes:Buffer.from(incoming)}]);await assert.rejects(applyImport(workspace,preview.token,[file]),/格式版本 2/);
  await fs.writeFile(path.join(root,'modules/broken.md'),'---\nauthor: [broken\n---\n\n# Text');
  await assert.doesNotReject(workspace.save('modules/broken.md','# Fixed',digest('---\nauthor: [broken\n---\n\n# Text')));
});

test('MIG-010：未来恢复日志不执行回滚；旧 pending 日志先留原文再恢复',async t=>{
  const {root}=await setup(t), file='modules/target.md', before=Buffer.from('before'), after=Buffer.from('after');
  await fs.writeFile(path.join(root,file),after);
  const payload={state:'pending',entries:[{path:file,before:before.toString('base64'),after:after.toString('base64'),expected:digest(before),written:digest(after)}]};
  const journalFile=path.join(root,'.reqtype/local/transactions/pending.json'), future=JSON.stringify({format:'reqtype.transaction',version:2,payload});await fs.writeFile(journalFile,future);
  const blocked=await Workspace.open(root);assert.match(blocked.recoveryWarnings.join(),/格式版本 2/);assert.deepEqual(await fs.readFile(path.join(root,file)),after);assert.equal(await fs.readFile(journalFile,'utf8'),future);
  const legacy=JSON.stringify(payload);await fs.writeFile(journalFile,legacy);
  const archive=path.join(root,'.reqtype/local/legacy-journals',digest(legacy)+'.json');await fs.mkdir(path.dirname(archive),{recursive:true});await fs.writeFile(archive,'corrupted');
  assert.match((await Workspace.open(root)).recoveryWarnings.join(),/备份校验失败/);assert.deepEqual(await fs.readFile(path.join(root,file)),after);
  assert.equal(await fs.readFile(journalFile,'utf8'),legacy);await fs.rm(archive);await Workspace.open(root);
  assert.deepEqual(await fs.readFile(path.join(root,file)),before);assert.equal(readJournalDocument(await fs.readFile(journalFile,'utf8')).value.state,'rolled-back');
  assert.equal(await fs.readFile(path.join(root,'.reqtype/local/legacy-journals',digest(legacy)+'.json'),'utf8'),legacy);
});

test('MIG-011：迁移后原生交换往返保留升级文本和二进制附件，不携带本机备份',async t=>{
  const source=await setup(t),target=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-migrated-exchange-'));t.after(()=>fs.rm(target,{recursive:true,force:true}));
  await applyMigrations(source.workspace,(await previewMigrations(source.workspace)).token);const before=await exportWorkspace(source.workspace);
  assert.ok(!before.files.some(file=>file.path.startsWith('.reqtype/local/')));
  const ws=await Workspace.open(target),preview=await prepareImport(ws,'exchange.json',decodeExchange(before));await applyImport(ws,preview.token,preview.entries.map(entry=>entry.path));
  const after=await exportWorkspace(ws), hashes=(value:typeof before)=>Object.fromEntries(value.files.map(file=>[file.path,file.sha256]));assert.deepEqual(hashes(before),hashes(after));
});

test('MIG-012：跨文档重复身份阻止升级，不会自动重新编号或分配 UUID',async t=>{
  const {root,workspace,originals}=await setup(t);await fs.writeFile(path.join(root,'modules/duplicate.md'),await fixture('v1/module.md'));
  const preview=await previewMigrations(workspace);assert.ok(preview.entries.some(row=>row.status==='blocked'&&row.message?.includes('重复')));
  await assert.rejects(applyMigrations(workspace,preview.token),/未修改任何文件/);await unchanged(root,originals);
});

test('MIG-013：本机偏好首次写新格式前留原文，版本冲突和坏备份不覆盖',async t=>{
  const {saveAppState}=await import('../src/main/state-storage');const {writePluginState}=await import('../src/core/app-state');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-state-format-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'disabled.json'),old='["custom.disabled"]\r\n';await fs.writeFile(file,old);
  const next=writePluginState([],old);await saveAppState(file,'plugins',next,old);
  assert.equal(await fs.readFile(path.join(root,'.format-backups',`disabled.json.v0.${digest(old)}.json`),'utf8'),old);
  await assert.rejects(saveAppState(file,'plugins',next,old),/外部修改/);
  await fs.writeFile(file,old);await fs.writeFile(path.join(root,'.format-backups',`disabled.json.v0.${digest(old)}.json`),'corrupted');
  await assert.rejects(saveAppState(file,'plugins',next,old),/备份校验失败/);assert.equal(await fs.readFile(file,'utf8'),old);
});

test('MIG-014：十分钟预览过期或新增恢复问题时阻止首写',async t=>{
  const {root,workspace,originals}=await setup(t),preview=await previewMigrations(workspace),now=Date.now;
  try { Date.now=()=>now()+11*60*1000;await assert.rejects(applyMigrations(workspace,preview.token),/预览已过期/); }
  finally { Date.now=now; }
  const fresh=await previewMigrations(workspace);workspace.recoveryWarnings.push('恢复日志尚有未解决问题');
  await assert.rejects(applyMigrations(workspace,fresh.token),/未修改任何文件/);
  await unchanged(root,originals);assert.deepEqual(await migrationBackups(workspace),[]);
});
