import { promises as fs } from 'node:fs';
import path from 'node:path';
export async function writeNotices() {
  const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
  const sections = [];
  for (const [directory, info] of Object.entries(lock.packages)) {
    if (!directory.startsWith('node_modules/') || info.dev) continue;
    let metadata; try { metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); } catch { continue; }
    const texts = [];
    for (const file of await fs.readdir(directory, { withFileTypes: true })) if (file.isFile() && /^(licen[sc]e|copying|notice)(\.|$)/i.test(file.name)) texts.push(await fs.readFile(path.join(directory, file.name), 'utf8'));
    sections.push(`${metadata.name} ${metadata.version}\nLicense: ${JSON.stringify(metadata.license ?? info.license ?? 'See package source')}\n${texts.join('\n')}`);
  }
  await fs.writeFile('dist/THIRD_PARTY_NOTICES.txt', sections.join('\n\n' + '='.repeat(72) + '\n\n'));
}
