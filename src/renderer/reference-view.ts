import { referenceEscaped, referencesInText } from '../core/references';
import type { Requirement } from '../shared/types';

export interface ReferenceView {
 enabled:boolean;
 requirements:Requirement[];
 navigate(target:string):void;
}
export function referenceInfo(target:string,requirements:Requirement[]) {
 const matches=requirements.filter(req=>req.meta.id.toLowerCase()===target.toLowerCase());
 const req=matches.length===1?matches[0]:undefined;
 return {req,title:req?`${req.meta.key??''} · ${req.title}\n${req.path}\n${req.body.slice(0,240)}`:matches.length?'引用目标有歧义':'引用目标缺失'};
}

/** MDAST transformer shared by every rendered Markdown block. Source offsets preserve escapes. */
export function remarkReferences(source:string,options?:ReferenceView) {
 return function transform(tree:any) {
  if(!options?.enabled)return;
  function walk(parent:any) {
   if(['code','inlineCode','html','math','inlineMath','link','image','definition'].includes(parent.type))return;
   if(!parent.children)return;
   parent.children=parent.children.flatMap((node:any)=>{
    if(node.type!=='text'){walk(node);return [node];}
    const from=node.position?.start.offset??0,to=node.position?.end.offset??from;
    const tokens=referencesInText(source,from,to,true);if(!tokens.length)return [node];
    const nodes:any[]=[];let cursor=0;
    for(const token of tokens) {
     const raw=source.slice(token.from,token.to);
     const textarea=document.createElement('textarea');textarea.innerHTML=raw.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,'$1').replaceAll('<','&lt;');
     const decoded=textarea.value,at=node.value.indexOf(decoded,cursor);if(at<0)continue;
     if(at>cursor)nodes.push({type:'text',value:node.value.slice(cursor,at)});
     if(referenceEscaped(source,token.from))nodes.push({type:'text',value:decoded});
     else {
      const {req,title}=referenceInfo(token.target,options!.requirements);
      nodes.push({type:'link',url:`#req-${token.target}`,title,children:[{type:'text',value:token.label??(req?`${req.meta.key??''} ${req.title}`.trim():token.target)}],data:{hProperties:{'data-req-target':token.target,className:['req-reference',...(req?[]:['reference-missing'])]}}});
     }
     cursor=at+decoded.length;
    }
    if(cursor<node.value.length)nodes.push({type:'text',value:node.value.slice(cursor)});
    return nodes.length?nodes:[node];
   });
  }walk(tree);
 };
}
