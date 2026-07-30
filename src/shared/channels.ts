export const IPC_CHANNELS = {
  getSystemInfo: 'system:get-info',
  listPipelines: 'catalog:list-pipelines',
  installPipelinePack: 'catalog:install-pipeline-pack',
  listRuntimes: 'catalog:list-runtimes',
  selectProjectDirectory: 'projects:select-directory',
  createRunDraft: 'runs:create-draft',
  startPreviewRun: 'runs:start-preview',
  getPreviewRun: 'runs:get-preview',
  cancelPreviewRun: 'runs:cancel-preview',
  runEvent: 'runs:event',
  openPath: 'shell:open-path'
} as const;
