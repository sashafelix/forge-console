import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/channels';
import type { CreateRunDraftRequest, DesktopApi } from '../shared/contracts';

const api: DesktopApi = {
  getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getSystemInfo),
  listPipelines: () => ipcRenderer.invoke(IPC_CHANNELS.listPipelines),
  listRuntimes: () => ipcRenderer.invoke(IPC_CHANNELS.listRuntimes),
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  createRunDraft: (request: CreateRunDraftRequest) => ipcRenderer.invoke(IPC_CHANNELS.createRunDraft, request),
  openPath: (targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.openPath, targetPath)
};

contextBridge.exposeInMainWorld('agentPipeline', Object.freeze(api));
