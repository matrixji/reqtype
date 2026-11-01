import { BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safePath } from './workspace';

export async function exportImage(root: string, src: string, documentPath: string): Promise<string> {
  if (typeof src !== 'string' || typeof documentPath !== 'string' || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(src)) throw new Error('导出仅支持项目内本地图片');
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(documentPath), decodeURIComponent(src.split(/[?#]/)[0])));
  const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };
  const type = mime[path.extname(relative).toLowerCase()]; if (!type) throw new Error(`不支持的图片类型：${src}`);
  const file = await safePath(root, relative); if ((await fs.stat(file)).size > 32 * 1024 * 1024) throw new Error(`图片超过 32 MB：${src}`);
  return `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`;
}

/** No preload, no project bridge, no network, no visible/focused window. */
export async function printDocument(html: string): Promise<Buffer> {
  const window = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `export-${crypto.randomUUID()}` } });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([ (async () => {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">` + html)}`);
      await window.webContents.executeJavaScript(`(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); if (document.fonts.status !== 'loaded') throw new Error('字体加载失败'); })()`);
      return window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 15 / 25.4, bottom: 15 / 25.4, left: 15 / 25.4, right: 15 / 25.4 } });
    })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 导出超时')), 60000); }) ]);
  } finally { if (timer) clearTimeout(timer); window.destroy(); }
}
