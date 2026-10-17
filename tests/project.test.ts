import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { assertTransition, defaultConfig, exportFileName, parseConfig, patchProjectConfig, statusOptions } from '../src/core/config';
import { nextKey, parseDocumentSource } from '../src/core/markdown';
import { Workspace } from '../src/main/workspace';

test('项目默认设置向后兼容、工作流与导出模板校验', () => {
  const config = parseConfig('version: 1\nname: Legacy\nx-extension: true\n');
  assert.equal(config.requirement.prefix, 'REQ'); assert.equal(config.id, undefined);
  assert.deepEqual(statusOptions(config, 'draft'), ['draft', 'reviewed']);
  assert.throws(() => assertTransition(config, 'draft', 'approved'), /不允许/);
  assert.doesNotThrow(() => assertTransition(config, 'draft', 'reviewed'));
  assert.throws(() => parseConfig(stringify({ ...config, workflow: { initial: 'draft', transitions: { draft: ['missing'] } } })), /状态转换/);
  assert.throws(() => parseConfig(stringify({ ...config, requirement: { ...config.requirement, padding: 0 } })), /编号位数/);
  assert.throws(() => parseConfig(stringify({ ...config, exports: { ...config.exports, fileName: '../bad' } })), /导出设置/);
  const customized = parseConfig('version: 1\nname: Custom\ntypes: [story]\nstatuses: [new, done]\npriorities: [P1]\n');
  assert.equal(customized.workflow.initial, 'new'); assert.deepEqual(statusOptions(customized, 'new'), ['new', 'done']);
  assert.equal(customized.requirement.defaultType, 'story');
  config.name = 'Name/with:characters'; config.exports.fileName = '{project}-{module}-{date}';
  assert.equal(exportFileName(config, 'json', 'a/design.md', new Date('2026-10-17T12:00:00Z')), 'Name_with_characters-design-2026-10-17.reqtype.json');
});

test('项目配置保留扩展字段、注释与 CRLF，删除的工作流状态可移除', () => {
  const source = '# project comment\r\nversion: 1\r\nname: Old # name comment\r\nx-plugin: {custom: 42}\r\nrequirement:\r\n  prefix: OLD # prefix comment\r\n  x-custom: yes\r\nworkflow:\r\n  initial: draft\r\n  transitions:\r\n    draft: [reviewed]\r\n    reviewed: [draft, approved]\r\n    approved: [reviewed, retired]\r\n    retired: [draft]\r\n';
  const config = parseConfig(source); config.name = 'New'; config.requirement.prefix = 'NEW';
  config.statuses = ['draft', 'reviewed', 'approved']; delete config.workflow.transitions.retired; config.workflow.transitions.approved = ['reviewed'];
  const output = patchProjectConfig(source, config);
  assert.match(output, /# project comment\r\n/); assert.match(output, /# name comment/); assert.match(output, /# prefix comment/);
  assert.match(output, /x-plugin: \{ custom: 42 \}/); assert.match(output, /x-custom: yes/);
  assert.equal(parseConfig(output).requirement.prefix, 'NEW'); assert.equal(parseConfig(output).workflow.transitions.retired, undefined);
});

test('项目设置保存不改条目，稳定 ID、外部冲突和在用定义受到保护', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reqtype-project-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = await Workspace.create(root), initial = await workspace.projectSettings();
  assert.ok(initial.config.id);
  const file = path.join(root, 'modules/welcome.md'), source = await fs.readFile(file, 'utf8');
  const config = structuredClone(initial.config); config.requirement.prefix = 'SYS'; config.requirement.padding = 4;
  await workspace.saveProject(config, initial.version);
  assert.equal(await fs.readFile(file, 'utf8'), source);
  const current = await workspace.projectSettings(); assert.equal(current.config.id, initial.config.id);
  const requirements = parseDocumentSource('modules/welcome.md', source).requirements;
  assert.equal(nextKey(requirements, 'SYS', 4), 'SYS-0001');
  requirements.push({ ...requirements[0], meta: { ...requirements[0].meta, key: 'SYS-0007' } });
  assert.equal(nextKey(requirements, 'SYS', 3), 'SYS-008');
  await assert.rejects(workspace.saveProject(config, initial.version), /外部修改/);
  const invalid = structuredClone(current.config); invalid.statuses = ['reviewed']; invalid.workflow = { initial: 'reviewed', transitions: { reviewed: [] } };
  await assert.rejects(workspace.saveProject(invalid, current.version), /现有条目无效/);
  await assert.rejects(workspace.saveProject({ ...current.config, id: '00000000-0000-4000-8000-000000000000' }, current.version), /稳定 ID/);
  await fs.writeFile(file, source.replace('priority: normal', 'priority: normal\nattributes: {owner: tester}'));
  const removed = structuredClone(current.config); delete removed.attributes?.owner;removed.typeAttributes=Object.fromEntries(removed.types.map(type=>[type,[]]));
  await assert.rejects(workspace.saveProject(removed, current.version), /仍被条目使用/);
  await fs.appendFile(path.join(root, '.reqtype/project.yaml'), '\n# external change\n');
  await assert.rejects(workspace.saveProject(config, current.version), /外部修改/);
  assert.match(await fs.readFile(path.join(root, '.reqtype/project.yaml'), 'utf8'), /# external change/);
});
