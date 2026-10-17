/** Bundled templates: no network request is needed to apply them. */
export const TYPE_PRESETS = [
  { id: 'jira', name: 'Jira 默认套餐', types: ['Epic', 'Story', 'Task', 'Bug', 'Subtask'], defaultType: 'Story', description: '参考 Jira Software 默认工作类型；套餐只添加类型，不替换现有配置。', source: 'https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types' },
  { id: 'aspice', name: 'ASPICE 参考套餐', types: ['干系人需求', '系统需求', '软件需求', '系统架构', '软件架构', '验证措施', '验证结果', '变更请求', '问题记录'], defaultType: '系统需求', description: '按 Automotive SPICE 4.0 过程与信息项整理的起始模板，可继续定制。', source: 'https://vda-qmc.de/wp-content/uploads/2023/12/Automotive-SPICE-PAM-v40.pdf' },
] as const;
