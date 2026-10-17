import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {stringify} from 'yaml';
import {attributesForType,defaultConfig,parseConfig,validAttribute} from '../src/core/config';
import {ensureModule,indexWorkspace,makeRequirement,nextKey,parseDocumentSource,patchRequirement} from '../src/core/markdown';
import {TYPE_PRESETS} from '../src/core/type-presets';
import {Workspace,digest} from '../src/main/workspace';
import {previewTypeMigration,applyTypeMigration} from '../src/main/item-types';
import {migrateDataSource} from '../src/main/migrations';
import {prepareImport,applyImport} from '../src/main/exchange';
async function setup(t:TestContext){const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-item-model-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const ws=await Workspace.create(root);return{root,ws};}
const module=(key:string,type='产品需求',attributes?:Record<string,unknown>)=>ensureModule(makeRequirement('### 正文标题\n\n正文保持不变。',{id:randomUUID(),key,type,status:'draft',...(attributes?{attributes}:{})}),'模块',randomUUID());
async function typed(t:TestContext){const data=await setup(t),settings=await data.ws.projectSettings();const config={...settings.config,types:[...settings.config.types,'产品需求','Story'],attributes:{...settings.config.attributes,effort:{type:'number' as const},platforms:{type:'array' as const,items:'string' as const}},typeAttributes:{...settings.config.typeAttributes,'产品需求':['owner','effort','platforms'],Story:['effort','platforms']}};await data.ws.saveProject(config,settings.version);for(const [file,key]of [['a.md','REQ-002'],['b.md','REQ-003']])await data.ws.save('modules/'+file,module(key,'产品需求',{effort:5,platforms:['macOS','Windows'],'x-vendor':{keep:true}}),null);return data;}

test('ITEM-001：标题独立于正文，局部补丁保留 BOM／CRLF；标题参与索引',()=>{
 const source='\uFEFF'+module('REQ-001').replace(/\n/g,'\r\n'),req=parseDocumentSource('a.md',source).requirements[0],updated=patchRequirement(source,req,'title','离线需求管理');
 const after=parseDocumentSource('a.md',updated).requirements[0];assert.equal(after.title,'离线需求管理');assert.equal(after.meta.title,'离线需求管理');assert.equal(after.body,req.body);assert.ok(updated.startsWith('\uFEFF'));assert.ok(!/(?<!\r)\n/.test(updated));assert.equal(after.meta.id,req.meta.id);assert.throws(()=>patchRequirement(updated,after,'key','OTHER-1'),/自动生成/);
 const blank=patchRequirement(updated,after,'title','');assert.equal(parseDocumentSource('a.md',blank).requirements[0].title,'正文标题');
});

test('ITEM-002：文本、有限数值和有类型数组校验，类型绑定与旧版语义独立',()=>{
 const config=defaultConfig();config.attributes={note:{type:'string'},effort:{type:'number'},platforms:{type:'array',items:'string'},costs:{type:'array',items:'number'}};config.typeAttributes={need:['note'],requirement:['effort','platforms','costs'],test:[]};
 const parsed=parseConfig(stringify(config));assert.deepEqual(Object.keys(attributesForType(parsed,'need')),['note']);assert.deepEqual(attributesForType(parsed,'test'),{});
 assert.ok(validAttribute(['macOS','Windows'],config.attributes.platforms));assert.ok(validAttribute([1,2.5],config.attributes.costs));for(const value of [[1],null,{},'a'])assert.equal(validAttribute(value,config.attributes.platforms),false);assert.equal(validAttribute(Infinity,config.attributes.effort),false);assert.equal(validAttribute([NaN],config.attributes.costs),false);
 assert.throws(()=>parseConfig(stringify({...config,version:1})),/项目格式 v2/);assert.throws(()=>parseConfig(stringify({...config,typeAttributes:{missing:['note']}})),/类型属性/);assert.throws(()=>parseConfig(stringify({...config,typeAttributes:{need:['missing']}})),/类型属性/);
 const named=parseConfig(stringify({...config,types:['constructor'],requirement:{...config.requirement,defaultType:'constructor'},typeAttributes:{}}));assert.deepEqual(attributesForType(named,'constructor'),{});
 const legacy=parseConfig('version: 1\nname: Legacy\nattributes: { owner: {type: string} }');assert.deepEqual(Object.keys(attributesForType(legacy,'need')),['owner']);
});

