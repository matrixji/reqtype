import { Annotation, EditorSelection, EditorState, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { parseDocumentSource } from '../core/markdown';
import type { ParsedDocument, Requirement } from '../shared/types';

/** Only application operations and history may intentionally change hidden structure. */
export const structuralEdit=Annotation.define<boolean>();
export function bodyRange(source:string,req:Requirement) {
 const raw=source.slice(req.bodyFrom,req.bodyTo);
 const leading=/^(?:\r?\n){1,2}/.exec(raw)?.[0].length??0;
 const trailing=/(?:\r?\n){1,2}$/.exec(raw)?.[0].length??0;
 return {from:req.bodyFrom+leading,to:Math.max(req.bodyFrom+leading,req.bodyTo-trailing)};
}
export function protectedRanges(source:string,path:string,doc=parseDocumentSource(path,source)) {
 const ranges:{from:number;to:number;blockStart?:boolean;blockEnd?:boolean}[]=doc.frontmatter?[{from:doc.frontmatter.from,to:doc.frontmatter.to,blockStart:true}]:[];
 for(const req of doc.requirements){const body=bodyRange(source,req);ranges.push({from:req.from,to:body.from,blockStart:true},{from:body.to,to:req.to,blockEnd:true});}
 return ranges;
}
export function editablePosition(source:string,pos:number,doc:ParsedDocument) {
 if(doc.frontmatter&&pos>=doc.frontmatter.from&&pos<=doc.frontmatter.to){pos=doc.frontmatter.to;while(pos<source.length&&/[\r\n]/.test(source[pos]))pos++;}
 for(const req of doc.requirements){const body=bodyRange(source,req);if(pos>=req.from&&pos<body.from)return body.from;if(pos>body.to&&pos<=req.to)return body.to;}
 return pos;
}

/** Use DOM text positions inside block wrappers, retaining native click/drag selection semantics. */
export function requirementMouseSelection(documentField:StateField<ParsedDocument>) {
 return EditorView.mouseSelectionStyle.of((view,first)=>{
  const target=first.target as HTMLElement;
  if(first.button!==0||!target.closest('.requirement-region')||!target.closest('.cm-line')||target.closest('button,a,input,.req-reference'))return null;
  function position(event:MouseEvent) {
   const element=event.target as HTMLElement,line=element.closest('.cm-line');
   let pos=view.posAtCoords({x:event.clientX,y:event.clientY})??view.state.selection.main.head;
   if(line&&view.contentDOM.contains(line)){
    const from=view.posAtDOM(line,0),to=view.posAtDOM(line,line.childNodes.length);
    const range=(view.dom.ownerDocument as Document&{caretRangeFromPoint?:(x:number,y:number)=>Range|null}).caretRangeFromPoint?.(event.clientX,event.clientY);
    if(range&&line.contains(range.startContainer))pos=view.posAtDOM(range.startContainer,range.startOffset);
    pos=Math.max(from,Math.min(to,pos));
   }
   return editablePosition(view.state.doc.toString(),pos,view.state.field(documentField));
  }
  let initial=view.state.selection,start=position(first);
  const count=first.detail>=3?3:first.detail===2?2:1;
  function unit(pos:number){if(count===2)return view.state.wordAt(pos)??EditorSelection.cursor(pos);if(count===3){const line=view.state.doc.lineAt(pos);return EditorSelection.range(line.from,line.to);}return EditorSelection.cursor(pos);}
  let base=unit(start);
  return {
   get(event:MouseEvent,extend:boolean,multiple:boolean){
    const head=position(event),current=unit(head);
    const range=extend?EditorSelection.range(initial.main.anchor,head):count===1?EditorSelection.range(start,head):head<base.from?EditorSelection.range(base.to,current.from):EditorSelection.range(base.from,current.to);
    return multiple?initial.addRange(range):EditorSelection.create([range]);
   },
   update(update:ViewUpdate){if(update.docChanged){initial=initial.map(update.changes);start=update.changes.mapPos(start);base=base.map(update.changes);}}
  };
 });
}
/** An unfinished fence may temporarily hide an end marker from Markdown's AST.
 * Keep the last known, mapped boundaries protected until the body is valid again. */
export function requirementDocument(path:()=>string,sourceMode=()=>false) {
 return StateField.define<ParsedDocument>({create:state=>parseDocumentSource(path(),state.doc.toString()),update(previous,tr){
  if(!tr.docChanged)return previous;
  const source=tr.newDoc.toString(),parsed=parseDocumentSource(path(),source);
  if(sourceMode()||parsed.readOnly)return parsed;
  const requirements=new Map(parsed.requirements.map(req=>[req.meta.id,req]));
  for(const req of previous.requirements){
   const mapped={...req,from:tr.changes.mapPos(req.from,1),to:tr.changes.mapPos(req.to,-1),metaFrom:tr.changes.mapPos(req.metaFrom,1),metaTo:tr.changes.mapPos(req.metaTo,-1),bodyFrom:tr.changes.mapPos(req.bodyFrom,-1),bodyTo:tr.changes.mapPos(req.bodyTo,1)};
   mapped.body=source.slice(mapped.bodyFrom,mapped.bodyTo).trim();
   const found=requirements.get(req.meta.id);
   const intact=source.slice(mapped.from,mapped.bodyFrom)===tr.startState.doc.sliceString(req.from,req.bodyFrom)&&source.slice(mapped.bodyTo,mapped.to)===tr.startState.doc.sliceString(req.bodyTo,req.to);
   if(intact&&(!found||found.from!==mapped.from||found.to!==mapped.to))requirements.set(req.meta.id,mapped);
  }
  return {...parsed,requirements:[...requirements.values()].sort((a,b)=>a.from-b.from)};
 }});
}
export function protectRequirementBoundaries(path:string,onBlocked:()=>void,documentField=requirementDocument(()=>path)):Extension {
 const ranges=StateField.define<DecorationSet>({
  create(state){return build(state);},update(value,tr){return tr.docChanged?build(tr.state):value;},
  provide:field=>EditorView.atomicRanges.of(view=>view.state.field(field)),
 });
 function build(state:EditorState){const doc=state.field(documentField);const ranges=doc.frontmatter?[{from:0,to:doc.frontmatter.to}]:[];for(const req of doc.requirements)ranges.push({from:req.from,to:req.bodyFrom},{from:req.bodyTo,to:req.to});return Decoration.set(ranges.filter(r=>r.to>r.from).map(r=>Decoration.mark({}).range(r.from,r.to)),true);}
 return [documentField,ranges,EditorState.transactionFilter.of(tr=>{
  const trusted=tr.annotation(structuralEdit)||tr.isUserEvent('undo')||tr.isUserEvent('redo');
  if(tr.docChanged&&!trusted){
   const protectedText=protectedRanges(tr.startState.doc.toString(),path,tr.startState.field(documentField));let blocked=false;
   tr.changes.iterChangedRanges((from,to)=>{if(protectedText.some(r=>from===to?(from>r.from||r.blockStart&&from===r.from)&&(from<r.to||r.blockEnd&&from===r.to):from<r.to&&to>r.from))blocked=true;});
   if(blocked){queueMicrotask(onBlocked);return [];}
  }
  // Reject selection changes too: a suppressed Backspace must not leave the caret inside metadata.
  const source=tr.newDoc.toString(),doc=tr.state.field(documentField),selection=EditorSelection.create(tr.newSelection.ranges.map(range=>EditorSelection.range(editablePosition(source,range.anchor,doc),editablePosition(source,range.head,doc))),tr.newSelection.mainIndex);
  return selection.eq(tr.newSelection)?tr:[tr,{selection,sequential:true}];
 })];
}
