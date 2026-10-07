import { app, dialog } from 'electron';
import { guardedIpcMain as ipcMain } from './secure-ipc';
import { IPC_CHANNELS } from '../shared/channels';
import { ForgeBridge } from './forge-bridge';
import { createProviderRegistry } from './provider-ipc';
import type { ForgeAction, ForgeStage } from '../shared/forge';
import type { ProjectSelection } from '../shared/contracts';

export function registerForgeIpc(approvedProjects: Set<string>): void {
  const registry = createProviderRegistry();
  const bridge = new ForgeBridge(app.getPath('userData'), (value) => registry.environmentForBindings(value));
  ipcMain.handle(IPC_CHANNELS.getForgeSetup, () => bridge.setup());
  ipcMain.handle(IPC_CHANNELS.configureForgeHost, async () => {
    const root = await dialog.showOpenDialog({ title: 'Select the trusted Forge checkout to execute', properties: ['openDirectory'] });
    if (root.canceled || !root.filePaths[0]) return bridge.setup();
    const python = await dialog.showOpenDialog({ title: 'Select the Python 3.11+ executable for Forge', properties: ['openFile'] });
    if (python.canceled || !python.filePaths[0]) return bridge.setup();
    return bridge.configure(root.filePaths[0], python.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.selectForgeInputs, async () => {
    const paths = {} as Record<'configuration'|'policy'|'inventory'|'facts', string>;
    const names = { configuration: 'model runtime configuration', policy: 'execution policy', inventory: 'reviewed adapter registrations', facts: 'task risk facts' };
    for (const key of ['configuration','policy','inventory','facts'] as const) {
      const selected = await dialog.showOpenDialog({ title: 'Select operator ' + names[key], properties: ['openFile'],
        filters: [{ name: 'JSON operator input', extensions: ['json'] }] });
      if (selected.canceled || !selected.filePaths[0]) return bridge.setup();
      paths[key] = selected.filePaths[0];
    }
    return bridge.selectInputs(paths);
  });
  ipcMain.handle(IPC_CHANNELS.doctorForgeHost, () => bridge.doctor());
  ipcMain.handle(IPC_CHANNELS.prepareForgeRun, (_event, request: { project: ProjectSelection; task: string }) => {
    if (!request?.project || !approvedProjects.has(request.project.path)) throw new Error('Select the target repository through the native project picker.');
    return bridge.prepare(request.project, request.task);
  });
  ipcMain.handle(IPC_CHANNELS.forgeAction, (_event, request: { id: string; action: ForgeAction; approvalId?: string; binding?: string; stage?: ForgeStage }) => {
    if (!request || !['approve','advance','resume','retry','cancel'].includes(request.action)) throw new Error('Unknown Forge action.');
    return bridge.action(request);
  });
  ipcMain.handle(IPC_CHANNELS.listForgeRuns, () => bridge.list());
  ipcMain.handle(IPC_CHANNELS.importForgeBundle, async () => {
    const result = await dialog.showOpenDialog({ title: 'Inspect a Forge evidence bundle directory', properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : bridge.import(result.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.getForgeRun, (_event, id: string) => bridge.get(id));
  ipcMain.handle(IPC_CHANNELS.getForgeEvents, (_event, request: { id: string; after: number; limit: number }) => bridge.events(request.id, request.after, request.limit));
  ipcMain.handle(IPC_CHANNELS.getForgeArtifact, (_event, request: { id: string; path: string }) => bridge.artifact(request.id, request.path));
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    void bridge.shutdown().finally(() => app.quit());
  });
}
