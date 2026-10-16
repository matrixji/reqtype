import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { writeNotices } from './notices.mjs';

export async function buildMain() {
  await build({ entryPoints: ['src/main/main.ts', 'src/main/preload.ts', 'src/main/plugin-host.ts'], outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true });
}
if (process.argv[1]?.endsWith('build.mjs')) { await buildMain(); await viteBuild(); await writeNotices(); }
