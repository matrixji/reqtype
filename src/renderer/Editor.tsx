import { forwardRef, useEffect, useLayoutEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { BlockWrapper, Decoration, EditorView, keymap, lineNumbers, placeholder, WidgetType, type DecorationSet } from '@codemirror/view';
import { autocompletion, completionKeymap, startCompletion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { render as renderMath } from 'katex';
import { defaultHighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdownTree, parseDocumentSource, lineEnding, canInsertReference, moduleVersion } from '../core/markdown';
import { formatReference, referenceEscaped } from '../core/references';
import { bodyRange, editablePosition, protectRequirementBoundaries, requirementMouseSelection, structuralEdit, requirementDocument } from './editor-protection';
import { referenceInfo, type ReferenceView } from './reference-view';
import { codeElement, markdownElement } from './markdown-view';
import type { ParsedDocument, Requirement, TextReference } from '../shared/types';

export interface EditorHandle { selection(): { from: number; to: number }; jump(from: number): void; undo(): void; redo(): void; insertReference():void }
interface Props { source: string; baseSource: string; path: string; sessionKey: string; epoch: number; sourceMode: boolean; readOnly?: boolean; spellcheck: boolean; requirements:Requirement[]; onReference(target:string):void; onNotice(message:string):void; onChange(source: string): void; onSelection(from: number, to: number): void }
const normalize = (source: string) => source.replace(/\r\n/g, '\n');
function rawOffset(raw: string, normalized: number) { let index = 0, count = 0; while (index < raw.length && count < normalized) { if (raw[index] === '\r' && raw[index + 1] === '\n') index++; index++; count++; } return index; }
function normalizedOffset(raw: string, offset: number) { return normalize(raw.slice(0, offset)).length; }
function minimalChange(before: string, after: string) { let start = 0, end = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++; while (end < before.length - start && end < after.length - start && before[before.length - end - 1] === after[after.length - end - 1]) end++; return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }; }
const sessions = new Map<string, { state: EditorState; document:ParsedDocument; raw: string; epoch: number }>();
const typeLabels: Record<string, string> = { need: '用户需求', requirement: '系统需求', test: '验证用例' };
const statusLabels: Record<string, string> = { draft: '草稿', reviewed: '已评审', approved: '已批准', retired: '已废弃' };

class RequirementTip extends WidgetType {
  constructor(public req: Requirement,public anchor:number) { super(); }
  get estimatedHeight(){return 0;}
  eq(other: RequirementTip) { return this.anchor === other.anchor && this.req.title===other.req.title && JSON.stringify(this.req.meta) === JSON.stringify(other.req.meta); }
  toDOM(view: EditorView) {
    const dom = document.createElement('button');dom.type='button';dom.className = 'requirement-marker requirement-tip';dom.title=this.req.title;dom.setAttribute('aria-label',`条目 ${this.req.meta.key??this.req.title}`); dom.dataset.requirement = this.req.meta.id;
    for (const [className, text] of [['requirement-key', this.req.meta.key || this.req.meta.id.slice(0, 8)], ['requirement-type', typeLabels[this.req.meta.type ?? 'requirement'] ?? this.req.meta.type ?? ''], [`status-dot ${this.req.meta.status ?? 'draft'}`, statusLabels[this.req.meta.status ?? 'draft'] ?? this.req.meta.status ?? '']]) { const span = document.createElement('span'); span.className = className; span.textContent = text; dom.append(span); }
    dom.addEventListener('mousedown', event => { event.preventDefault();view.dispatch({ selection: { anchor:this.anchor } });view.focus(); });
    const anchor=document.createElement('div');anchor.className='requirement-tip-anchor';anchor.append(dom);return anchor;
  }
  ignoreEvent() { return true; }
}
class ReferenceWidget extends WidgetType {
 constructor(public reference:TextReference,public references:ReferenceView){super();}
 eq(other:ReferenceWidget){return JSON.stringify(this.reference)===JSON.stringify(other.reference)&&referenceInfo(this.reference.target,this.references.requirements).title===referenceInfo(other.reference.target,other.references.requirements).title;}
 toDOM(view:EditorView){
  const {req,title}=referenceInfo(this.reference.target,this.references.requirements),link=document.createElement('span');
  link.className=`req-reference ${req?'':'reference-missing'}`;link.textContent=this.reference.label??(req?`${req.meta.key??''} ${req.title}`.trim():this.reference.target);link.title=title+'\nCmd/Ctrl + 点击跳转';link.dataset.reqTarget=this.reference.target;link.setAttribute('role','link');link.tabIndex=0;
  link.addEventListener('mousedown',event=>{event.preventDefault();if(event.metaKey||event.ctrlKey)this.references.navigate(this.reference.target);else{view.dispatch({selection:{anchor:this.reference.from+3}});view.focus();}});
  link.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.references.navigate(this.reference.target);}});return link;
 }
 ignoreEvent(){return true;}
}
class CodeBlockWidget extends WidgetType {
  constructor(public code: string, public info: string, public from: number, public editFrom: number, public path: string) { super(); }
  eq(other: CodeBlockWidget) { return this.code === other.code && this.info === other.info && this.from === other.from; }
  get estimatedHeight() { return Math.min(420, this.code.split('\n').length * 22 + 50); }
  toDOM(view: EditorView) {
    const edit = () => { view.dispatch({ selection: { anchor: this.editFrom }, scrollIntoView: true }); view.focus(); };
    const dom = codeElement(this.code, this.info, this.path, () => view.requestMeasure(), edit);
    dom.classList.add('live-block'); dom.addEventListener('mousedown', event => { if ((event.target as HTMLElement).closest('button, a')) return; event.preventDefault(); edit(); });
    return dom;
  }
  ignoreEvent() { return true; }
}
class InlineWidget extends WidgetType {
  constructor(public value: string, public kind: 'math' | 'footnote', public target?: number) { super(); }
  eq(other: InlineWidget) { return this.value === other.value && this.kind === other.kind && this.target === other.target; }
  toDOM(view: EditorView) { const dom = document.createElement(this.kind === 'footnote' ? 'sup' : 'span'); dom.className = `inline-${this.kind}`; if (this.kind === 'math') renderMath(this.value, dom, { throwOnError: false, trust: false }); else { dom.textContent = `[${this.value}]`; dom.addEventListener('mousedown', event => { if (this.target !== undefined) { event.preventDefault(); view.dispatch({ selection: { anchor: this.target }, effects: EditorView.scrollIntoView(this.target, { y: 'center' }) }); view.focus(); } }); } return dom; }
  ignoreEvent() { return this.kind === 'footnote'; }
}
class TocWidget extends WidgetType {
  constructor(public headings: { text: string; from: number; depth: number }[]) { super(); }
  eq(other: TocWidget) { return JSON.stringify(this.headings) === JSON.stringify(other.headings); }
  toDOM(view: EditorView) { const dom = document.createElement('nav'); dom.className = 'markdown-toc live-block'; dom.setAttribute('aria-label', '文档目录'); const title = document.createElement('strong'); title.textContent = '目录'; dom.append(title); for (const heading of this.headings) { const button = document.createElement('button'); button.textContent = heading.text; button.style.paddingLeft = `${(heading.depth - 1) * 14}px`; button.addEventListener('mousedown', event => { event.preventDefault(); view.dispatch({ selection: { anchor: heading.from }, effects: EditorView.scrollIntoView(heading.from, { y: 'start' }) }); view.focus(); }); dom.append(button); } return dom; }
  ignoreEvent() { return true; }
}
class MarkdownWidget extends WidgetType {
  constructor(public source: string, public path: string, public from: number,public references:ReferenceView) { super(); }
  eq(other: MarkdownWidget) { return this.source === other.source && this.path === other.path && this.from === other.from && this.references.requirements===other.references.requirements; }
  toDOM(view: EditorView) {
    const display = this.source.replace(/^\[\^([^\]]+)\]:\s*/, '**[$1]** ');
    const dom = markdownElement(display, this.path,this.references); dom.classList.add('live-block'); dom.title = '点击编辑 Markdown';
    for (const image of dom.querySelectorAll('img')) { image.addEventListener('load', () => view.requestMeasure()); image.addEventListener('error', () => view.requestMeasure()); }
    const tasks: number[] = [];
    const findTasks = (node: any) => { if (node.type === 'listItem' && node.checked !== null && node.checked !== undefined) { const start = node.position.start.offset; const match = /^(?:[-+*]|\d+[.)])\s+\[([ xX])\]/.exec(this.source.slice(start)); if (match) tasks.push(start + match[0].lastIndexOf('[') + 1); } for (const child of node.children ?? []) findTasks(child); };
    findTasks(markdownTree(this.source));
    [...dom.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].forEach((input, index) => { if (tasks[index] === undefined) return; input.disabled = false; input.setAttribute('aria-label', `切换任务 ${index + 1}`); input.addEventListener('mousedown', event => event.stopPropagation()); input.addEventListener('change', () => { view.dispatch({ changes: { from: this.from + tasks[index], to: this.from + tasks[index] + 1, insert: input.checked ? 'x' : ' ' }, userEvent: 'input' }); }); });
    dom.addEventListener('mousedown', event => { if ((event.target as HTMLElement).closest('a, input')) return; event.preventDefault(); view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true }); view.focus(); });
    return dom;
  }
  ignoreEvent() { return true; }
}

