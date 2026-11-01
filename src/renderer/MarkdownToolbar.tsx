import { useState } from 'react';
import type { MarkdownCommand, CommandOptions } from './markdown-commands';

export function MarkdownToolbar({ disabled, execute }: { disabled?: boolean; execute(command: MarkdownCommand, options?: CommandOptions): void }) {
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null), [url, setUrl] = useState(''), [label, setLabel] = useState('');
  const button = (name: string, command: MarkdownCommand, face = name) => <button type="button" disabled={disabled} title={name} aria-label={name} onMouseDown={e => e.preventDefault()} onClick={() => execute(command)}>{face}</button>;
  const menu = (name: string, choices: [string, MarkdownCommand, string?][]) => <select aria-label={name} title={name} disabled={disabled} value="" onChange={e => { const choice = choices[Number(e.target.value)]; if (choice) execute(choice[1], { value: choice[2] }); }}><option value="" disabled>{name}</option>{choices.map(([title], i) => <option key={i} value={i}>{title}</option>)}</select>;
  return <><div className="markdown-toolbar" role="toolbar" aria-label="Markdown 工具栏">
    {menu('标题', Array.from({ length: 6 }, (_, i) => [`标题 ${i + 1}`, 'heading', String(i + 1)]))}
    {button('粗体', 'bold', 'B')}{button('斜体', 'italic', 'I')}{button('删除线', 'strike', 'S̶')}{button('行内代码', 'inlineCode', '<>')}
    {menu('列表', [['无序列表', 'bullet'], ['有序列表', 'ordered'], ['任务列表', 'task']])}{button('引用', 'quote')}
    {(['link', 'image'] as const).map(kind => <button key={kind} type="button" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => { setDialog(kind); setUrl(''); setLabel(''); }}>{kind === 'link' ? '链接' : '图片'}</button>)}
    {button('表格', 'table')}
    {menu('代码', [['普通代码', 'code', 'text'], ['JavaScript', 'code', 'javascript'], ['TypeScript', 'code', 'typescript'], ['Python', 'code', 'python'], ['JSON', 'code', 'json'], ['YAML', 'code', 'yaml'], ['Shell', 'code', 'bash'], ['SQL', 'code', 'sql'], ['Mermaid', 'mermaid'], ['PlantUML', 'plantuml']])}
    {menu('更多格式', [['分隔线', 'rule'], ['行内公式', 'inlineMath'], ['块公式', 'math'], ['脚注', 'footnote'], ['提示块', 'alert'], ['目录', 'toc']])}
  </div>{dialog && <div className="modal-backdrop" onKeyDown={e => { if (e.key === 'Escape') setDialog(null); }}><section className="modal" role="dialog" aria-modal="true" aria-label={dialog === 'image' ? '插入图片' : '插入链接'}><h2>{dialog === 'image' ? '插入图片' : '插入链接'}</h2><form onSubmit={e => { e.preventDefault(); execute(dialog, { value: url, label: label || undefined }); setDialog(null); }}><label className="field"><span>{dialog === 'image' ? '图片路径（相对当前文档）' : '链接地址'}</span><input autoFocus required value={url} onChange={e => setUrl(e.target.value)} placeholder={dialog === 'image' ? '../assets/image.png' : 'https://example.com'} /></label><label className="field"><span>{dialog === 'image' ? '替代文字' : '显示文字（留空使用选区）'}</span><input value={label} onChange={e => setLabel(e.target.value)} /></label><div className="modal-actions"><button type="button" className="button" onClick={() => setDialog(null)}>取消</button><button className="button button-primary" disabled={disabled}>插入</button></div></form></section></div>}</>;
}
