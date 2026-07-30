export const IPC_CHANNELS = {
  getSystemInfo: 'system:get-info',
  getSettings: 'settings:get',
  listPipelines: 'catalog:list-pipelines',
  installPipelinePack: 'catalog:install-pipeline-pack',
  listRuntimes: 'catalog:list-runtimes',
  configureRuntimeExecutable: 'settings:configure-runtime-executable',
  clearRuntimeExecutable: 'settings:clear-runtime-executable',
  selectProjectDirectory: 'projects:select-directory',
  createRunDraft: 'runs:create-draft',
  startPreviewRun: 'runs:start-preview',
  getPreviewRun: 'runs:get-preview',
  cancelPreviewRun: 'runs:cancel-preview',
  runEvent: 'runs:event',
  openPath: 'shell:open-path'
} as const;
