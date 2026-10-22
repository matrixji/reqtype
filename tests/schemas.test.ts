import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { defaultConfig } from '../src/core/config';
import { defaultPlantuml, writeRendererDocument } from '../src/core/rendering';
import { frontmatter, parseDocumentSource } from '../src/core/markdown';
import { writeJournalDocument } from '../src/main/workspace';
import { writePluginState, writePreferences } from '../src/core/app-state';
import { defaultAIProfile } from '../src/core/ai';
const directory='schemas/',prefix='https://reqtype.local/schemas/';
async function validator() { const ajv=new Ajv2020({allErrors:true});addFormats(ajv);for(const name of await fs.readdir(directory))if(name.endsWith('.schema.json'))ajv.addSchema(JSON.parse(await fs.readFile(directory+name,'utf8')));return ajv; }

test('SCHEMA-001：各版本 Schema 离线编译，冻结夹具与当前写入器满足契约',async()=>{
  const ajv=await validator();
  const check=(name:string,value:unknown)=>{const validate=ajv.getSchema(prefix+name+'.schema.json')!;assert.ok(validate, name);assert.equal(validate(value),true,JSON.stringify(validate.errors));};
  check('project-v2',defaultConfig());check('project-v1',parse(await fs.readFile('tests/fixtures/formats/v1/project.yaml','utf8')));
  const source=await fs.readFile('tests/fixtures/formats/v1/module.md','utf8'),fm=frontmatter(source)!;
  check('module-v1',parse(source.slice(fm.yamlFrom,fm.yamlTo)));
  const v2=await fs.readFile('tests/fixtures/formats/v2/module.md','utf8'),fm2=frontmatter(v2)!;check('module-v2',parse(v2.slice(fm2.yamlFrom,fm2.yamlTo)));
  for(const req of parseDocumentSource('fixture.md',source).requirements)check('requirement-v1',req.meta);
  check('workspace-v1',JSON.parse(await fs.readFile('tests/fixtures/formats/v1/exchange.json','utf8')));
  check('renderers-v1',JSON.parse(writeRendererDocument(defaultPlantuml())));
  check('transaction-v1',JSON.parse(writeJournalDocument({state:'done',entries:[]})));
  check('preferences-v1',JSON.parse(writePreferences('/project')));
  check('plugin-state-v1',JSON.parse(writePluginState(['test.disabled'])));
  check('ai-v1',{format:'reqtype.ai',version:1,payload:defaultAIProfile()});
  check('migration-backup-v1',{format:'reqtype.migration-backup',version:1,id:'test-backup',createdAt:'2026-10-17T00:00:00.000Z',projectId:null,documents:['modules'],entries:[]});
});

test('SCHEMA-002：未来版本、错误字段类型拒绝；可选扩展字段保留兼容',async()=>{
  const ajv=await validator(),project=ajv.getSchema(prefix+'project-v1.schema.json')!,module=ajv.getSchema(prefix+'module-v1.schema.json')!;
  assert.equal(project({...defaultConfig(),version:2}),false);assert.equal(project({...defaultConfig(),version:'1'}),false);
  assert.equal(project({...defaultConfig(),version:1,typeAttributes:undefined,'x-vendor':{future:true}}),true);
  assert.equal(project({...defaultConfig(),requirement:{...defaultConfig().requirement,padding:0}}),false);
  assert.equal(module({reqtype:2,module:'11111111-1111-4111-8111-111111111111'}),false);
  assert.equal(ajv.getSchema(prefix+'transaction-v1.schema.json')!({format:'reqtype.transaction',version:1,payload:{state:'unknown',entries:[]}}),false);
});

test('SCHEMA-003：项目 v2 支持类型属性与数组，v1 Schema 保留旧契约',async()=>{
 const ajv=await validator(),v1=ajv.getSchema(prefix+'project-v1.schema.json')!,v2=ajv.getSchema(prefix+'project-v2.schema.json')!;
 const config=defaultConfig();config.attributes={platforms:{type:'array',items:'string'}};config.typeAttributes={requirement:['platforms']};
 assert.equal(v2(config),true,JSON.stringify(v2.errors));assert.equal(v1(config),false);
 assert.equal(v2({...config,attributes:{platforms:{type:'array',items:'object'}}}),false);
 assert.equal(v2({...config,typeAttributes:{requirement:['platforms','platforms']}}),false);
 assert.equal(v2({...config,version:3}),false);
});
