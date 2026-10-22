import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { FORMATS, assertFormatVersion, migrateSource } from '../src/core/formats';
import { defaultConfig, parseConfig } from '../src/core/config';
import { parseDocumentSource, patchRequirement, ensureModule } from '../src/core/markdown';
import { readRendererDocument, writeRendererDocument } from '../src/core/rendering';
import { readJournalDocument, writeJournalDocument } from '../src/main/workspace';
import { decodeExchange } from '../src/main/exchange';
import { migrateDataSource } from '../src/main/migrations';
const fixture = (file: string) => fs.readFile(`tests/fixtures/formats/${file}`,'utf8');

test('FMT-001：格式域独立，严格拒绝非法版本与未来版本', async () => {
  for (const kind of Object.keys(FORMATS) as (keyof typeof FORMATS)[]) {
    assert.doesNotThrow(()=>assertFormatVersion(kind,1));
    for (const value of [undefined,null,'1',0,-1,1.5,FORMATS[kind].current+1,Number.NaN]) assert.throws(()=>assertFormatVersion(kind,value),/格式版本/);
  }
  assert.throws(()=>parseConfig('version: "1"\nname: Wrong'),/格式版本/);
  assert.throws(()=>parseConfig('version: 3\nname: Future'),/项目配置格式版本/);
  const old=parseConfig(await fixture('v1/project.yaml')); assert.equal(old.requirement.prefix,defaultConfig().requirement.prefix);
  assert.equal(old.id,undefined); assert.equal((old as any)['x-project'].preserve,true);
});

test('FMT-002：冻结的旧模块逐步迁移为 v2，BOM、CRLF、身份、编号、关联与未知字段保留', async () => {
  const source=await fixture('legacy/module.md'), expected=await fixture('v2/module.md');
  const result=migrateDataSource('module',source,'modules/frozen.md');
  assert.equal(result.source,expected); assert.equal(result.from,0); assert.equal(result.to,2);
  assert.equal(parseDocumentSource('frozen.md',result.source).requirements.length,2);
  assert.equal(migrateDataSource('module',result.source,'modules/frozen.md').source,result.source);
  assert.deepEqual(migrateDataSource('module',result.source,'modules/frozen.md').steps,[]);
});

test('FMT-003：未来模块不按 v1 解析；属性补丁和模块补全不能隐式降级', async () => {
  const source=await fixture('future-v3/module.md'), old=parseDocumentSource('frozen.md',await fixture('v1/module.md'));
  const parsed=parseDocumentSource('future.md',source); assert.equal(parsed.readOnly,true); assert.equal(parsed.requirements.length,0);
  assert.match(parsed.diagnostics[0].message,/格式版本 3/);
  assert.throws(()=>patchRequirement(source,old.requirements[0],'status','approved'),/格式版本/);
  assert.throws(()=>ensureModule(source,'Future','44444444-4444-4444-8444-444444444444'),/格式版本/);
  assert.throws(()=>migrateDataSource('module',source),/格式版本/);
  const malformed=source.replace('x-module: untouched # keep','bad: [broken');
  assert.equal(parseDocumentSource('future.md',malformed).readOnly,true);
});

test('FMT-004：旧本机设置和日志可读；新信封保留扩展字段，未知信封不降级', async () => {
  const old=await fixture('legacy/renderers.json'), result=migrateDataSource('renderers',old);
  assert.equal(readRendererDocument(old).legacy,true); assert.equal(readRendererDocument(result.source).legacy,false);
  assert.deepEqual(readRendererDocument(result.source).value,JSON.parse(old));
  const envelope=JSON.parse(result.source);envelope['x-envelope']={keep:true};
  const saved=JSON.parse(writeRendererDocument({...readRendererDocument(result.source).value,javaPath:'/local/java'},JSON.stringify(envelope)));
  assert.deepEqual(saved['x-envelope'],{keep:true});assert.equal(saved.payload['x-vendor'].keep,42);
  const journal=await fixture('legacy/journal.json'), migrated=migrateDataSource('journal',journal);
  assert.deepEqual(readJournalDocument(migrated.source).value,JSON.parse(journal));
  assert.equal(JSON.parse(writeJournalDocument({state:'done',entries:[]})).version,1);
  assert.throws(()=>readRendererDocument('{"format":"other","version":1,"payload":{}}'),/格式标识/);
  assert.throws(()=>readRendererDocument('{"format":"reqtype.renderers","version":2,"payload":{}}'),/格式版本/);
  assert.throws(()=>readJournalDocument(futureJournal),/格式版本/);
});
const futureJournal='{"format":"reqtype.transaction","version":2,"payload":{"state":"pending","entries":[]}}';

