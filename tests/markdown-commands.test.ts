import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { markdownEdit, assertMarkdownEdit } from '../src/renderer/markdown-commands';
import { ensureModule, makeRequirement, parseDocumentSource } from '../src/core/markdown';

const apply = (source: string, from: number, to: number, command: Parameters<typeof markdownEdit>[3], options?: Parameters<typeof markdownEdit>[4]) => { const edit = markdownEdit(source, from, to, command, options); return source.slice(0, edit.from) + edit.insert + source.slice(edit.to); };
test('TOOLBAR-001: inline toggles preserve Unicode and select the content', () => {
  assert.equal(apply('中文🙂', 0, 4, 'bold'), '**中文🙂**');
  assert.equal(apply('**中文🙂**', 2, 6, 'bold'), '中文🙂');
  assert.equal(apply('**中文🙂**', 0, 8, 'bold'), '中文🙂');
  assert.equal(apply('`code`', 0, 6, 'inlineCode'), 'code');
  const edit = markdownEdit('', 0, 0, 'bold'); assert.equal(edit.insert.slice(edit.anchor, edit.head), '文字');
});
test('TOOLBAR-002: line commands do not consume the next unselected line', () => {
  assert.equal(apply('one\ntwo\nthree', 0, 8, 'bullet'), '- one\n- two\nthree');
  assert.equal(apply('- one\n- two\nthree', 0, 11, 'bullet'), 'one\ntwo\nthree');
  assert.equal(apply('one\ntwo', 1, 6, 'ordered'), '1. one\n2. two');
  assert.equal(apply('- one\n- [x] two', 0, 15, 'ordered'), '1. one\n2. two');
  assert.equal(apply('  - one\n\n  - two', 0, 16, 'task'), '  - [ ] one\n\n  - [ ] two');
  assert.equal(apply('## title', 3, 8, 'heading', { value: '3' }), '### title');
});
test('TOOLBAR-003: code fences and templates remain parseable', () => {
  assert.equal(apply('```\ncode\n```', 0, 12, 'code', { value: 'markdown' }), '````markdown\n```\ncode\n```\n````');
  for (const command of ['mermaid', 'plantuml', 'table', 'math', 'footnote', 'alert', 'toc'] as const) {
    const source = ensureModule(makeRequirement('正文', { id: randomUUID(), key: 'REQ-001' }, '\n', 2), '文档', randomUUID());
    const from = source.indexOf('正文'); const edit = markdownEdit(source, from, from + 2, command); assertMarkdownEdit(source, 'modules/test.md', edit);
    assert.equal(parseDocumentSource('modules/test.md', apply(source, from, from + 2, command)).requirements.length, 1);
  }
});
test('TOOLBAR-004: metadata and cross-boundary operations fail without edits', () => {
  const source = ensureModule(makeRequirement('正文', { id: randomUUID(), key: 'REQ-001' }, '\n', 2), '文档', randomUUID());
  const doc = parseDocumentSource('test.md', source), req = doc.requirements[0];
  for (const [from, to] of [[0, 0], [req.from, req.bodyFrom + 3], [req.bodyFrom + 2, req.to]]) assert.throws(() => assertMarkdownEdit(source, 'test.md', markdownEdit(source, from, to, 'bold')), /边界|元数据/);
  const edit = markdownEdit(source, source.indexOf('正文'), source.indexOf('正文') + 2, 'bold'); assertMarkdownEdit(source, 'test.md', edit);
  const after = source.slice(0, edit.from) + edit.insert + source.slice(edit.to); assert.equal(after, source.replace('正文', '**正文**'));
});
test('TOOLBAR-005: links escape delimiters and footnote ids are unique', () => {
  assert.equal(apply('a[b]', 0, 4, 'link', { value: 'https://example.com/a(b)' }), '[a\\[b\\]](https://example.com/a%28b%29)');
  assert.match(apply('[^note1]', 8, 8, 'footnote'), /\[\^note2\]/);
});
