import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { defaultConfig } from '../src/core/config';
import { ensureModule, indexWorkspace, makeRequirement, moveRequirement, parseDocumentSource, patchRequirement, wrapSelection } from '../src/core/markdown';
import { Workspace, applyTransaction, atomicWrite, digest, safePath } from '../src/main/workspace';
import { applyImport, decodeExchange, exportWorkspace, prepareImport } from '../src/main/exchange';

async function directory(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reqtype-core-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const meta = () => ({ id: randomUUID(), key: 'REQ-001', type: 'requirement', status: 'draft', priority: 'low' });
const moduleSource = (body: string) => ensureModule(body, '测试模块', randomUUID());

test('完整示例的条目、表格与关联可解析', async () => {
  const source = await fs.readFile('examples/local-save.md', 'utf8');
  const result = indexWorkspace([{ path: 'modules/local-save.md', content: source }], defaultConfig());
  assert.equal(result.requirements.length, 3);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.requirements.flatMap(x => x.meta.links ?? []).length, 2);
  assert.match(result.requirements[1].body, /\| 网络断开 \|/);
});

test('围栏、缩进代码和引用内的伪标记不会生成条目', () => {
  const block = makeRequirement('代码中的伪需求', meta());
  const source = moduleSource('```markdown\n' + block + '\n```\n\n' + block.split('\n').map(line => '    ' + line).join('\n') + '\n\n> <!-- req\n> id: nope\n> -->\n\n' + makeRequirement('真实需求', meta()));
  const result = parseDocumentSource('a.md', source);
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0].body, '真实需求');
  assert.deepEqual(result.diagnostics, []);
});

test('损坏、嵌套和冲突文本保留且产生诊断', () => {
  const block = makeRequirement('正文', meta());
  const nested = moduleSource(block.replace('正文', makeRequirement('嵌套正文', meta())));
  assert.equal(parseDocumentSource('a.md', nested).requirements.length, 0);
  assert.match(parseDocumentSource('a.md', nested).diagnostics.map(x => x.message).join(), /嵌套/);
  assert.match(parseDocumentSource('a.md', moduleSource(block.replace('<!-- /req -->', ''))).diagnostics[0].message, /缺少结束/);
  assert.ok(parseDocumentSource('a.md', moduleSource('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n')).diagnostics.some(x => x.message.includes('Git')));
});

test('单属性修改保留 BOM、CRLF、未知字段、注释和其余正文', () => {
  const id = randomUUID();
  const source = '\uFEFF' + moduleSource(`<!-- req\nid: "${id}"\nkey: 'REQ-001' # keep\npriority: low # priority comment\nx-custom: {value: 42}\n-->\n\n正文 **粗体** 😀\n\n<!-- /req -->\n`).replace(/\n/g, '\r\n');
  const req = parseDocumentSource('a.md', source).requirements[0];
  const changed = patchRequirement(source, req, 'priority', 'high');
  assert.equal(changed, source.replace('priority: low', 'priority: "high"'));
  assert.equal(parseDocumentSource('a.md', changed).requirements[0].meta['x-custom'] && (parseDocumentSource('a.md', changed).requirements[0].meta['x-custom'] as any).value, 42);
});

test('关联与缺失字段局部更新后 YAML 仍有效', () => {
  const target = meta(), current = meta();
  let source = moduleSource(makeRequirement('第一个', current) + '\n\n' + makeRequirement('第二个', target));
  let req = parseDocumentSource('a.md', source).requirements[0];
  source = patchRequirement(source, req, 'links', [{ type: 'satisfies', target: target.id }]);
  req = parseDocumentSource('a.md', source).requirements[0];
  source = patchRequirement(source, req, 'links', [{ type: 'verifies', target: target.id }]);
  assert.deepEqual(parseDocumentSource('a.md', source).requirements[0].meta.links, [{ type: 'verifies', target: target.id }]);
  assert.throws(() => patchRequirement(source, parseDocumentSource('a.md', source).requirements[0], 'id', randomUUID()), /不可修改/);
});

test('重复 ID、编号和缺失目标有明确诊断', () => {
  const first = meta();
  const source = moduleSource(makeRequirement('一', { ...first, links: [{ type: 'satisfies', target: randomUUID() }] }) + '\n\n' + makeRequirement('二', first));
  const result = indexWorkspace([{ path: 'a.md', content: source }], defaultConfig());
  assert.ok(result.diagnostics.some(x => x.message.includes('重复的条目 ID')));
  assert.ok(result.diagnostics.some(x => x.message.includes('重复的可读编号')));
  assert.ok(result.diagnostics.some(x => x.severity === 'warning' && x.message.includes('不存在')));
});

