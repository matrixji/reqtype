import { validateAIRequest } from '../core/ai';
import { AISettingsStore } from './ai-settings';
import { ChatCompletionsProvider, type AIProvider } from './ai-client';
import type { AIEvent } from '../shared/ai-types';

export class AIService {
 private active=new Map<string,AbortController>();
 private epoch=0;
 constructor(private settings:AISettingsStore,private emit:(event:AIEvent)=>void,private provider:AIProvider=new ChatCompletionsProvider()){}
 async start(input:unknown){
  const request=validateAIRequest(input);if(this.active.size>=2||this.active.has(request.id))throw new Error('已有 AI 请求正在执行，请先取消或等待完成');
  const epoch=this.epoch,controller=new AbortController();this.active.set(request.id,controller);
  let credentials:Awaited<ReturnType<AISettingsStore['credentials']>>;
  try {credentials=await this.settings.credentials();}catch(error){this.active.delete(request.id);throw error;}
  if(controller.signal.aborted||epoch!==this.epoch){this.active.delete(request.id);this.emit({id:request.id,type:'cancelled'});return {id:request.id};}
  const {profile,key}=credentials;
  void this.provider.run(profile,key,request,controller.signal,text=>this.emit({id:request.id,type:'delta',text})).then(result=>{if(controller.signal.aborted)this.emit({id:request.id,type:'cancelled'});else this.emit({id:request.id,type:'done',...result});}).catch(error=>{
   if(controller.signal.aborted)this.emit({id:request.id,type:'cancelled'});
   else {const message=(error as Error).message??'';this.emit({id:request.id,type:'error',error:/^AI (服务|流|响应|输出|尚)/.test(message)&&(!key||!message.includes(key))?message:'AI 请求失败，请检查服务地址、网络或响应格式'});}
  }).finally(()=>this.active.delete(request.id));
  return {id:request.id};
 }
 cancel(id:string){this.active.get(id)?.abort();}
 cancelAll(){this.epoch++;for(const controller of this.active.values())controller.abort();}
}
