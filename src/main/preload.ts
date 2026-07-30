import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/channels';
import type {
  CreateRunDraftRequest,
  DesktopApi,
  ProcessRuntimeId,
  RunEvent,
  RunEventListener
} from '../shared/contracts';

const api: DesktopApi = {
  getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getSystemInfo),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  listPipelines: () => ipcRenderer.invoke(IPC_CHANNELS.listPipelines),
  installPipelinePack: () => ipcRenderer.invoke(IPC_CHANNELS.installPipelinePack),
  listRuntimes: () => ipcRenderer.invoke(IPC_CHANNELS.listRuntimes),
  configureRuntimeExecutable: (runtimeId: ProcessRuntimeId) => ipcRenderer.invoke(IPC_CHANNELS.configureRuntimeExecutable, runtimeId),
  clearRuntimeExecutable: (runtimeId: ProcessRuntimeId) => ipcRenderer.invoke(IPC_CHANNELS.clearRuntimeExecutable, runtimeId),
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  createRunDraft: (request: CreateRunDraftRequest) => ipcRenderer.invoke(IPC_CHANNELS.createRunDraft, request),
  startPreviewRun: (request: CreateRunDraftRequest) => ipcRenderer.invoke(IPC_CHANNELS.startPreviewRun, request),
  getPreviewRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.getPreviewRun, runId),
  cancelPreviewRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelPreviewRun, runId),
  onRunEvent: (listener: RunEventListener) => {
    const handler = (_event: Electron.IpcRendererEvent, runEvent: RunEvent) => listener(runEvent);
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler);
  },
  openPath: (targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.openPath, targetPath)
};

contextBridge.exposeInMainWorld('agentPipeline', Object.freeze(api));