function livePreview(path: string,references:()=>ReferenceView,documentField:StateField<ParsedDocument>): Extension {
  const build = (state: EditorState): DecorationSet => {
    const source = state.doc.toString(), parsed = state.field(documentField), decorations: any[] = [];
    const selection = state.selection.main,referenceOptions=references();
    const touches = (from: number, to: number) => selection.from <= to && selection.to >= from;
    const covered: { from: number; to: number }[] = [];
    const replace = (from: number, to: number, widget?: WidgetType) => { if (to > from) { decorations.push(Decoration.replace({ block: true, widget }).range(from, to)); covered.push({ from, to }); } };
    if (parsed.frontmatter) replace(0, parsed.frontmatter.to);
    for (const req of parsed.requirements) {
      const body=bodyRange(source,req);
      replace(req.from,req.bodyFrom);
      replace(req.bodyTo,req.to);
      decorations.push(Decoration.widget({widget:new RequirementTip(req,body.from),block:true,side:-1}).range(body.from));
    }
    for(const reference of parsed.references)if(!touches(reference.from,reference.to)&&!parsed.blocks.some(block=>['table','list','blockquote','footnoteDefinition'].includes(block.type)&&reference.from>=block.from&&reference.to<=block.to))decorations.push(Decoration.replace({widget:new ReferenceWidget(reference,referenceOptions)}).range(reference.from,reference.to));
    const footnotes = new Map<string, number>();
    for (const node of markdownTree(source).children ?? []) if (node.type === 'footnoteDefinition') footnotes.set((node as any).identifier, node.position?.start.offset ?? 0);
    const walk = (node: any) => {
      const from = node.position?.start.offset ?? 0, to = node.position?.end.offset ?? from;
      // An unfinished code fence can span hidden req markers. Keep its source editable;
      // never replace that entire span with a preview that would expose metadata.
      if (node.type!=='root'&&covered.some(range => from < range.to && to > range.from)) return;
      const active = touches(state.doc.lineAt(from).from, state.doc.lineAt(Math.min(to, source.length)).to);
      if (node.type === 'code' && !touches(from, to)) { const firstLine = source.slice(from, to).split('\n')[0]; replace(from, to, new CodeBlockWidget(node.value ?? '', [node.lang, node.meta].filter(Boolean).join(' '), from, Math.min(to, from + firstLine.length + 1), path)); return; }
      if (node.type === 'paragraph' && /^\[(?:TOC|toc)\]$/.test(source.slice(from, to).trim()) && !touches(from, to)) { replace(from, to, new TocWidget(parsed.headings)); return; }
      if ((['table', 'list', 'blockquote', 'math', 'footnoteDefinition'].includes(node.type) || (node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'image')) && !touches(from, to)) { replace(from, to, new MarkdownWidget(source.slice(from, to), path, from,referenceOptions)); return; }
      if (node.type === 'inlineMath' && !touches(from, to)) { decorations.push(Decoration.replace({ widget: new InlineWidget(node.value, 'math') }).range(from, to)); return; }
      if (node.type === 'footnoteReference' && !touches(from, to)) { decorations.push(Decoration.replace({ widget: new InlineWidget(node.label ?? node.identifier, 'footnote', footnotes.get(node.identifier)) }).range(from, to)); return; }
      if (node.type === 'heading') {
        decorations.push(Decoration.line({ class: `live-heading heading-${node.depth}` }).range(state.doc.lineAt(from).from));
        const marker = /^#{1,6}\s+/.exec(source.slice(from, to));
        if (marker && !active) decorations.push(Decoration.replace({}).range(from, from + marker[0].length));
      }
      const styles: Record<string, [string, number]> = { strong: ['live-strong', 2], emphasis: ['live-emphasis', 1], delete: ['live-strike', 2], inlineCode: ['live-code', 1] };
      if (styles[node.type] && to > from) {
        const [className, defaultWidth] = styles[node.type];
        const width = node.type === 'inlineCode' ? /^`+/.exec(source.slice(from))?.[0].length ?? 1 : node.type === 'delete' && source[from + 1] !== '~' ? 1 : defaultWidth;
        decorations.push(Decoration.mark({ class: className }).range(from, to));
        if (!active && to - from > width * 2) { decorations.push(Decoration.replace({}).range(from, from + width), Decoration.replace({}).range(to - width, to)); }
      }
      if (node.type === 'link' && node.children?.length && !active) {
        const start = node.children[0].position.start.offset, end = node.children.at(-1).position.end.offset;
        if (start > from && end < to) { decorations.push(Decoration.replace({}).range(from, start), Decoration.replace({}).range(end, to), Decoration.mark({ class: 'live-link', attributes: { title: node.url } }).range(start, end)); }
      }
      if (node.type === 'code') {
        for (let line = state.doc.lineAt(from).number; line <= state.doc.lineAt(to).number; line++) decorations.push(Decoration.line({ class: 'live-code-line' }).range(state.doc.line(line).from));
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(markdownTree(source));
    return Decoration.set(decorations, true);
  };
  const wrappers=(state:EditorState)=>BlockWrapper.set(state.field(documentField).requirements.map(req=>{const body=bodyRange(state.doc.toString(),req);return BlockWrapper.create({tagName:'div',attributes:{class:'requirement-region','data-requirement':req.meta.id}}).range(body.from,Math.max(body.to,Math.min(body.from+1,state.doc.length)));}),true);
  return [StateField.define<DecorationSet>({ create: build, update(value, transaction) { return transaction.docChanged || transaction.selection ? build(transaction.state) : value; }, provide: field => EditorView.decorations.from(field) }),
   StateField.define({create:wrappers,update(value,tr){return tr.docChanged?wrappers(tr.state):value;},provide:field=>EditorView.blockWrappers.from(field)})];
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), latest = useRef(props), raw = useRef(props.source), applying = useRef(false);
  const mode = useRef(new Compartment()), spelling = useRef(new Compartment()), editing = useRef(new Compartment());
  latest.current = props;
  const documentField=useRef(requirementDocument(()=>latest.current.path,()=>latest.current.sourceMode));
  const referenceView=():ReferenceView=>({enabled:moduleVersion(latest.current.source)===2,requirements:latest.current.requirements,navigate:target=>latest.current.onReference(target)});
  const modeExtension = (sourceMode: boolean) => sourceMode ? [lineNumbers(), EditorView.editorAttributes.of({ class: 'source-editor' })] : [livePreview(latest.current.path,referenceView,documentField.current),protectRequirementBoundaries(latest.current.path,()=>latest.current.onNotice('需求边界已保护；请使用条目操作，或切换源码模式修改标签。'),documentField.current),requirementMouseSelection(documentField.current), EditorView.editorAttributes.of({ class: 'live-editor' })];
  function completion(context:CompletionContext){
   const source=context.state.doc.toString(),match=/\[\[\[((?:\\[^\r\n]|[^\]\\\r\n])*)$/.exec(source.slice(0,context.pos));if(!match||referenceEscaped(source,context.pos-match[0].length)||!canInsertReference(latest.current.path,source,context.pos))return null;
   const start=context.pos-match[0].length,colon=match[1].lastIndexOf(':'),label=colon>=0?match[1].slice(0,colon):undefined,query=(colon>=0?match[1].slice(colon+1):match[1]).toLowerCase();
   if(label&&label.replace(/\\([\\\[\]:])/g,'$1').length>256)return null;
   return {from:start,to:context.pos,filter:false,options:latest.current.requirements.filter(req=>`${req.meta.key??''} ${req.title} req-${req.meta.id}`.toLowerCase().includes(query)).map(req=>({label:`${req.meta.key??''} · ${req.title}`,detail:req.path,type:'reference',apply:(editor:EditorView,_completion:unknown,from:number,to:number)=>{const current=editor.state.doc.toString(),end=current.startsWith(']]]',to)?to+3:to,typed=current.slice(from+3,to),colon=typed.lastIndexOf(':'),label=colon>=0?typed.slice(0,colon).replace(/\\([\\\[\]:])/g,'$1'):undefined;if(label&&label.length>256)return;const text=formatReference(req.meta.id,label?.trim()?label:req.title.slice(0,256));editor.dispatch({changes:{from,to:end,insert:text},selection:{anchor:from+text.length},userEvent:'input.complete'});}}))};
  }
  useImperativeHandle(ref, () => ({ selection: () => { const sel = view.current?.state.selection.main; return { from: rawOffset(raw.current, sel?.from ?? 0), to: rawOffset(raw.current, sel?.to ?? 0) }; }, jump(from) { const pos = normalizedOffset(raw.current, from); view.current?.dispatch({ selection: EditorSelection.cursor(Math.min(pos, view.current.state.doc.length)), effects: EditorView.scrollIntoView(pos, { y: 'center' }) }); view.current?.focus(); }, undo() { if (view.current) undo(view.current); }, redo() { if (view.current) redo(view.current); },insertReference(){const editor=view.current;if(!editor||latest.current.readOnly)return;const selection=editor.state.selection.main,source=editor.state.doc.toString();if(!canInsertReference(latest.current.path,source,selection.from,selection.to)){latest.current.onNotice('请在 Markdown v2 的正文中插入引用；旧模块可在项目设置的数据格式与迁移中升级。');return;}const label=source.slice(selection.from,selection.to);if(/[\r\n]/.test(label)||label.length>256){latest.current.onNotice('引用显示文字应为不超过 256 字符的单行文本；当前选区未修改。');return;}const insert='[[['+(label?label.replace(/[\\\[\]:]/g,'\\$&')+':':'');editor.dispatch({changes:{from:selection.from,to:selection.to,insert},selection:{anchor:selection.from+insert.length},userEvent:'input'});editor.focus();startCompletion(editor);} }));
  useLayoutEffect(() => {
    const props = latest.current;
    raw.current = props.source;
    const cached = sessions.get(props.sessionKey);
    let state: EditorState;
    const extensions: Extension[] = [
      // Preserve known boundaries while a temporarily unfinished fence hides them from the AST.
      documentField.current.init(state=>cached&&cached.epoch===props.epoch?cached.document:parseDocumentSource(props.path,state.doc.toString())),
      markdown({ base: markdownLanguage, codeLanguages: languages }), history(), bracketMatching(), syntaxHighlighting(defaultHighlightStyle), highlightSelectionMatches(), EditorView.lineWrapping,
      autocompletion({override:[completion],interactionDelay:0}),keymap.of([...completionKeymap,...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]), placeholder('开始书写需求，或选中内容后转换为需求条目…'),
      mode.current.of(modeExtension(props.sourceMode)), spelling.current.of(EditorView.contentAttributes.of({ spellcheck: String(props.spellcheck) })), editing.current.of([EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly)]),
      EditorView.updateListener.of(update => {
        if (applying.current) return;
        if (update.docChanged) {
          const old = raw.current, patches: { from: number; to: number; text: string }[] = [], eol = lineEnding(old);
          update.changes.iterChanges((from, to, _fromB, _toB, insert) => patches.push({ from: rawOffset(old, from), to: rawOffset(old, to), text: insert.toString().replace(/\n/g, eol) }));
          let source = old;
          for (const patch of patches.reverse()) source = source.slice(0, patch.from) + patch.text + source.slice(patch.to);
          raw.current = source; latest.current.onChange(source);
        }
        if (update.selectionSet || update.docChanged) { const sel = update.state.selection.main; latest.current.onSelection(rawOffset(raw.current, sel.from), rawOffset(raw.current, sel.to)); }
      }),
      EditorView.theme({ '&': { height: '100%', fontSize: '15px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' }, '.cm-content': { padding: '28px 0 160px', minHeight: '100%' }, '.cm-line': { padding: '0 0', lineHeight: '1.9' }, '.cm-cursor': { borderLeftColor: '#168572' }, '.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: '#cce8de !important' }, '.cm-gutters': { backgroundColor: '#fafafa', color: '#a1aaa7', border: 'none' } }),
    ];
    if (cached && cached.epoch === props.epoch) {
      // The outgoing transaction filters refer to the previous component's fields.
      // This controlled reconfiguration replaces those fields and must not run them.
      state = cached.state.update({ effects: StateEffect.reconfigure.of(extensions),filter:false }).state;
      const before = state.doc.toString(), after = normalize(props.source);
      if (before !== after) state = state.update({ changes: minimalChange(before, after), userEvent: 'input', annotations: [isolateHistory.of('full'),structuralEdit.of(true)] }).state;
      state = state.update({ effects: mode.current.reconfigure(modeExtension(props.sourceMode)) }).state;
    } else {
      const base = normalize(props.baseSource || props.source);
      const fm = parseDocumentSource(props.path, base).frontmatter;
      state = EditorState.create({ doc: base, selection: { anchor: Math.min(fm?.to ?? 0, base.length) }, extensions });
      if (base !== normalize(props.source)) state = state.update({ changes: minimalChange(base, normalize(props.source)),annotations:structuralEdit.of(true) }).state;
    }
    const editor = new EditorView({ state, parent: host.current! }); view.current = editor;
    return () => { sessions.set(props.sessionKey, { state: editor.state, document:editor.state.field(documentField.current),raw: raw.current, epoch: props.epoch }); editor.destroy(); view.current = null; if (sessions.size > 50) sessions.delete(sessions.keys().next().value!); };
  }, [props.sessionKey, props.epoch]);
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const before = editor.state.doc.toString(), after = normalize(props.source);
    raw.current = props.source;
    if (before !== after) { applying.current = true; editor.dispatch({ changes: minimalChange(before, after), userEvent: 'input', annotations: [isolateHistory.of('full'),structuralEdit.of(true)] }); applying.current = false; }
  }, [props.source]);
  const inventory=props.requirements.map(req=>`${req.meta.id}:${req.meta.key}:${req.title}:${req.path}`).join('|');
  useLayoutEffect(() => { const editor=view.current;if(!editor)return;const pos=props.sourceMode?editor.state.selection.main.head:editablePosition(editor.state.doc.toString(),editor.state.selection.main.head,editor.state.field(documentField.current));editor.dispatch({ effects: mode.current.reconfigure(modeExtension(props.sourceMode)),selection:pos===editor.state.selection.main.head?undefined:EditorSelection.cursor(pos) }); }, [props.sourceMode,inventory]);
  useEffect(() => { view.current?.dispatch({ effects: spelling.current.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(props.spellcheck) })) }); }, [props.spellcheck]);
  useEffect(() => { view.current?.dispatch({ effects: editing.current.reconfigure([EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly)]) }); }, [props.readOnly]);
  return <div className="editor-host" ref={host} data-testid="markdown-editor" />;
});