test('选区扩展到整张表格，移动条目不改变身份', () => {
  const source = '# 说明\n\n前言。\n\n| 名称 | 内容 |\n| --- | --- |\n| a | b |\n\n尾部说明。\n';
  const first = meta();
  let wrapped = wrapSelection(source, 'a.md', source.indexOf('a |'), source.indexOf('b |') + 1, first, randomUUID());
  let parsed = parseDocumentSource('a.md', wrapped);
  assert.equal(parsed.requirements.length, 1);
  assert.match(parsed.requirements[0].body, /^\| 名称/);
  assert.match(wrapped, /尾部说明。/);
  assert.throws(() => wrapSelection(wrapped, 'a.md', parsed.requirements[0].bodyFrom + 3, parsed.requirements[0].bodyTo - 1, meta(), randomUUID()), /重叠/);
  const second = { ...meta(), key: 'REQ-002' };
  wrapped += '\n\n' + makeRequirement('另一个条目', second);
  wrapped = moveRequirement(wrapped, 'a.md', second.id, -1);
  parsed = parseDocumentSource('a.md', wrapped);
  assert.deepEqual(parsed.requirements.map(x => x.meta.id), [second.id, first.id]);
});

test('模块信息补全保留已有 front matter 和 BOM', () => {
  const id = randomUUID();
  const source = '\uFEFF---\nauthor: "someone" # keep\n---\n\n# 文档\n';
  const changed = ensureModule(source, '文档', id);
  assert.ok(changed.startsWith('\uFEFF'));
  assert.match(changed, /author: "someone" # keep/);
  assert.equal(parseDocumentSource('a.md', changed).moduleId, id);
  assert.equal(ensureModule(changed, '文档', randomUUID()), changed);
  assert.ok(parseDocumentSource('empty.md', ensureModule('---\n---\n\n# 空元数据', '空', randomUUID())).moduleId);
});

test('更新位于后续字段之前的关联列表不破坏 YAML 或后续注释', () => {
  const target = randomUUID();
  const source = moduleSource(`<!-- req\nid: "${randomUUID()}"\nlinks:\n  - type: satisfies\n    target: "${target}"\nx-keep: 7 # untouched\n-->\n\n正文\n\n<!-- /req -->`);
  const req = parseDocumentSource('a.md', source).requirements[0];
  const changed = patchRequirement(source, req, 'links', [{ type: 'verifies', target }]);
  const parsed = parseDocumentSource('a.md', changed);
  assert.equal(parsed.diagnostics.length, 0);
  assert.equal(parsed.requirements[0].meta['x-keep'], 7);
  assert.match(changed, /x-keep: 7 # untouched/);
});

test('保存保留原始字节，检测外部修改和符号链接', async t => {
  const root = await directory(t), ws = await Workspace.create(root);
  const source = '\uFEFF# 中文 😀\r\n\r\n正文\r\n';
  const file = await ws.save('modules/中文.md', source, null);
  assert.deepEqual(await fs.readFile(path.join(root, file.path)), Buffer.from(source));
  await ws.save(file.path, file.content, file.version);
  await fs.writeFile(path.join(root, file.path), '外部修改');
  await assert.rejects(ws.save(file.path, '不应写入', file.version), /外部修改/);
  assert.equal(await fs.readFile(path.join(root, file.path), 'utf8'), '外部修改');
  await assert.rejects(safePath(root, '../outside.md'), /不允许/);
  await fs.symlink(os.tmpdir(), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safePath(root, 'link/outside.md'), /符号链接/);
});

test('多文件导入中途失败会恢复旧文件并删除新文件', async t => {
  const root = await directory(t);
  await fs.writeFile(path.join(root, 'old.md'), 'before');
  await assert.rejects(applyTransaction(root, [{ path: 'old.md', bytes: Buffer.from('after'), expected: digest('before') }, { path: 'new.md', bytes: Buffer.from('new'), expected: null }], index => { if (index === 1) throw new Error('模拟磁盘故障'); }), /已恢复/);
  assert.equal(await fs.readFile(path.join(root, 'old.md'), 'utf8'), 'before');
  await assert.rejects(fs.access(path.join(root, 'new.md')));
});

test('打开工作区会恢复中断的导入日志', async t => {
  const root = await directory(t);
  const entry = { path: 'a.md', before: Buffer.from('original').toString('base64'), after: Buffer.from('partial').toString('base64'), expected: digest('original'), written: digest('partial') };
  await fs.writeFile(path.join(root, 'a.md'), 'partial');
  await fs.mkdir(path.join(root, '.reqtype/local/transactions'), { recursive: true });
  await fs.writeFile(path.join(root, '.reqtype/local/transactions/test.json'), JSON.stringify({ state: 'pending', entries: [entry] }));
  const ws = await Workspace.open(root);
  assert.equal(await fs.readFile(path.join(root, 'a.md'), 'utf8'), 'original');
  assert.match(ws.recoveryWarnings[0], /恢复/);
  assert.equal((await ws.snapshot()).warnings.length, 0);
  assert.ok((await exportWorkspace(ws)).files.length);
});

test('附件缺失会阻止不完整导出，导入预览显示缺失附件', async t => {
  const root = await directory(t), ws = await Workspace.create(root);
  const source = moduleSource(makeRequirement('![示意](../assets/missing.png)', { ...meta(), key: 'IMAGE-001' }));
  await ws.save('modules/images.md', source, null);
  await assert.rejects(exportWorkspace(ws), /附件/);
  const preview = await prepareImport(ws, 'new.md', [{ path: 'modules/new.md', bytes: Buffer.from('# 普通文档') }]);
  assert.ok(preview.warnings.some(x => x.includes('missing.png')));
});

test('工作区保护跨平台大小写路径冲突和 Windows 保留名', async t => {
  const root = await directory(t), ws = await Workspace.create(root);
  await ws.save('modules/case.md', '# case', null);
  await assert.rejects(ws.save('modules/CASE.md', '# other', null), /大小写/);
  await assert.rejects(prepareImport(ws, 'CASE.md', [{ path: 'modules/CASE.md', bytes: Buffer.from('# imported') }]), /大小写/);
  await assert.rejects(safePath(root, '.GIT/a.md'), /不允许/);
  await assert.rejects(safePath(root, 'modules/CON.md'), /不允许/);
});

test('工作区 JSON 往返保留原文、未知字段和二进制附件', async t => {
  const root = await directory(t), target = await directory(t), source = await Workspace.create(root);
  const raw = '\uFEFF' + moduleSource(makeRequirement('表格\n\n| a | b |\n| --- | --- |\n| 1 | 2 |', { ...meta(), key: 'CUSTOM-001', 'x-example': { keep: true } })).replace(/\n/g, '\r\n');
  await source.save('modules/custom.md', raw, null);
  await fs.mkdir(path.join(root, 'assets'));
  const binary = Buffer.from([0, 255, 13, 10, 127, 1]);
  await fs.writeFile(path.join(root, 'assets/data.bin'), binary);
  const bundle = await exportWorkspace(source);
  const destination = await Workspace.open(target);
  const preview = await prepareImport(destination, 'roundtrip.json', decodeExchange(bundle));
  await applyImport(destination, preview.token, preview.entries.map(x => x.path));
  const exported = await exportWorkspace(destination);
  assert.deepEqual(exported.files, bundle.files);
  assert.deepEqual(await fs.readFile(path.join(target, 'modules/custom.md')), Buffer.from(raw));
  assert.deepEqual(await fs.readFile(path.join(target, 'assets/data.bin')), binary);
});

test('交换拒绝路径穿越、内容校验失败及过期预览', async t => {
  const entry = { path: '../escape.md', encoding: 'utf8', content: 'x', sha256: digest('x') };
  assert.throws(() => decodeExchange({ format: 'reqtype', version: 1, files: [entry] }), /不允许/);
  assert.throws(() => decodeExchange({ format: 'reqtype', version: 1, files: [{ ...entry, path: 'modules/a.md', sha256: '0'.repeat(64) }] }), /校验失败/);
  const root = await directory(t), ws = await Workspace.create(root), bytes = Buffer.from('# 导入');
  const preview = await prepareImport(ws, 'a.md', [{ path: 'modules/a.md', bytes }]);
  await atomicWrite(path.join(root, 'modules/a.md'), Buffer.from('外部新建'), null);
  await assert.rejects(applyImport(ws, preview.token, ['modules/a.md']), /已变化/);
});

test('网络图片需要本地化才能进入完整交换包，代码示例中的 URL 不受影响', async t => {
  const root = await directory(t), workspace = await Workspace.create(root), file = path.join(root,'modules/welcome.md');
  const source = await fs.readFile(file,'utf8');
  await fs.writeFile(file,source+'\n![remote](https://example.invalid/image.png)\n');
  await assert.rejects(exportWorkspace(workspace),/请先保存为本地附件/);
  await fs.writeFile(file,source+'\n```markdown\n![sample](https://example.invalid/image.png)\n```\n');
  await assert.doesNotReject(exportWorkspace(workspace));
});
