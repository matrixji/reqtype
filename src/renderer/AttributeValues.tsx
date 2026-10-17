import { useState } from 'react';
import { attributesForType } from '../core/config';
import type { AttributeDefinition, ProjectConfig, Requirement } from '../shared/types';
interface Props { req: Requirement; config: ProjectConfig; onChange(values: Record<string,unknown>): void; onError(message:string):void }
export function AttributeValues({req,config,onChange,onError}:Props) {
  const [selected,setSelected]=useState('');
  const values=req.meta.attributes??{},definitions=attributesForType(config,req.meta.type??config.requirement.defaultType);
  const set=(name:string,value:unknown)=>onChange({...values,[name]:value});
  const remove=(name:string)=>{const next={...values};delete next[name];onChange(next);};
  const numeric=(text:string)=>{if(!text.trim()||!Number.isFinite(Number(text)))throw new Error('请输入有效数值');return Number(text);};
  const initial=(def:AttributeDefinition)=>def.type==='array'?[]:def.type==='number'?0:def.type==='boolean'?false:def.type==='enum'?def.values?.[0]??'':'';
  const available=Object.keys(definitions).filter(name=>!Object.hasOwn(values,name));
  return <div className="attribute-values"><div className="attribute-picker"><select aria-label="选择自定义属性" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">选择属性…</option>{available.map(name=><option key={name} value={name}>{definitions[name].label||name}</option>)}</select><button type="button" className="button button-small" disabled={!available.includes(selected)} onClick={()=>{set(selected,initial(definitions[selected]));setSelected('');}}>添加属性</button></div>
    {Object.entries(values).map(([name,value])=>{const def=definitions[name],title=def?.label||name;
      return <div className="attribute-value" key={req.meta.id+name}><div className="attribute-value-heading"><strong>{title}</strong><button type="button" className="text-button" aria-label={`移除属性 ${name}`} onClick={()=>remove(name)}>移除</button></div>{!def?<p className="muted-small">当前类型未启用，原值保留：{JSON.stringify(value)}</p>:def.type==='array'?<div className="array-value">{(Array.isArray(value)?value:[]).map((item,index)=><div className="array-item" key={index}><input aria-label={`${title} 第 ${index+1} 项`} key={JSON.stringify(item)} type={def.items==='number'?'number':'text'} defaultValue={String(item)} onBlur={event=>{try{const next=[...(value as unknown[])];next[index]=def.items==='number'?numeric(event.target.value):event.target.value;set(name,next);}catch(error){event.target.value=String(item);onError((error as Error).message);}}}/><button type="button" className="text-button" aria-label={`删除 ${title} 第 ${index+1} 项`} onClick={()=>set(name,(value as unknown[]).filter((_,i)=>i!==index))}>删除</button></div>)}<button type="button" className="button button-small" onClick={()=>set(name,[...(Array.isArray(value)?value:[]),def.items==='number'?0:''])}>添加{title}项</button></div>:def.type==='boolean'?<label><input aria-label={title} type="checkbox" checked={Boolean(value)} onChange={event=>set(name,event.target.checked)}/>启用</label>:def.type==='enum'?<select aria-label={title} value={String(value)} onChange={event=>set(name,event.target.value)}>{def.values?.map(option=><option key={option}>{option}</option>)}</select>:<input aria-label={title} key={JSON.stringify(value)} type={def.type==='number'?'number':'text'} defaultValue={String(value)} onBlur={event=>{try{set(name,def.type==='number'?numeric(event.target.value):event.target.value);}catch(error){event.target.value=String(value);onError((error as Error).message);}}}/>}{def?.description&&<small>{def.description}</small>}</div>;
    })}
    {!Object.keys(definitions).length&&<p className="muted-small">当前类型尚无可选属性，可在项目设置中定义并启用。</p>}
  </div>;
}
