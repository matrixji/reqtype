import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createServer,type ServerResponse} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {setImmediate as immediate} from 'node:timers/promises';
import {defaultAIProfile,validateAIProfile,validateAIRequest,captureAIContext,applyAIResult} from '../src/core/ai';
import {ensureModule,makeRequirement,parseDocumentSource} from '../src/core/markdown';
import {AISettingsStore,type CredentialVault} from '../src/main/ai-settings';
import {ChatCompletionsProvider,type AIProvider} from '../src/main/ai-client';
import {AIService} from '../src/main/ai-service';
import type {AIEvent,AIProfile,AIRequest} from '../src/shared/ai-types';

const request=(id='request-one'):AIRequest=>({id,action:'polish',text:'只发送这一段 😀',instruction:'保持原意'});
const profile=(baseUrl:string):AIProfile=>({...defaultAIProfile(),enabled:true,baseUrl,model:'configured-model'});
async function temporary(t:TestContext){const root=await fs.mkdtemp(path.join(os.tmpdir(),'reqtype-ai-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function vault():CredentialVault {
 const key=randomBytes(32);
 return {available:()=>true,encrypt(value){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);return Buffer.concat([nonce,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]);},decrypt(input){const bytes=Buffer.from(input),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');}};
}
async function server(t:TestContext,handler:(path:string,input:any,response:ServerResponse,headers:Record<string,any>)=>void|Promise<void>){
 const app=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;await handler(req.url!,body?JSON.parse(body):{},res,req.headers);});
 await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>{app.closeAllConnections();app.close(()=>resolve());}));
 return `http://127.0.0.1:${(app.address() as {port:number}).port}`;
}
function sse(response:ServerResponse,text:string,finish='stop',done=true){response.writeHead(200,{'Content-Type':'text/event-stream'});response.write(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})}\n\n`);response.end(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:finish}]})}\n\n${done?'data: [DONE]\n\n':''}`);}

test('AI-001：默认关闭、地址和请求有界，选区/应用保留模块与条目身份，旧请求不能覆盖新编辑',()=>{
 assert.equal(defaultAIProfile().enabled,false);
 for(const url of ['file:///tmp/key','http://example.com/v1','https://user:pass@example.com/v1','https://example.com/v1?key=secret'])assert.throws(()=>validateAIProfile(profile(url)));
 assert.equal(validateAIProfile(profile('http://localhost:8080/nested/v1/')).baseUrl,'http://localhost:8080/nested/v1');
 assert.throws(()=>validateAIRequest({...request(),text:'x'.repeat(64001)}));
 const meta={id:randomUUID(),key:'REQ-001',type:'requirement',status:'draft'},source=ensureModule(makeRequirement('原始正文 😀',meta,'\r\n',2),'AI',randomUUID()),req=parseDocumentSource('a.md',source).requirements[0],from=source.indexOf('原始正文'),to=from+'原始正文 😀'.length;
 const context=captureAIContext('/project','a.md',source,from,to),changed=applyAIResult(context,source,'改进正文\n\n验收标准','polish');
 assert.equal(changed,source.slice(0,from)+'改进正文\r\n\r\n验收标准'+source.slice(to));assert.deepEqual(parseDocumentSource('a.md',changed).requirements[0].meta,meta);
 assert.throws(()=>captureAIContext('/project','a.md',source,req.from,req.bodyTo),/标签|边界/);
 assert.throws(()=>applyAIResult(context,source+'新增编辑','结果','polish'),/已变化/);
 assert.throws(()=>applyAIResult(context,source,'<!-- req:end -->','polish'),/破坏|不能修改/);
 assert.throws(()=>applyAIResult(context,source,'建议','review'),/不能直接替换/);
 const newMeta={...meta,id:randomUUID(),key:'REQ-002',title:'草稿'},draft=applyAIResult(context,source,'草稿正文','draft',{meta:newMeta,moduleId:randomUUID()});
 assert.deepEqual(parseDocumentSource('a.md',draft).requirements.map(req=>req.meta),[meta,newMeta]);
});

test('AI-002：凭据由安全存储加密，公开状态不返回密钥；冲突、未知版本和不可用安全存储保留原文',async t=>{
 const root=await temporary(t),file=root+'/ai.json',store=new AISettingsStore(file,vault()),secret='unit-test-private-key';
 assert.deepEqual(await store.read(),{...defaultAIProfile(),hasApiKey:false,version:null});
 let saved=await store.save({...profile('https://example.com/v1'),apiKey:secret},null);
 assert.equal(saved.hasApiKey,true);assert.equal(JSON.stringify(saved).includes(secret),false);assert.equal((await fs.readFile(file,'utf8')).includes(secret),false);assert.equal((await store.credentials()).key,secret);
 if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
 await assert.rejects(store.save(profile('https://example.com/v1'),null),/外部修改/);
 saved=await store.save({...saved,baseUrl:'https://different.example/v1'},saved.version);assert.equal(saved.hasApiKey,false);assert.equal((await store.credentials()).key,'');
 const future=JSON.stringify({format:'reqtype.ai',version:2,payload:{...saved,encryptedKey:'future'}});await fs.writeFile(file,future);await assert.rejects(store.read(),/格式版本 2/);await assert.rejects(store.save(saved,saved.version),/格式版本 2/);assert.equal(await fs.readFile(file,'utf8'),future);
 const unavailable=new AISettingsStore(root+'/unavailable.json',{available:()=>false,encrypt(){throw new Error('must not encrypt');},decrypt(){throw new Error('must not decrypt');}});
 await assert.rejects(unavailable.save({...profile('https://example.com/v1'),apiKey:secret},null),/安全存储不可用/);await assert.rejects(fs.stat(root+'/unavailable.json'),{code:'ENOENT'});
});

