import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentExecutionRequest,
  CreateRunDraftRequest,
  DesktopApi,
  ProcessRuntimeId,
  RunEvent,
  RunEventListener
} from '../shared/contracts';

// Sandboxed Electron preload scripts only receive a restricted require() implementation.
// Keep runtime values in this file so the emitted preload has no local module dependency.
// Type-only imports above are erased by TypeScript.
const IPC_CHANNELS = {
  getSystemInfo: 'system:get-info',
  getSettings: 'settings:get',
  listPipelines: 'catalog:list-pipelines',
  installPipelinePack: 'catalog:install-pipeline-pack',
  listRuntimes: 'catalog:list-runtimes',
  configureRuntimeExecutable: 'settings:configure-runtime-executable',
  clearRuntimeExecutable: 'settings:clear-runtime-executable',
  selectProjectDirectory: 'projects:select-directory',
  selectAgentLibrary: 'agents:select-library',
  createRunDraft: 'runs:create-draft',
  startPreviewRun: 'runs:start-preview',
  getPreviewRun: 'runs:get-preview',
  cancelPreviewRun: 'runs:cancel-preview',
  prepareExecution: 'runs:prepare-execution',
  approveAndStartExecution: 'runs:approve-start-execution',
  getExecutionRun: 'runs:get-execution',
  cancelExecution: 'runs:cancel-execution',
  prepareAgentExecution: 'agents:prepare-execution',
  approveAndStartAgentExecution: 'agents:approve-start-execution',
  getAgentExecutionRun: 'agents:get-execution',
  cancelAgentExecution: 'agents:cancel-execution',
  openAgentWorkbench: 'windows:open-agent-workbench',
  runEvent: 'runs:event',
  openPath: 'shell:open-path'
} as const;

const api: DesktopApi = {
  getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getSystemInfo),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  listPipelines: () => ipcRenderer.invoke(IPC_CHANNELS.listPipelines),
  installPipelinePack: () => ipcRenderer.invoke(IPC_CHANNELS.installPipelinePack),
  listRuntimes: () => ipcRenderer.invoke(IPC_CHANNELS.listRuntimes),
  configureRuntimeExecutable: (runtimeId: ProcessRuntimeId) => ipcRenderer.invoke(IPC_CHANNELS.configureRuntimeExecutable, runtimeId),
  clearRuntimeExecutable: (runtimeId: ProcessRuntimeId) => ipcRenderer.invoke(IPC_CHANNELS.clearRuntimeExecutable, runtimeId),
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  selectAgentLibrary: () => ipcRenderer.invoke(IPC_CHANNELS.selectAgentLibrary),
  createRunDraft: (request: CreateRunDraftRequest) => ipcRenderer.invoke(IPC_CHANNELS.createRunDraft, request),
  startPreviewRun: (request: CreateRunDraftRequest) => ipcRenderer.invoke(IPC_CHANNELS.startPreviewRun, request),
  getPreviewRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.getPreviewRun, runId),
  cancelPreviewRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelPreviewRun, runId),
  prepareExecution: (request: CreateRunDraftRequest) => ipcRenderer.invoke(IPC_CHANNELS.prepareExecution, request),
  approveAndStartExecution: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.approveAndStartExecution, runId),
  getExecutionRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.getExecutionRun, runId),
  cancelExecution: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelExecution, runId),
  prepareAgentExecution: (request: AgentExecutionRequest) => ipcRenderer.invoke(IPC_CHANNELS.prepareAgentExecution, request),
  approveAndStartAgentExecution: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.approveAndStartAgentExecution, runId),
  getAgentExecutionRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.getAgentExecutionRun, runId),
  cancelAgentExecution: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelAgentExecution, runId),
  openAgentWorkbench: () => ipcRenderer.invoke(IPC_CHANNELS.openAgentWorkbench),
  onRunEvent: (listener: RunEventListener) => {
    const handler = (_event: Electron.IpcRendererEvent, runEvent: RunEvent) => listener(runEvent);
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler);
  },
  openPath: (targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.openPath, targetPath)
};

contextBridge.exposeInMainWorld('agentPipeline', Object.freeze(api));
