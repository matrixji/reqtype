import type { TextReference } from '../shared/types';

const uuidSource='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const referenceTarget=new RegExp(`^req-(${uuidSource})$`,'i');
export function referenceEscaped(source:string,at:number) { let count=0;while(at>0&&source[--at]==='\\')count++;return count%2===1; }

/** Scan only Markdown text-node source spans. Never run on code, metadata or rendered HTML. */
export function referencesInText(source:string,from=0,to=source.length,includeEscaped=false):Omit<TextReference,'path'>[] {
 const found:Omit<TextReference,'path'>[]=[];
 for(let at=source.indexOf('[[[',from);at>=0&&at<to;at=source.indexOf('[[[',at+3)) {
  if(referenceEscaped(source,at)&&!includeEscaped)continue;
  let end=source.indexOf(']]]',at+3);while(end>=0&&referenceEscaped(source,end))end=source.indexOf(']]]',end+3);
  if(end<0||end+3>to)continue;
  const inside=source.slice(at+3,end);if(/[\r\n]/.test(inside))continue;
  const colon=inside.lastIndexOf(':req-'),hasLabel=colon>=0&&!referenceEscaped(inside,colon);
  const target=referenceTarget.exec(hasLabel?inside.slice(colon+1):inside);
  if(!target)continue;
  const label=hasLabel?inside.slice(0,colon).replace(/\\([\\\[\]:])/g,'$1'):undefined;
  if(hasLabel&&(!label?.trim()||label.length>256))continue;
  found.push({from:at,to:end+3,target:target[1],...(label===undefined?{}:{label})});at=end;
 }
 return found;
}
export function formatReference(target:string,label?:string) {
 if(!referenceTarget.test(`req-${target}`))throw new Error('正文引用目标必须是需求 UUID');
 if(label!==undefined&&(!label.trim()||/[\r\n]/.test(label)||label.length>256))throw new Error('引用文字须为 1 至 256 字符的单行文本');
 return `[[[${label===undefined?'':label.replace(/[\\\[\]:]/g,'\\$&')+':'}req-${target}]]]`;
}
