import { spawnSync } from 'node:child_process';
import { electronEnvironment } from './electron-environment.mjs';
const result = spawnSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit', env: electronEnvironment() });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
