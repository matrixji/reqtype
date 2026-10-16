import { packager } from '@electron/packager';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { electronEnvironment } from './electron-environment.mjs';

const require = createRequire(import.meta.url);
const normalized = electronEnvironment();
delete process.env.npm_config_electron_mirror;
delete process.env.NPM_CONFIG_ELECTRON_MIRROR;
Object.assign(process.env, normalized);
const platform = process.argv.find(arg => arg.startsWith('--platform='))?.slice(11) ?? process.platform;
const arch = process.argv.find(arg => arg.startsWith('--arch='))?.slice(7) ?? process.arch;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reqtype-package-'));
try {
  for (const folder of ['dist', 'dist-electron', 'plugins/quality']) await fs.cp(folder, path.join(temporary, folder), { recursive: true });
  const source = JSON.parse(await fs.readFile('package.json', 'utf8'));
  await fs.writeFile(path.join(temporary, 'package.json'), JSON.stringify({ name: source.name, version: source.version, description: source.description, main: source.main }));
  const icon = path.resolve(`build/icon.${platform === 'darwin' ? 'icns' : 'ico'}`);
  const output = await packager({ dir: temporary, name: 'ReqType', executableName: 'ReqType', appBundleId: 'dev.reqtype.desktop', appCategoryType: 'public.app-category.productivity', platform, arch, electronVersion: require('electron/package.json').version, out: path.resolve('release'), overwrite: true, asar: true, prune: false, extraResource: [path.resolve('resources/plantuml')], icon: await fs.access(icon).then(() => icon).catch(() => undefined), download: process.env.ELECTRON_MIRROR ? { mirrorOptions: { mirror: process.env.ELECTRON_MIRROR } } : undefined });
  console.log(output.join('\n'));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