test('AI-003：真实 HTTP SSE 跨字节中文/emoji/CRLF、usage 与最小上下文，兼容 JSON 返回',async t=>{
 let seen:any,authorization:string|undefined;
 const base=await server(t,async(path,input,response,headers)=>{
  seen=input;authorization=headers.authorization;
  if(path.startsWith('/json')){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:'JSON 结果'},finish_reason:'stop'}]}));return;}
  response.writeHead(200,{'Content-Type':'text/event-stream'});
  const frames=[{choices:[{delta:{content:'中文 😀'},finish_reason:null}]},{choices:[{delta:{content:' 完成'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}}].map(value=>'data: '+JSON.stringify(value)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
  const bytes=Buffer.from(frames);for(let i=0;i<bytes.length;i++){response.write(bytes.subarray(i,i+1));await immediate();}response.end();
 });
 const chunks:string[]=[],result=await new ChatCompletionsProvider().run(profile(base+'/v1'),'test-key',request(),new AbortController().signal,chunk=>chunks.push(chunk));
 assert.equal(result.text,'中文 😀 完成');assert.equal(chunks.join(''),result.text);assert.deepEqual(result.usage,{input:12,output:4,total:16});assert.equal(authorization,'Bearer test-key');assert.equal(seen.model,'configured-model');assert.equal(seen.stream,true);assert.equal(seen.messages.length,2);assert.deepEqual(JSON.parse(seen.messages[1].content),{instruction:'保持原意',selectedMarkdown:'只发送这一段 😀'});
 assert.equal((await new ChatCompletionsProvider().run(profile(base+'/json'),' ',request(),new AbortController().signal,()=>{})).text,'JSON 结果');
});

test('AI-004：中断、截断、HTTP 错误、取消和超时不产生可应用结果；重定向不转发凭据',async t=>{
 let stolen=0;
 const base=await server(t,(path,_input,response)=>{
  if(path.startsWith('/redirect')){response.writeHead(307,{Location:base+'/stolen'});response.end();}
  else if(path==='/stolen'){stolen++;response.end('{}');}
  else if(path.startsWith('/401')){response.writeHead(401,{'Content-Type':'application/json'});response.end('{"error":"secret-echo"}');}
  else if(path.startsWith('/slow')){response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n');}
  else if(path.startsWith('/truncated'))sse(response,'部分','stop',false);
  else sse(response,'部分','length');
 });
 const provider=new ChatCompletionsProvider();for(const route of ['truncated','length'])await assert.rejects(provider.run(profile(base+'/'+route),'secret-echo',request(),new AbortController().signal,()=>{}),/中断|完整/);
 await assert.rejects(provider.run(profile(base+'/401'),'secret-echo',request(),new AbortController().signal,()=>{}),error=>{assert.match((error as Error).message,/HTTP 401/);assert.equal((error as Error).message.includes('secret-echo'),false);return true;});
 await assert.rejects(provider.run(profile(base+'/redirect'),'secret-echo',request(),new AbortController().signal,()=>{}));assert.equal(stolen,0);
 const cancel=new AbortController();await assert.rejects(provider.run(profile(base+'/slow'),'',request(),cancel.signal,()=>cancel.abort()));
 await assert.rejects(new ChatCompletionsProvider(30).run(profile(base+'/slow'),'',request(),new AbortController().signal,()=>{}));
});

test('AI-005：主进程请求可取消，包括读取设置期间；事件隔离且不会将密钥带入错误',async()=>{
 let release!:()=>void,calls=0;const waiting=new Promise<void>(resolve=>release=resolve),events:AIEvent[]=[];
 const store={async credentials(){await waiting;return {profile:profile('https://example.com/v1'),key:'private-key'};}} as AISettingsStore;
 const provider:AIProvider={async run(){calls++;throw new Error('AI 服务返回 private-key');}};
 const service=new AIService(store,event=>events.push(event),provider),pending=service.start(request('cancel-pending'));service.cancel('cancel-pending');release();await pending;
 assert.equal(calls,0);assert.deepEqual(events,[{id:'cancel-pending',type:'cancelled'}]);
 await service.start(request('error-request'));for(let n=0;n<20&&!events.some(e=>e.id==='error-request');n++)await immediate();
 assert.equal(JSON.stringify(events).includes('private-key'),false);assert.ok(events.some(e=>e.id==='error-request'&&e.type==='error'));
});
