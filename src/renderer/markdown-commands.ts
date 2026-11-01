import { parseDocumentSource } from '../core/markdown';
import type { ParsedDocument } from '../shared/types';
import { protectedRanges } from './editor-protection';

export type MarkdownCommand = 'bold' | 'italic' | 'strike' | 'inlineCode' | 'heading' | 'bullet' | 'ordered' | 'task' | 'quote' | 'link' | 'image' | 'table' | 'rule' | 'code' | 'mermaid' | 'plantuml' | 'math' | 'inlineMath' | 'footnote' | 'alert' | 'toc';
export interface CommandOptions { value?: string; label?: string }
export interface MarkdownEdit { from: number; to: number; insert: string; anchor: number; head: number }

/** Produces one local edit in CodeMirror's LF coordinate space. */
export function markdownEdit(source: string, from: number, to: number, command: MarkdownCommand, options: CommandOptions = {}): MarkdownEdit {
  let selected = source.slice(from, to), insert = '', start = 0, end = 0;
  const wrap = (left: string, right = left, placeholder = '文字') => {
    if (selected.startsWith(left) && selected.endsWith(right) && selected.length >= left.length + right.length) { insert = selected.slice(left.length, -right.length); end = insert.length; }
    else if (source.slice(Math.max(0, from - left.length), from) === left && source.slice(to, to + right.length) === right) { from -= left.length; to += right.length; insert = selected; end = selected.length; }
    else { selected ||= placeholder; insert = left + selected + right; start = left.length; end = start + selected.length; }
  };
  const block = (text: string, selectText?: string) => {
    const prefix = from > 0 && source[from - 1] !== '\n' ? '\n\n' : from > 1 && source[from - 2] !== '\n' ? '\n' : '';
    const suffix = to < source.length && source[to] !== '\n' ? '\n\n' : to < source.length - 1 && source[to + 1] !== '\n' ? '\n' : '';
    insert = prefix + text + suffix; start = prefix.length + (selectText ? text.indexOf(selectText) : 0); end = start + (selectText?.length ?? text.length);
  };
  if (['heading', 'bullet', 'ordered', 'task', 'quote'].includes(command)) {
    from = source.lastIndexOf('\n', from - 1) + 1;
    const last = to > from && source[to - 1] === '\n' ? to - 1 : to;
    to = source.indexOf('\n', last); if (to < 0) to = source.length;
    const lines = source.slice(from, to).split('\n');
    const prefix = command === 'heading' ? '#'.repeat(Math.max(1, Math.min(6, Number(options.value) || 1))) + ' ' : command === 'bullet' ? '- ' : command === 'task' ? '- [ ] ' : command === 'quote' ? '> ' : '1. ';
    const pattern = command === 'heading' ? /^#{1,6}\s+/ : command === 'ordered' ? /^\d+\.\s+/ : command === 'task' ? /^[-*+] \[[ xX]\] / : command === 'bullet' ? /^[-*+] (?!\[[ xX]\] )/ : /^> /;
    const parts = lines.map(line => ({ indent: /^ */.exec(line)![0], text: line.replace(/^ */, '') }));
    const remove = parts.filter(part => part.text).every(({ text }) => command === 'heading' ? text.startsWith(prefix) : pattern.test(text)) && parts.some(part => part.text);
    const previous = ['bullet', 'ordered', 'task'].includes(command) ? /^(?:[-*+](?: \[[ xX]\])?|\d+\.)\s+/ : pattern;
    let ordinal = 0;
    insert = parts.map(({ indent, text }) => {
      if (!text && lines.length > 1) return indent;
      return indent + (remove ? text.replace(pattern, '') : (command === 'ordered' ? `${++ordinal}. ` : prefix) + text.replace(previous, ''));
    }).join('\n'); end = insert.length;
  } else switch (command) {
    case 'bold': wrap('**'); break;
    case 'italic': wrap('*'); break;
    case 'strike': wrap('~~'); break;
    case 'inlineMath': wrap('$', '$', 'x^2'); break;
    case 'inlineCode': { const existing = /^(`+)([\s\S]*?)\1$/.exec(selected); if (existing) { insert = existing[2]; end = insert.length; break; } const fence = '`'.repeat(Math.max(0, ...Array.from(selected.matchAll(/`+/g), m => m[0].length)) + 1); wrap(fence, fence, 'code'); break; }
    case 'link': case 'image': {
      const label = (options.label ?? selected) || (command === 'image' ? '图片说明' : '链接文字');
      const url = (options.value || (command === 'image' ? '../assets/image.png' : 'https://example.com')).replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29').replace(/[\r\n]/g, '');
      const text = `${command === 'image' ? '!' : ''}[${label.replace(/[\\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ')}](${url})`;
      if (command === 'image') block(text); else { insert = text; end = text.length; } break;
    }
    case 'code': case 'mermaid': case 'plantuml': {
      const language = command === 'code' ? (options.value ?? 'text').replace(/[^\w+-]/g, '') : command;
      const code = selected || (command === 'mermaid' ? 'flowchart LR\n  A[开始] --> B[完成]' : command === 'plantuml' ? '@startuml\nAlice -> Bob: Hello\n@enduml' : '代码');
      const fence = '`'.repeat(Math.max(2, ...Array.from(code.matchAll(/`+/g), m => m[0].length)) + 1);
      block(`${fence}${language}\n${code}\n${fence}`, code); break;
    }
    case 'table': block('| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |', '列一'); break;
    case 'rule': block('---'); break;
    case 'toc': block('[TOC]'); break;
    case 'math': block(`$$\n${selected || 'x^2 + y^2 = z^2'}\n$$`, selected || 'x^2 + y^2 = z^2'); break;
    case 'alert': block(`> [!NOTE]\n> ${selected.replaceAll('\n', '\n> ') || '说明内容'}`); break;
    case 'footnote': {
      let n = 1; while (source.includes(`[^note${n}]`)) n++;
      insert = `${selected}[^note${n}]\n\n[^note${n}]: 脚注内容\n`; start = insert.indexOf('脚注内容'); end = start + 4; break;
    }
  }
  return { from, to, insert, anchor: from + start, head: from + end };
}

export function assertMarkdownEdit(source: string, path: string, edit: MarkdownEdit, doc: ParsedDocument = parseDocumentSource(path, source)) {
  if (doc.readOnly || protectedRanges(source, path, doc).some(r => edit.from === edit.to ? (edit.from > r.from || r.blockStart && edit.from === r.from) && (edit.from < r.to || r.blockEnd && edit.from === r.to) : edit.from < r.to && edit.to > r.from)) throw new Error('请在正文内操作，选区不能包含元数据或跨越需求边界。');
  const next = parseDocumentSource(path, source.slice(0, edit.from) + edit.insert + source.slice(edit.to));
  if (doc.requirements.some(req => !next.requirements.some(item => item.meta.id === req.meta.id))) throw new Error('此操作会破坏需求边界，请先修复代码围栏或调整选区。');
}