test('ITEM-003：项目 v1→v2 迁移保留扩展、注释、CRLF 与身份，原全局属性绑定全部既有类型',()=>{
 const source='# old project\r\nversion: 1\r\nname: Legacy\r\nid: 11111111-1111-4111-8111-111111111111\r\nx-vendor: {keep: true}\r\nattributes:\r\n  owner: {type: string, x-meta: 42}\r\n';
 const result=migrateDataSource('project',source);assert.equal(result.from,1);assert.equal(result.to,2);assert.deepEqual(result.steps,['project-1-to-2']);const after=parseConfig(result.source);assert.equal(after.id,'11111111-1111-4111-8111-111111111111');assert.ok(result.source.includes('# old project\r\n'));assert.deepEqual((after as any)['x-vendor'],{keep:true});assert.equal(after.attributes!.owner['x-meta'],42);for(const type of after.types)assert.deepEqual(after.typeAttributes![type],['owner']);assert.equal(migrateDataSource('project',result.source).source,result.source);
});

test('ITEM-004：在用类型／属性／绑定不可删除，保存不能绕过数据格式迁移',async t=>{
 const {root,ws}=await typed(t),settings=await ws.projectSettings(),before=await fs.readFile(path.join(root,'.reqtype/project.yaml'));
 const removed=structuredClone(settings.config);removed.types=removed.types.filter(type=>type!=='产品需求');delete removed.typeAttributes!['产品需求'];await assert.rejects(ws.saveProject(removed,settings.version),/仍被条目使用/);
 const unbound=structuredClone(settings.config);unbound.typeAttributes!['产品需求']=[];await assert.rejects(ws.saveProject(unbound,settings.version),/不能移除类型绑定/);
 const deleted=structuredClone(settings.config);delete deleted.attributes!.effort;for(const type of Object.keys(deleted.typeAttributes!))deleted.typeAttributes![type]=deleted.typeAttributes![type].filter(name=>name!=='effort');await assert.rejects(ws.saveProject(deleted,settings.version),/仍被条目使用/);
 const incompatible=structuredClone(settings.config);incompatible.attributes!.effort.type='string';await assert.rejects(ws.saveProject(incompatible,settings.version),/现有条目无效/);
 await assert.rejects(ws.saveProject({...settings.config,version:1},settings.version),/只能通过数据格式迁移/);assert.deepEqual(await fs.readFile(path.join(root,'.reqtype/project.yaml')),before);
});

test('ITEM-005：编号自动递增、跨模块重复及修改现有编号会在写入前拒绝',async t=>{
 const {root,ws}=await setup(t),before=await fs.readFile(path.join(root,'modules/welcome.md')),snapshot=await ws.snapshot(),req=indexWorkspace(snapshot.files,snapshot.config).requirements[0];assert.equal(nextKey([req]),'REQ-002');
 const duplicate=module('REQ-001','requirement');await assert.rejects(ws.save('modules/duplicate.md',duplicate,null),/重复的可读编号/);assert.equal(await fs.access(path.join(root,'modules/duplicate.md')).then(()=>true).catch(()=>false),false);
 await assert.rejects(ws.save('modules/bad.md',module('OTHER-001','requirement'),null),/项目前缀/);
 await assert.rejects(ws.save('modules/welcome.md',before.toString().replace('REQ-001','REQ-999'),digest(before)),/已有编号不允许修改/);assert.deepEqual(await fs.readFile(path.join(root,'modules/welcome.md')),before);
 const preview=await prepareImport(ws,'welcome.md',[{path:'modules/welcome.md',bytes:Buffer.from(before.toString().replace('REQ-001','OTHER-001'))}]);await assert.rejects(applyImport(ws,preview.token,['modules/welcome.md']),/不能修改已有条目/);
 assert.throws(()=>nextKey([{...req,meta:{...req.meta,key:'REQ-9007199254740991'}}]),/安全整数/);
});

