import hljs from 'highlight.js/lib/common';
import katexCss from 'katex/dist/katex.min.css?raw';
import highlightCss from 'highlight.js/styles/github.css?raw';
import { parseDocumentSource } from '../core/markdown';
import type { WorkspaceSnapshot } from '../shared/types';
import { markdownElement, renderMermaid, sanitizedContent } from './markdown-view';

const fonts = import.meta.glob('/node_modules/katex/dist/fonts/*.woff2', { eager: true, query: '?url&inline', import: 'default' }) as Record<string, string>;
const exportCss = `
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; } body { margin: 0 auto; padding: 32px; max-width: 960px; color: #24292f; background: white; font: 15px/1.7 system-ui, sans-serif; overflow-wrap: anywhere; }
p { margin: 0 0 12px; }
h1,h2,h3,h4,h5,h6 { line-height: 1.3; break-after: avoid; } a { color: #176d62; } img,svg { max-width: 100%; height: auto; } .diagram { text-align: center; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; } th,td { border: 1px solid #c9d1d9; padding: 6px 10px; } tr { break-inside: avoid; } thead { display: table-header-group; }
pre { padding: 12px; background: #f6f8fa; white-space: pre-wrap; overflow-wrap: anywhere; } code { font-family: ui-monospace, monospace; } blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #98b29b; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.markdown-alert { background: #f5f8f3; padding: 12px; } .alert-title { display: block; } .katex-display { overflow-wrap: normal; } .export-toc a { display: block; } .code-language { font-size: 12px; color: #57606a; }
@media print { body { padding: 0; max-width: none; } a { text-decoration: none; } pre { font-size: 11px; } }
`;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function renderExportDocument(snapshot: WorkspaceSnapshot, path: string): Promise<{ html: string; version: string }> {
  const file = snapshot.files.find(file => file.path === path); if (!file) throw new Error('当前文档不存在');
  const parsed = parseDocumentSource(path, file.content); if (parsed.readOnly) throw new Error('未来格式文档不能按当前语义导出');
  const source = parsed.frontmatter ? file.content.slice(0, parsed.frontmatter.to).replace(/[^\r\n]/g, ' ') + file.content.slice(parsed.frontmatter.to) : file.content;
  const requirements = snapshot.files.flatMap(file => parseDocumentSource(file.path, file.content).requirements);
  const root = markdownElement(source, path, { enabled: parsed.version === 2, requirements, navigate() {} }, new Map(parsed.requirements.map(req => [req.from, `req-${req.meta.id}`])));
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-req-target]')) {
    const req = requirements.find(req => req.meta.id.toLowerCase() === link.dataset.reqTarget?.toLowerCase());
    const targetText = req ? `${req.meta.key ?? ''} ${req.title}`.trim() : '';
    if (!req || req.path !== path) { const span = document.createElement('span'); span.textContent = req && link.textContent !== targetText ? `${link.textContent} (${targetText})` : link.textContent; link.replaceWith(span); }
  }
  const headings = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].filter(heading => !heading.closest('[data-footnotes]')); headings.forEach((heading, i) => { heading.id = `heading-${i + 1}`; });
  for (const p of root.querySelectorAll('p')) if (/^\[toc\]$/i.test(p.textContent?.trim() ?? '')) {
    const nav = document.createElement('nav'); nav.className = 'export-toc'; nav.setAttribute('aria-label', '目录');
    for (const heading of headings) { const a = document.createElement('a'); a.href = `#${heading.id}`; a.textContent = heading.textContent; a.style.marginLeft = `${(Number(heading.tagName[1]) - 1) * 16}px`; nav.append(a); } p.replaceWith(nav);
  }
  let index = 0;
  for (const element of root.querySelectorAll<HTMLElement>('pre > code')) {
    index++; const language = element.className.match(/language-([^\s]+)/)?.[1]?.toLowerCase() ?? 'text', code = element.textContent ?? '';
    if (['mermaid', 'plantuml', 'puml'].includes(language)) {
      try {
        const svg = language === 'mermaid' ? await renderMermaid(code, false) : await window.reqtype.renderPlantuml(code, path);
        const diagram = document.createElement('div'); diagram.className = 'diagram'; diagram.dataset.language = language; diagram.append(sanitizedContent(svg, path, false, true));
        if (!diagram.querySelector('svg')) throw new Error('未生成 SVG'); element.parentElement!.replaceWith(diagram);
      } catch (error) { throw new Error(`${path} 第 ${index} 个代码块（${language}）导出失败：${(error as Error).message}`); }
    } else if (hljs.getLanguage(language)) { element.innerHTML = hljs.highlight(code, { language, ignoreIllegals: true }).value; element.classList.add('hljs'); }
  }
  if (root.querySelector('.offline-resource')) throw new Error('文档包含网络图片，请先保存为本地附件再导出');
  for (const image of root.querySelectorAll('img, image')) {
    const attribute = image.hasAttribute('src') ? 'src' : image.hasAttribute('href') ? 'href' : 'xlink:href';
    let src = image.getAttribute(attribute) ?? '';
    if (src.startsWith('reqasset:')) src = new URL(src).searchParams.get('src') ?? '';
    if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon);base64,/i.test(src)) src = await window.reqtype.exportImage(src, path);
    image.setAttribute(attribute, src); image.removeAttribute('loading');
    // SVG <image> and ordinary Markdown images must both decode before export.
    await new Promise<void>((resolve, reject) => { const probe = new Image(); const timer = setTimeout(() => reject(new Error(`图片加载超时：${path}`)), 15000); probe.onload = () => { clearTimeout(timer); resolve(); }; probe.onerror = () => { clearTimeout(timer); reject(new Error(`图片无法解码：${path}`)); }; probe.src = src; });
  }
  // Embed only WOFF2; no URLs to the installed application may escape into the file.
  const mathCss = katexCss.replace(/src:[^;]+;/g, declaration => {
    const name = declaration.match(/fonts\/([^\s)"']+\.woff2)/)?.[1]; if (!name) return declaration;
    const data = fonts[`/node_modules/katex/dist/fonts/${name}`]; if (!data?.startsWith('data:')) throw new Error(`公式字体未内嵌：${name}`);
    return `src:url(${data}) format('woff2');`;
  });
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
  return { version: file.version, html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(parsed.title)}</title><style>${mathCss}\n${highlightCss}\n${exportCss}</style></head><body>${root.innerHTML}</body></html>` };
}
