export const IPC_CHANNELS = {
  getSystemInfo: 'system:get-info',
  listPipelines: 'catalog:list-pipelines',
  listRuntimes: 'catalog:list-runtimes',
  selectProjectDirectory: 'projects:select-directory',
  createRunDraft: 'runs:create-draft',
  openPath: 'shell:open-path'
} as const;