test('ITEM-006：类型迁移覆盖全项目，预览零写入，只替换类型并保留源字节、属性及身份',async t=>{
 const {root,ws}=await typed(t),fileA=path.join(root,'modules/a.md');const raw=await fs.readFile(fileA,'utf8'),first=parseDocumentSource('a.md',raw).requirements[0];await fs.writeFile(fileA,'\uFEFF'+raw.replace(/\n/g,'\r\n')+'\r\n'+makeRequirement('第二条正文',{id:randomUUID(),key:'REQ-004',type:'产品需求',status:'draft',links:[{type:'depends_on',target:first.meta.id}]},'\r\n'));const snapshot=await ws.snapshot(),originals=new Map(snapshot.files.map(file=>[file.path,file.content]));
 const preview=await previewTypeMigration(ws,'产品需求','Story');assert.equal(preview.entries.length,3);for(const file of snapshot.files)assert.equal(await fs.readFile(path.join(root,file.path),'utf8'),file.content);
 await applyTypeMigration(ws,preview.token);for(const file of (await ws.snapshot()).files){const original=originals.get(file.path)!;assert.equal(file.content,file.path.endsWith('welcome.md')?original:original.replaceAll('type: 产品需求','type: "Story"'));}
 const settings=await ws.projectSettings(),config=structuredClone(settings.config);config.types=config.types.filter(type=>type!=='产品需求');delete config.typeAttributes!['产品需求'];await assert.doesNotReject(ws.saveProject(config,settings.version));
});

test('ITEM-007：迁移保留目标类型未启用的字段并预警；计划变化、跨项目及过期拒绝',async t=>{
 const {root,ws}=await typed(t),file=path.join(root,'modules/a.md');let content=await fs.readFile(file,'utf8');content=content.replace('effort: 5','owner: tester\n  effort: 5');await fs.writeFile(file,content);
 const preview=await previewTypeMigration(ws,'产品需求','Story');assert.ok(preview.warnings.some(w=>w.includes('owner')));const other=await setup(t);await assert.rejects(applyTypeMigration(other.ws,preview.token),/过期/);
 await fs.appendFile(file,'\n外部修改');await assert.rejects(applyTypeMigration(ws,preview.token),/未修改任何文件/);assert.match(await fs.readFile(file,'utf8'),/产品需求/);
 const fresh=await previewTypeMigration(ws,'产品需求','Story'),now=Date.now;try{Date.now=()=>now()+11*60*1000;await assert.rejects(applyTypeMigration(ws,fresh.token),/过期/);}finally{Date.now=now;}
 await applyTypeMigration(ws,fresh.token);assert.match(await fs.readFile(file,'utf8'),/owner: tester/);
});

test('ITEM-008：多文件类型迁移故障会回滚全部原文；新增文件使预览失效',async t=>{
 const {root,ws}=await typed(t),snapshot=await ws.snapshot(),preview=await previewTypeMigration(ws,'产品需求','Story');await assert.rejects(applyTypeMigration(ws,preview.token,()=>{throw new Error('模拟故障');}),/已恢复/);for(const file of snapshot.files)assert.equal(await fs.readFile(path.join(root,file.path),'utf8'),file.content);
 const fresh=await previewTypeMigration(ws,'产品需求','Story');await fs.writeFile(path.join(root,'modules/new.md'),'# New');await assert.rejects(applyTypeMigration(ws,fresh.token),/重新预览/);
});

test('ITEM-009：两种套餐离线可用、类型集合唯一；ASPICE 为参考映射',()=>{
 assert.deepEqual(TYPE_PRESETS[0].types,['Epic','Story','Task','Bug','Subtask']);assert.equal(TYPE_PRESETS[0].defaultType,'Story');assert.ok(TYPE_PRESETS[1].types.includes('软件需求'));for(const preset of TYPE_PRESETS)assert.equal(new Set(preset.types).size,preset.types.length);
});
