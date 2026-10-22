import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import { render as renderMath } from 'katex';
import rehypeStringify from 'rehype-stringify';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { remarkReferences, type ReferenceView } from './reference-view';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype).use(rehypeStringify);
const diagrams = new Map<string, Promise<string>>();
let mermaid: Promise<typeof import('mermaid')['default']> | undefined;

export function sanitizedContent(html: string, documentPath: string, plugin = false, diagram = false) {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: [...diagram ? [] : ['style'], 'iframe', 'form', 'script', 'object', 'embed', 'foreignObject'], ...(plugin ? { FORBID_ATTR: ['style'] } : {}) });
  for (const input of fragment.querySelectorAll('input')) { if (input.type !== 'checkbox') input.remove(); else input.disabled = true; }
  for (const image of fragment.querySelectorAll('img, image')) {
    const src = image.getAttribute('src') ?? image.getAttribute('href') ?? image.getAttribute('xlink:href');
    if (src && /^(https?:|\/\/)/i.test(src)) { const placeholder = document.createElement('span'); placeholder.className = 'offline-resource'; placeholder.textContent = `网络图片未加载，请保存为本地附件：${src}`; image.replaceWith(placeholder); }
    else if (src && image.tagName.toLowerCase() === 'img') { image.setAttribute('src', window.reqtype.assetUrl(src, documentPath)); image.setAttribute('loading', 'lazy'); }
  }
  for (const link of fragment.querySelectorAll('a')) if (!link.getAttribute('href')?.startsWith('#')) { link.target = '_blank'; link.rel = 'noreferrer'; }
  return fragment;
}
export function markdownElement(source: string, documentPath: string, references?:ReferenceView) {
  const container = document.createElement('div'); container.className = 'markdown-render';
  const renderer=references?.enabled?unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(()=>remarkReferences(source,references)).use(remarkRehype).use(rehypeStringify):processor;
  container.append(sanitizedContent(String(renderer.processSync(source)), documentPath));
  for(const link of container.querySelectorAll<HTMLAnchorElement>('a[data-req-target]'))link.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();references?.navigate(link.dataset.reqTarget!);});
  for (const code of container.querySelectorAll('code.language-math')) { const math = document.createElement('span'), block = code.parentElement?.tagName === 'PRE'; renderMath(code.textContent ?? '', math, { displayMode: block, throwOnError: false, trust: false }); (block ? code.parentElement! : code).replaceWith(math); }
  for (const quote of container.querySelectorAll('blockquote')) {
    const first = quote.querySelector('p'); const match = first?.textContent?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
    if (match && first) { quote.classList.add('markdown-alert', `alert-${match[1].toLowerCase()}`); first.innerHTML = first.innerHTML.replace(/^\[![A-Z]+\]\s*/i, ''); const title = document.createElement('strong'); title.className = 'alert-title'; title.textContent = ({ NOTE: '说明', TIP: '提示', IMPORTANT: '重要', WARNING: '警告', CAUTION: '注意' } as Record<string,string>)[match[1].toUpperCase()]; quote.prepend(title); }
  }
  return container;
}
export function codeElement(code: string, info: string, documentPath: string, changed: () => void, edit: () => void) {
  const language = info.split(/\s/)[0].toLowerCase();
  const title = /\btitle=["']([^"']+)["']/.exec(info)?.[1];
  const container = document.createElement('div'); container.className = 'markdown-render code-block'; container.dataset.language = language || 'text';
  const toolbar = document.createElement('div'); toolbar.className = 'code-toolbar';
  const name = document.createElement('span'); name.textContent = title ? `${title} · ${language || 'text'}` : language || 'text'; toolbar.append(name);
  const button = (text: string, callback: () => void) => { const dom = document.createElement('button'); dom.type = 'button'; dom.textContent = text; dom.setAttribute('aria-label', `${text}代码块`); dom.addEventListener('mousedown', event => event.stopPropagation()); dom.addEventListener('click', event => { event.stopPropagation(); callback(); }); toolbar.append(dom); return dom; };
  button('编辑', edit); const copy = button('复制', () => { void navigator.clipboard.writeText(code).then(() => { copy.textContent = '已复制'; }).catch(() => { copy.textContent = '复制失败'; }); }); container.append(toolbar);
  const body = document.createElement('div'); body.className = 'code-preview'; container.append(body);
  const pre = document.createElement('pre'), element = document.createElement('code');
  const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '';
  if (highlighted) element.innerHTML = highlighted; else element.textContent = code;
  const gutter = document.createElement('span'); gutter.className = 'code-gutter'; gutter.setAttribute('aria-hidden', 'true'); gutter.textContent = code.split('\n').map((_, index) => index + 1).join('\n');
  element.className = 'hljs'; pre.className = 'numbered-code'; pre.append(gutter, element); body.append(pre);
  if (language === 'math') { body.replaceChildren(markdownElement(`$$\n${code}\n$$`, documentPath)); return container; }
  if (['plantuml', 'puml'].includes(language)) {
    const loading = document.createElement('p'); loading.className = 'render-status'; loading.textContent = '正在绘制 PlantUML…'; body.prepend(loading);
    void window.reqtype.renderPlantuml(code, documentPath).then(svg => { if (!container.isConnected) return; body.replaceChildren(sanitizedContent(svg, documentPath, false, true)); body.classList.add('diagram-preview'); changed(); }).catch(error => { if (!container.isConnected) return; loading.textContent = (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''); changed(); });
  } else if (language === 'mermaid') {
    const render = diagrams.get(code) ?? (async () => {
      mermaid ??= import('mermaid').then(({ default: engine }) => { engine.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true, fontFamily: 'system-ui, sans-serif', flowchart: { htmlLabels: false } }); return engine; });
      return (await (await mermaid).render(`diagram_${crypto.randomUUID().replaceAll('-', '_')}`, code)).svg;
    })();
    diagrams.set(code, render); if (diagrams.size > 80) diagrams.delete(diagrams.keys().next().value!);
    const loading = document.createElement('p'); loading.className = 'render-status'; loading.textContent = '正在本地绘图…'; body.prepend(loading);
    void render.then(svg => { if (!container.isConnected) return; body.replaceChildren(sanitizedContent(svg, documentPath, false, true)); body.classList.add('diagram-preview'); changed(); }).catch(error => { if (!container.isConnected) return; loading.textContent = `图形语法错误：${(error as Error).message}`; changed(); });
  } else if (!hljs.getLanguage(language) && language && !['text', 'plaintext', 'txt'].includes(language)) {
    void window.reqtype.renderCodeBlock(language, code, documentPath).then(result => { if (!container.isConnected || !result?.html) return; body.replaceChildren(sanitizedContent(result.html, documentPath, true)); body.classList.add('plugin-preview'); changed(); }).catch(error => { if (!container.isConnected) return; const message = document.createElement('p'); message.className = 'render-status'; message.textContent = `本地渲染器：${(error as Error).message}`; body.prepend(message); changed(); });
  }
  return container;
}
