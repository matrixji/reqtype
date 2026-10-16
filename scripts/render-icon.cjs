const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

app.whenReady().then(async () => {
  const svg = await fs.readFile(path.resolve('build/icon.svg'), 'utf8');
  const window = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, transparent: true, webPreferences: { sandbox: true } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html style="background:transparent"><body style="margin:0">${svg}</body></html>`));
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = (await window.webContents.capturePage()).resize({ width: 1024, height: 1024 });
  await fs.writeFile('build/icon.png', image.toPNG());
  const iconset = path.resolve('build/icon.iconset');
  await fs.mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) await fs.writeFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), image.resize({ width: size * scale, height: size * scale }).toPNG());
  const sizes = [16, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const images = []; let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const png = image.resize({ width: size, height: size }).toPNG(), start = 6 + index * 16;
    header[start] = header[start + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6); header.writeUInt32LE(png.length, start + 8); header.writeUInt32LE(offset, start + 12);
    images.push(png); offset += png.length;
  }
  await fs.writeFile('build/icon.ico', Buffer.concat([header, ...images]));
  if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.resolve('build/icon.icns')]);
  await fs.rm(iconset, { recursive: true, force: true });
  console.log('Generated application icons from build/icon.svg');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
