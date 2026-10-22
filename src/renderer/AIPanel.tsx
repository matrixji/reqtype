import { useEffect, useRef, useState } from 'react';
import { defaultAIProfile } from '../core/ai';
import type { AIAction, AIContext, AISettings, AIUsage } from '../shared/ai-types';
import type { ProjectConfig } from '../shared/types';

const api=window.reqtype;
const errorText=(error:unknown)=>(error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,'');
function ChangePreview({before,after}:{before:string;after:string}) {
 let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 while(end<before.length-start&&end<after.length-start&&before[before.length-end-1]===after[after.length-end-1])end++;
 return <pre className="ai-diff" aria-label="润色差异">{before.slice(0,start)}<del>{before.slice(start,before.length-end)}</del><ins>{after.slice(start,after.length-end)}</ins>{end?before.slice(before.length-end):''}</pre>;
}
export function AIPanel({context,config,onClose,onApply}:{context:AIContext;config:ProjectConfig;onClose():void;onApply(action:AIAction,text:string,title:string,type:string):void}) {
 const [settings,setSettings]=useState<AISettings>({...defaultAIProfile(),version:null,hasApiKey:false}),[loaded,setLoaded]=useState(false),[apiKey,setApiKey]=useState(''),[clearKey,setClearKey]=useState(false),[settingsOpen,setSettingsOpen]=useState(false);
 const [action,setAction]=useState<AIAction>(context.text.trim()?'polish':'draft'),[instruction,setInstruction]=useState(''),[output,setOutput]=useState(''),[status,setStatus]=useState<'idle'|'running'|'done'|'error'|'cancelled'>('idle'),[error,setError]=useState(''),[usage,setUsage]=useState<AIUsage>(),[title,setTitle]=useState('AI 需求草稿'),[type,setType]=useState(config.requirement.defaultType);
 const runId=useRef(''),mounted=useRef(true);const running=status==='running';
 useEffect(()=>{
  mounted.current=true;
  void api.aiSettings().then(value=>{if(mounted.current){setSettings(value);setSettingsOpen(!value.enabled);setLoaded(true);}}).catch(error=>{if(mounted.current){setError(errorText(error));setLoaded(false);setSettingsOpen(true);}});
  const remove=api.onAIEvent(event=>{if(event.id!==runId.current)return;
   if(event.type==='delta')setOutput(text=>text+event.text);
   else if(event.type==='done'){setOutput(event.text);setUsage(event.usage);setStatus('done');}
   else if(event.type==='cancelled')setStatus('cancelled');
   else{setError(event.error);setStatus('error');}
  });
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};document.addEventListener('keydown',escape);
  return()=>{mounted.current=false;remove();document.removeEventListener('keydown',escape);if(runId.current)void api.aiCancel(runId.current).catch(()=>{});};
 },[]);
 async function persist(){const saved=await api.saveAISettings({...settings,apiKey:apiKey||undefined,clearApiKey:clearKey},settings.version);if(mounted.current){setSettings(saved);setApiKey('');setClearKey(false);}return saved;}
 async function generate(){
  setError('');setOutput('');setUsage(undefined);setStatus('running');const id=crypto.randomUUID();runId.current=id;
  try{await persist();if(!mounted.current||runId.current!==id)return;await api.aiStart({id,action,text:context.text,instruction});}
  catch(error){if(mounted.current&&runId.current===id){setError(errorText(error));setStatus('error');}}
 }
 function cancel(){const id=runId.current;runId.current='';setStatus('cancelled');void api.aiCancel(id).catch(error=>setError(errorText(error)));}
 return <div className="modal-backdrop"><section className="modal modal-wide ai-panel" role="dialog" aria-modal="true" aria-label="AI 辅助"><header><h2>AI 辅助</h2><button className="icon-button" aria-label="关闭 AI 辅助" onClick={onClose}>×</button></header>
  <p className="muted-small">按需连接你配置的服务。仅发送下方选中内容和本次指令；关闭 AI 后，文档编辑和需求管理继续离线使用。</p>
  <details open={settingsOpen} onToggle={event=>setSettingsOpen(event.currentTarget.open)}><summary>AI 服务设置 · {settings.enabled?'已启用':'默认关闭'}</summary><fieldset disabled={running||!loaded}>
   <label className="checkbox-row"><input type="checkbox" aria-label="启用 AI" checked={settings.enabled} onChange={event=>setSettings({...settings,enabled:event.target.checked})}/>启用可选 AI 能力</label>
   <label className="field"><span>服务 Base URL</span><input aria-label="AI 服务地址" value={settings.baseUrl} onChange={event=>setSettings({...settings,baseUrl:event.target.value})} placeholder="https://api.example.com/v1"/><small>支持 Chat Completions 和本机 HTTP 服务。修改服务地址会清除原地址的已保存凭据。</small></label>
   <label className="field"><span>模型名称</span><input aria-label="AI 模型名称" value={settings.model} onChange={event=>setSettings({...settings,model:event.target.value})} placeholder="填写服务提供的模型 ID"/></label>
   <label className="field"><span>API Key（本机无鉴权服务可留空）</span><input aria-label="AI API Key" type="password" autoComplete="off" value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder={settings.hasApiKey?'已安全保存，留空保留':'仅保存在本机系统安全存储中'}/></label>
   <label className="checkbox-row"><input type="checkbox" checked={clearKey} onChange={event=>setClearKey(event.target.checked)}/>清除已保存的 API Key</label>
   <button className="button button-small" type="button" onClick={()=>{setError('');void persist().catch(error=>setError(errorText(error)));}}>保存 AI 设置</button>
  </fieldset></details>
  <div className="ai-controls"><label className="field"><span>辅助任务</span><select aria-label="AI 辅助任务" value={action} disabled={running} onChange={event=>{setAction(event.target.value as AIAction);setOutput('');setStatus('idle');setUsage(undefined);}}><option value="polish" disabled={!context.text.trim()}>润色选中文字</option><option value="draft">生成需求草稿</option><option value="review" disabled={!context.text.trim()}>检查需求质量</option></select></label>
   {action==='draft'&&<><label className="field"><span>草稿标题</span><input aria-label="AI 草稿标题" maxLength={100} value={title} disabled={running} onChange={event=>setTitle(event.target.value)}/></label><label className="field"><span>条目类型</span><select aria-label="AI 草稿类型" value={type} disabled={running} onChange={event=>setType(event.target.value)}>{config.types.map(type=><option key={type}>{type}</option>)}</select></label></>}
  </div>
  <details className="ai-context" open><summary>将发送的选中内容 · {context.text.length} 字符 · {context.path}</summary><pre aria-label="AI 选中内容">{context.text||'（未选择正文；生成草稿时仅发送指令）'}</pre></details>
  <label className="field"><span>本次指令（可选）</span><textarea aria-label="AI 本次指令" maxLength={4000} rows={2} value={instruction} disabled={running} onChange={event=>setInstruction(event.target.value)} placeholder="例如：使用可验证的措辞，保留原来的业务约束"/></label>
  <div className="ai-run-actions"><button className="button button-primary" disabled={!loaded||!settings.enabled||running||!context.text.trim()&&!instruction.trim()} onClick={()=>void generate()}>生成预览</button>{running&&<button className="button" onClick={cancel}>取消生成</button>}<span role="status">{{idle:'等待生成',running:'正在生成…',done:'生成完成，尚未修改文档',error:'生成失败，原文保留',cancelled:'已取消，原文保留'}[status]}</span></div>
  {error&&<p className="error-inline" role="alert">{error}</p>}
  {output&&<div className="ai-output"><label className="field"><span>{action==='review'?'质量检查建议':'候选结果（可编辑）'}</span><textarea aria-label="AI 候选结果" rows={7} value={output} readOnly={running||action==='review'} onChange={event=>setOutput(event.target.value)}/></label>{action==='polish'&&<ChangePreview before={context.text} after={output}/>}</div>}
  {usage&&<p className="muted-small">服务返回用量：输入 {usage.input??'—'} · 输出 {usage.output??'—'} · 合计 {usage.total??'—'} tokens</p>}
  <div className="modal-actions"><button className="button" onClick={onClose}>关闭</button>{action!=='review'&&<button className="button button-primary" disabled={status!=='done'||!output.trim()} onClick={()=>{try{onApply(action,output,title,type);}catch(error){setError(errorText(error));}}}>{action==='draft'?'创建需求条目':'应用润色'}</button>}</div>
 </section></div>;
}
