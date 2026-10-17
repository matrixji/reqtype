const { randomUUID } = require('node:crypto');

exports.activate = api => {
  api.registerCodeBlock({ id: 'decision', title: '决策记录卡片', languages: ['decision'], render(input) {
    const data = JSON.parse(input.code);
    if (!data || typeof data.title !== 'string') throw new Error('decision 代码块需要 JSON 对象及 title');
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    return `<section class="decision-card"><strong>${escape(data.title)}</strong><p>${escape(data.status || '待决策')}</p><div>${escape(data.reason)}</div></section>`;
  } });
  api.registerCommand({ id: 'statistics', title: '统计需求', run(snapshot) {
    const counts = {};
    for (const req of snapshot.requirements) counts[req.meta.status || 'draft'] = (counts[req.meta.status || 'draft'] || 0) + 1;
    return { message: `共 ${snapshot.requirements.length} 个条目，${snapshot.requirements.reduce((n, req) => n + (req.meta.links || []).length, 0)} 个关联。${Object.entries(counts).map(([key, n]) => `${key} ${n}`).join(' · ')}` };
  } });
  api.registerValidator({ id: 'placeholders', title: '检查待完善内容', validate(snapshot) {
    return snapshot.requirements.filter(req => /\b(TODO|TBD)\b|待补充|待确定/i.test(req.body)).map(req => ({ path: req.path, from: req.bodyFrom, id: req.meta.id, severity: 'warning', message: `${req.meta.key || req.title} 仍包含待完善内容` }));
  } });
  api.registerExporter({ id: 'csv', title: '条目表格 CSV', extension: 'csv', export(snapshot) {
    const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return '\uFEFF' + [['编号', 'ID', '标题', '类型', '状态', '优先级', '模块', '正文', '关联'], ...snapshot.requirements.map(req => [req.meta.key, req.meta.id, req.title, req.meta.type || 'requirement', req.meta.status || 'draft', req.meta.priority, req.path, req.body, JSON.stringify(req.meta.links || [])])].map(row => row.map(cell).join(',')).join('\r\n');
  } });
  api.registerImporter({ id: 'lines', title: '按行导入文本', extensions: ['txt'], import(input, snapshot) {
    const rows = input.text.replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const settings = snapshot.config.requirement;
    const prefix = settings.prefix + '-';
    let number = snapshot.requirements.reduce((max, req) => { const suffix = req.meta.key?.startsWith(prefix) ? req.meta.key.slice(prefix.length) : ''; return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max; }, 0);
    const source = ['---', 'reqtype: 1', `module: "${randomUUID()}"`, 'title: "文本导入"', '---', '', '# 文本导入', '', ...rows.map(row => {
      const metadata = { id: randomUUID(), key: prefix + String(++number).padStart(settings.padding, '0'), type: settings.defaultType, status: snapshot.config.workflow.initial, priority: settings.defaultPriority };
      return `<!-- req\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n-->\n\n${row}\n\n<!-- /req -->\n`;
    })].join('\n');
    const directory = snapshot.config.documents.find(root => !/\.md$/i.test(root)) || (snapshot.config.documents.length ? null : 'modules');
    if (!directory) throw new Error('此工作区仅配置了单文件，请先在项目配置中添加文档目录');
    return [{ path: `${directory}/import-${Date.now()}.md`, content: source }];
  } });
};
