import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { accessSync } from 'node:fs';
const root=path.resolve(process.argv[2]??'release/ci');
const folder=path.join(root,`ReqType-${process.platform}-${process.arch}`);
const executable=process.platform==='darwin'?path.join(folder,'ReqType.app/Contents/MacOS/ReqType'):path.join(folder,'ReqType.exe');
accessSync(executable);
const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--output=test-results/packaged'],{stdio:'inherit',env:{...process.env,REQTYPE_E2E_EXECUTABLE:executable}});
if(result.error)throw result.error;process.exit(result.status??1);
