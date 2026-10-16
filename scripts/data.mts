import { Workspace } from '../src/main/workspace';
import { applyMigrations, migrationBackups, previewMigrations, restoreMigration } from '../src/main/migrations';
const [action = 'check', root = '.', id] = process.argv.slice(2);
try {
  const workspace = await Workspace.open(root, { recover: false });
  if (action === 'backups') console.log(JSON.stringify(await migrationBackups(workspace), null, 2));
  else if (action === 'restore') { if (!id) throw new Error('请提供备份 ID'); await restoreMigration(workspace, id); console.log('已恢复迁移前文件'); }
  else if (action === 'check' || action === 'upgrade') {
    const preview = await previewMigrations(workspace);
    console.log(JSON.stringify({ root: workspace.root, versions: preview.currentVersions, entries: preview.entries.map(({ before, after, ...entry }) => entry) }, null, 2));
    if (action === 'upgrade') { const result = await applyMigrations(workspace, preview.token); console.log(JSON.stringify({ upgraded: Boolean(result.backupId), backupId: result.backupId })); }
    else if (preview.entries.some(entry => entry.status === 'blocked')) process.exitCode = 2;
  } else throw new Error('用法：npm run data -- check|upgrade|backups|restore <项目目录> [备份 ID]');
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
