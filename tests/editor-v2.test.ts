import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../src/core/config';
import { ensureModule, makeRequirement, parseDocumentSource, indexWorkspace, patchRequirement, upgradeModuleSource } from '../src/core/markdown';
import { formatReference } from '../src/core/references';
import { migrateDataSource } from '../src/main/migrations';
import { Workspace } from '../src/main/workspace';
import { exportWorkspace, decodeExchange, prepareImport, applyImport } from '../src/main/exchange';
import { EditorState } from '@codemirror/state';
import { bodyRange, protectRequirementBoundaries, structuralEdit, requirementDocument } from '../src/renderer/editor-protection';

const id='5e43d568-9e2c-4a9e-a12c-26934b450624';
const meta={id,key:'REQ-001',type:'requirement',status:'draft'};
const v2=(body:string)=>ensureModule(body,'新版模块',randomUUID());

test('BLOCK-001：新模块使用 v2，begin/end 配对和多种正文不改变源区间',()=>{
 const body='段落 😀\r\n\r\n| A | B |\r\n| --- | --- |\r\n| x | y |\r\n\r\n```md\r\n<!-- req:end -->\r\n```';
 const source=v2(makeRequirement(body,meta,'\r\n',2));
 const doc=parseDocumentSource('new.md',source);
 assert.equal(doc.version,2);assert.equal(doc.requirements.length,1);assert.deepEqual(doc.diagnostics,[]);
 assert.equal(doc.requirements[0].body,body);
 assert.match(source.slice(doc.requirements[0].from,doc.requirements[0].bodyFrom),/^<!-- req:begin/);
 assert.equal(source.slice(doc.requirements[0].bodyTo,doc.requirements[0].to),'<!-- req:end -->');
 assert.equal(patchRequirement(source,doc.requirements[0],'status','reviewed'),source.replace('status: draft','status: "reviewed"'));
});

test('BLOCK-002：v1 原文保存不隐式升版，冻结字节逐步迁移至 v2，仅改版本和真实边界',async()=>{
 const source=await fs.readFile('tests/fixtures/formats/v1/module.md','utf8');
 assert.equal(ensureModule(source,'ignored',randomUUID()),source);
 const output=upgradeModuleSource(source);
 let expected=source.replace('reqtype: 1','reqtype: 2');
 expected=expected.replace('<!-- req\r\nid: "22222222','<!-- req:begin\r\nid: "22222222').replace('<!-- req\r\nid: "33333333','<!-- req:begin\r\nid: "33333333').replaceAll('<!-- /req -->','<!-- req:end -->');
 assert.equal(output,expected);
 const semantics=(text:string)=>parseDocumentSource('frozen.md',text).requirements.map(req=>({meta:req.meta,body:req.body}));
 assert.deepEqual(semantics(output),semantics(source));assert.equal(upgradeModuleSource(output),output);
 const legacy=await fs.readFile('tests/fixtures/formats/legacy/module.md','utf8');
 const migrated=migrateDataSource('module',legacy);
 assert.equal(migrated.source,expected);assert.deepEqual(migrated.steps,['module-0-to-1','module-1-to-2']);
});

test('BLOCK-003：版本混用、未闭合、孤立 end、嵌套被诊断，代码示例保持字面量',()=>{
 const block=makeRequirement('正文',meta,'\n',2);
 for(const body of [block.replace('<!-- req:end -->',''),'<nowiki>\n\n<!-- req:end -->',block.replace('正文',block)])assert.ok(parseDocumentSource('new.md',v2(body)).diagnostics.some(d=>d.severity==='error'));
 const wrong=v2(block).replace('reqtype: 2','reqtype: 1');assert.match(parseDocumentSource('old.md',wrong).diagnostics.map(d=>d.message).join(),/版本|v2/);
 assert.equal(parseDocumentSource('new.md',v2('```md\n'+block+'\n```')).requirements.length,0);
 assert.equal(parseDocumentSource('future.md',v2(block).replace('reqtype: 2','reqtype: 3')).readOnly,true);
});

test('REF-001：正文、标题、列表、表格内引用带精确偏移，代码、转义、公式和元数据不参与',()=>{
 const ref=formatReference(id,'登录:要求]');
 const source=v2(`# ${ref}\n\n- ${ref}\n\n| 链接 |\n| --- |\n| ${ref} |\n\n\`${ref}\`\n\n\\${ref}\n\n\`\`\`md\n${ref}\n\`\`\`\n\n$${ref}$\n\n<!-- ${ref} -->\n`);
 const doc=parseDocumentSource('refs.md',source);assert.equal(doc.references.length,3);
 for(const found of doc.references){assert.equal(found.target,id);assert.equal(found.label,'登录:要求]');assert.equal(source.slice(found.from,found.to),ref);}
});

