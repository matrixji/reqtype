import { randomUUID } from 'node:crypto';
import { attributesForType } from '../core/config';
import { indexWorkspace, patchRequirement } from '../core/markdown';
import { Workspace, applyTransaction, digest } from './workspace';
import type { TypeMigrationPreview, WorkspaceSnapshot } from '../shared/types';
interface Plan { root: string; createdAt: number; fingerprint: string; updates: {path:string;bytes:Buffer;expected:string}[]; preview: TypeMigrationPreview }
const plans = new Map<string,Plan>();
async function state(workspace:Workspace) {
  const snapshot=await workspace.snapshot(),settings=await workspace.projectSettings();
  if(snapshot.warnings.length)throw new Error(`请先处理工作区问题：${snapshot.warnings[0]}`);
  return {snapshot,fingerprint:digest(JSON.stringify({config:settings.version,files:snapshot.files.map(file=>[file.path,file.version])}))};
}
export async function previewTypeMigration(workspace:Workspace,from:string,to:string):Promise<TypeMigrationPreview> {
  const {snapshot,fingerprint}=await state(workspace);
  if(from===to || !snapshot.config.types.includes(from) || !snapshot.config.types.includes(to))throw new Error('请选择项目中两个不同的有效条目类型');
  const index=indexWorkspace(snapshot.files,snapshot.config);
  if(index.diagnostics.some(d=>d.severity==='error'))throw new Error('请先修复项目诊断中的错误，再迁移条目类型');
  const matches=index.requirements.filter(req=>(req.meta.type??'requirement')===from),updates:Plan['updates']=[],warnings=new Set<string>();
  const allowed=attributesForType(snapshot.config,to);
  for(const file of snapshot.files) {
    let content=file.content;
    for(const req of matches.filter(req=>req.path===file.path).sort((a,b)=>b.from-a.from)) {
      for(const name of Object.keys(req.meta.attributes??{}))if(!Object.hasOwn(allowed,name))warnings.add(`属性 ${name} 未为 ${to} 启用；迁移保留原值，可在项目设置中为目标类型启用。`);
      content=patchRequirement(content,req,'type',to);
    }
    if(content!==file.content)updates.push({path:file.path,bytes:Buffer.from(content),expected:file.version});
  }
  const preview={token:randomUUID(),from,to,entries:matches.map(req=>({path:req.path,id:req.meta.id,key:req.meta.key,title:req.title})),warnings:[...warnings]};
  if(plans.size>=10)plans.delete(plans.keys().next().value!);
  plans.set(preview.token,{root:workspace.root,createdAt:Date.now(),fingerprint,updates,preview});return preview;
}
export async function applyTypeMigration(workspace:Workspace,token:string,afterWrite?:(index:number)=>void|Promise<void>):Promise<WorkspaceSnapshot> {
  const plan=plans.get(token);
  if(!plan || plan.root!==workspace.root || Date.now()-plan.createdAt>10*60*1000)throw new Error('类型迁移预览已过期，请重新检查');
  if((await state(workspace)).fingerprint!==plan.fingerprint)throw new Error('预览后项目内容或配置发生变化，未修改任何文件，请重新预览');
  if(plan.updates.length)await applyTransaction(workspace.root,plan.updates,afterWrite);
  plans.delete(token);return workspace.snapshot();
}
