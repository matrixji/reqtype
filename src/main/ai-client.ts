import { aiMessages, validateAIProfile, validateAIRequest } from '../core/ai';
import type { AIProfile, AIRequest, AIUsage } from '../shared/ai-types';

export interface AIProvider {
 run(profile:AIProfile,key:string,request:AIRequest,signal:AbortSignal,onDelta:(text:string)=>void):Promise<{text:string;usage?:AIUsage}>;
}
function usage(value:any):AIUsage|undefined {
 if(!value||typeof value!=='object')return;
 const result:AIUsage={};for(const [from,to] of [['prompt_tokens','input'],['completion_tokens','output'],['total_tokens','total']] as const)if(Number.isSafeInteger(value[from])&&value[from]>=0)result[to]=value[from];return result;
}
/** Minimal Chat Completions adapter. It never retries a request or follows a redirect. */
export class ChatCompletionsProvider implements AIProvider {
 constructor(private timeout=120000){}
 async run(input:AIProfile,key:string,value:AIRequest,signal:AbortSignal,onDelta:(text:string)=>void) {
  const profile=validateAIProfile(input),request=validateAIRequest(value);
  if(!profile.enabled)throw new Error('AI 尚未启用');
  const response=await fetch(`${profile.baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model:profile.model,messages:aiMessages(request),stream:true}),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(this.timeout)])});
  if(!response.ok){await response.body?.cancel();throw new Error(`AI 服务返回 HTTP ${response.status}${response.status===401?'，请检查凭据':response.status===429?'，请稍后重试':''}`);}
  let text='',tokens:AIUsage|undefined,finish:string|undefined;
  const append=(chunk:unknown)=>{if(typeof chunk!=='string')return;text+=chunk;if(text.length>64000)throw new Error('AI 输出超过 64000 字符，已停止');onDelta(chunk);};
  if(response.headers.get('content-type')?.includes('application/json')){
   if(!response.body)throw new Error('AI 响应为空');const reader=response.body.getReader(),decoder=new TextDecoder();let raw='',size=0;
   try{for(;;){const part=await reader.read();size+=part.value?.byteLength??0;if(size>512000)throw new Error('AI 响应过大');raw+=decoder.decode(part.value,{stream:!part.done});if(part.done)break;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const result=JSON.parse(raw);append(result.choices?.[0]?.message?.content);finish=result.choices?.[0]?.finish_reason;tokens=usage(result.usage);
  } else {
   if(!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw new Error('AI 服务未返回 SSE 或 JSON 响应');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false,total=0;
   const event=(frame:string)=>{
    const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;
    if(data.trim()==='[DONE]'){done=true;return;}
    const result=JSON.parse(data);if(result.error)throw new Error('AI 服务返回流式错误');
    const choice=result.choices?.[0];if(choice?.finish_reason)finish=choice.finish_reason;
    append(choice?.delta?.content);tokens=usage(result.usage)??tokens;
   };
   try {
    while(!done){const part=await reader.read();buffer=(buffer+decoder.decode(part.value,{stream:!part.done})).replace(/\r\n/g,'\n');total+=part.value?.byteLength??0;if(total>512000)throw new Error('AI 响应过大');let end:number;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);event(frame);if(done)break;}if(part.done){if(buffer.trim())event(buffer);break;}}
    if(!done)throw new Error('AI 流在完成标记前中断，请重新生成');
   } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  if(finish&&finish!=='stop')throw new Error('AI 输出未完整结束，请调整输入后重新生成');
  if(!text.trim())throw new Error('AI 服务没有返回文本内容');
  return {text,usage:tokens};
 }
}