test('REF-002：反向引用包含普通文本来源，断链保留且提示，不生成业务关联',()=>{
 const missing=randomUUID(),source=v2(makeRequirement('需求正文',meta,'\n',2)+'\n\n普通说明 '+formatReference(id,'需求')+' 和 '+formatReference(missing,'暂缺'));
 const index=indexWorkspace([{path:'refs.md',content:source}],defaultConfig());
 assert.equal(index.references.length,2);assert.equal(index.requirements[0].meta.links,undefined);
 assert.ok(index.diagnostics.some(d=>d.severity==='warning'&&d.message.includes('正文引用目标不存在')));
 assert.equal(index.references[0].sourceId,undefined);
 const old=source.replace('reqtype: 2','reqtype: 1').replace('req:begin','req').replace('req:end','/req');assert.equal(parseDocumentSource('old.md',old).references.length,0);
});

test('EDITOR-002：普通输入、退格、跨边界替换与多选区不能改写隐藏结构，结构命令和历史可撤销',()=>{
 for(const version of [1,2] as const) {
  const source=ensureModule(makeRequirement('正文 😀',meta,'\n',version),'保护',randomUUID()),req=parseDocumentSource('a.md',source).requirements[0],body=bodyRange(source,req);
  const state=EditorState.create({doc:source,extensions:[protectRequirementBoundaries('a.md',()=>{})]});
  for(const changes of [{from:body.from-1,to:body.from,insert:''},{from:body.to,to:body.to+1,insert:''},{from:body.from-1,to:body.to+1,insert:'替换'},{from:0,to:source.length,insert:''},[{from:body.from,to:body.from,insert:'安全'},{from:req.from+5,to:req.from+6,insert:'坏'}]])assert.equal(state.update({changes}).state.doc.toString(),source);
  assert.equal(state.update({changes:{from:body.from,insert:'新增'}}).state.doc.toString(),source.slice(0,body.from)+'新增'+source.slice(body.from));
  assert.equal(state.update({changes:{from:req.from,to:req.to,insert:''},annotations:structuralEdit.of(true)}).state.doc.toString(),source.slice(0,req.from)+source.slice(req.to));
 }
});

test('EDITOR-004：拦截退格同时保留光标；未闭合代码围栏和撤销期间仍保护已知标签',()=>{
 const source=v2(makeRequirement('正文',meta,'\n',2)),req=parseDocumentSource('a.md',source).requirements[0],body=bodyRange(source,req),field=requirementDocument(()=>'a.md');
 let state=EditorState.create({doc:source,selection:{anchor:body.from},extensions:[field,protectRequirementBoundaries('a.md',()=>{},field)]});
 const blocked=state.update({changes:{from:body.from-1,to:body.from},selection:{anchor:body.from-1}}).state;assert.equal(blocked.selection.main.head,body.from);
 const home=state.update({selection:{anchor:0}}).state;assert.equal(home.selection.main.head,body.from);
 assert.equal(state.update({changes:{from:req.from,insert:'破坏标记'}}).state.doc.toString(),source);
 state=state.update({changes:{from:body.from,insert:'```md\n'}}).state;
 assert.equal(parseDocumentSource('a.md',state.doc.toString()).requirements.length,0);assert.equal(state.field(field).requirements.length,1);
 const tracked=state.field(field).requirements[0];assert.equal(state.update({changes:{from:tracked.bodyTo,to:tracked.to,insert:''}}).state.doc.toString(),state.doc.toString());
 state=state.update({changes:{from:tracked.bodyTo-2,insert:'\n```'},userEvent:'undo'}).state;assert.equal(state.field(field).requirements.length,1);
 assert.equal(state.update({changes:{from:0,to:state.doc.length,insert:''},annotations:structuralEdit.of(true)}).state.field(field).requirements.length,0);
});

test('REF-003：模块 v2 与正文引用通过原生交换精确保留，文件改名不改变引用目标',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-ref-exchange-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'first'));await fs.mkdir(path.join(root,'second'));
 const first=await Workspace.create(path.join(root,'first')),second=await Workspace.create(path.join(root,'second'));
 const source=v2(makeRequirement('目标正文',{...meta,key:'REQ-002'},'\n',2)+'\n\n外部说明 '+formatReference(id,'登录要求'));
 await fs.writeFile(path.join(first.root,'modules/references.md'),source);
 const exported=await exportWorkspace(first),incoming=decodeExchange(exported),preview=await prepareImport(second,'exchange.json',incoming);await applyImport(second,preview.token,preview.entries.map(entry=>entry.path));
 assert.equal(await fs.readFile(path.join(second.root,'modules/references.md'),'utf8'),source);
 await fs.rename(path.join(second.root,'modules/references.md'),path.join(second.root,'modules/renamed.md'));
 const snapshot=await second.snapshot(),index=indexWorkspace(snapshot.files,snapshot.config);
 assert.equal(index.references.length,1);assert.equal(index.references[0].target,id);assert.equal(index.references[0].path,'modules/renamed.md');assert.deepEqual(index.diagnostics,[]);
});