test('FMT-005：恢复日志在触碰文件前校验结构、路径、状态与内容哈希', () => {
  for (const input of [{state:'unknown',entries:[]},{state:'pending',entries:[null]},{state:'pending',entries:[{path:'../a'}]},{state:'pending',entries:[{path:'a.md',before:null,after:'YQ==',expected:null,written:'bad'}]}]) assert.throws(()=>readJournalDocument(JSON.stringify(input)));
});

test('FMT-006：冻结交换包可读，非法／未知版本与条目结构明确拒绝', async () => {
  const source=JSON.parse(await fixture('v1/exchange.json')); assert.equal(decodeExchange(source)[0].bytes.toString('utf8'),await fixture('v1/module.md'));
  for (const version of ['1',null,0,2]) assert.throws(()=>decodeExchange({...source,version}),/格式版本/);
  for (const file of [null,42,{path:'a.md',encoding:'utf8',content:'x',sha256:'bad'}]) assert.throws(()=>decodeExchange({...source,files:[file]}),/条目无效/);
});

test('FMT-007：多步前向迁移顺序、确定性、无操作与逐步校验', () => {
  const seen:number[]=[];
  const definition={current:3,readVersion:(source:string)=>JSON.parse(source).version,validate:(source:string)=>{assert.equal(JSON.parse(source).keep,'原文');},steps:[2,1].map(from=>({id:`v${from}`,from,to:from+1,transform(source:string){seen.push(from);return JSON.stringify({...JSON.parse(source),version:from+1});}}))};
  const source='{"version":1,"keep":"原文"}', first=migrateSource(source,definition);
  assert.deepEqual(seen,[1,2]);assert.deepEqual(first.steps,['v1','v2']);assert.equal(migrateSource(source,definition).source,first.source);
  assert.equal(migrateSource(first.source,definition).source,first.source);
  assert.throws(()=>migrateSource('{"version":4}',definition),/无法迁移/);
});

test('FMT-008：迁移缺口、重复步骤、跳版本和错误输出不会伪装成功', () => {
  const readVersion=(source:string)=>JSON.parse(source).version, validate=()=>{};
  const step={id:'one',from:1,to:2,transform:()=>'{"version":2}'};
  for (const steps of [[],[step,step],[{...step,to:3}],[{...step,transform:()=>'{"version":1}'}]]) assert.throws(()=>migrateSource('{"version":1}',{current:2,readVersion,validate,steps}));
  assert.throws(()=>migrateSource('{"version":1}',{current:2,readVersion,validate:source=>{if(readVersion(source)===2)throw new Error('目标校验失败');},steps:[step]}),/目标校验失败/);
});

test('FMT-009：最近项目和插件启用状态兼容旧布局、保留扩展，未来状态拒绝覆盖', async () => {
  const {readPreferences,writePreferences,readPluginState,writePluginState}=await import('../src/core/app-state');
  const recent=JSON.stringify({lastWorkspace:'/old','x-pref':42}), saved=writePreferences('/new',recent);
  assert.equal(readPreferences(saved).value.lastWorkspace,'/new');assert.equal(readPreferences(saved).value['x-pref'],42);
  const plugins=writePluginState(['custom.one'],'["custom.two"]');assert.deepEqual(readPluginState(plugins).value.disabled,['custom.one']);
  const extended=JSON.parse(plugins);extended['x-root']=true;extended.payload['x-pref']=1;
  const rewritten=JSON.parse(writePluginState([],JSON.stringify(extended)));assert.equal(rewritten['x-root'],true);assert.equal(rewritten.payload['x-pref'],1);
  assert.throws(()=>writePreferences('/new','{"format":"reqtype.preferences","version":2,"payload":{}}'),/格式版本/);
  assert.throws(()=>writePluginState([],'{"format":"reqtype.plugin-state","version":2,"payload":{}}'),/格式版本/);
  assert.throws(()=>readPluginState('{"disabled":"all"}'),/无效/);
});
