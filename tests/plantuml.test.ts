import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { defaultPlantuml } from '../src/core/rendering';
import { encodePlantuml, renderPlantuml } from '../src/main/plantuml';
import { Workspace } from '../src/main/workspace';
const jar = path.resolve('resources/plantuml/plantuml.jar');
const decode = (value: string) => inflateRawSync(Buffer.from([...value].map(char => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'['0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'.indexOf(char)]).join(''), 'base64')).toString('utf8');

test('PlantUML Server 编码与 HTTP 渲染；本地模式不会回退到网络', async t => {
  const requests: string[] = [], server = createServer((request,response) => { requests.push(request.url!); response.setHeader('Content-Type','image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg"><text>Local server</text></svg>'); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const source = '@startuml\nAlice -> Bob: 中文\n@enduml'; assert.equal(decode(encodePlantuml(source)),source);
  const settings = { ...defaultPlantuml(), mode: 'server' as const, serverUrl: `http://127.0.0.1:${(server.address() as any).port}/plantuml` };
  assert.match(await renderPlantuml(source,settings,{root:process.cwd(),documentPath:'requirements/02-system.md',bundledJar:jar}), /Local server/);
  assert.equal(requests.length,1); assert.equal(decode(requests[0].slice('/plantuml/svg/'.length)),source);
  await assert.rejects(renderPlantuml(source,{...settings,mode:'jar',jarPath:'/missing/plantuml.jar'},{root:process.cwd(),documentPath:'requirements/02-system.md',bundledJar:jar}),/找不到/);
  assert.equal(requests.length,1);
});

test('本地 JAR 实际绘图、本地 include 与禁止远程引用', async t => {
  try { execFileSync('java',['-version'],{stdio:'ignore'}); } catch { t.skip('当前环境缺少 Java'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-plantuml-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'include.puml'),'!define MESSAGE Local_Include\n');
  const context = {root,documentPath:'diagram.md',bundledJar:jar};
  const svg = await renderPlantuml('@startuml\n!include include.puml\nAlice -> Bob: MESSAGE\n@enduml',defaultPlantuml(),context);
  assert.match(svg,/<svg/); assert.match(svg,/Local_Include/);
  let requests = 0;
  const server = createServer((_request,response)=>{requests++;response.end('!define REMOTE value');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  await assert.rejects(renderPlantuml(`@startuml\n!includeurl http://127.0.0.1:${(server.address() as any).port}/remote.puml\nAlice -> Bob: REMOTE\n@enduml`,defaultPlantuml(),context),/本地渲染失败/);
  assert.equal(requests,0);
});

test('本机渲染设置与项目配置一起保存，交换不携带本机路径', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-render-settings-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const ws=await Workspace.create(root), before=await ws.projectSettings();
  const renderers={settings:{...defaultPlantuml(),javaPath:'/local/java'},version:null};
  await ws.saveProject(before.config,before.version,renderers);
  const saved=await ws.projectSettings();assert.equal(saved.renderers.settings.javaPath,'/local/java');
  await assert.rejects(ws.saveProject(saved.config,saved.version,renderers),/本机渲染设置已被外部修改/);
  const {exportWorkspace}=await import('../src/main/exchange');const bundle=await exportWorkspace(ws);assert.ok(!bundle.files.some(file=>file.path.includes('renderers.json')));
});
