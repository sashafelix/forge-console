import { app, dialog, net, safeStorage } from 'electron';
import { guardedIpcMain as ipcMain } from './secure-ipc';
import { promises as fs } from 'node:fs';
import { IPC_CHANNELS } from '../shared/channels';
import { validateConfiguration } from '../shared/providers';
import type { ProbeRequest, SaveProfileRequest, SaveProviderRequest } from '../shared/providers';
import { ProviderRegistry, readBoundedJson } from './provider-registry';
import { applyElectronNetworkSettings } from './network-settings';

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry(app.getPath('userData'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value) => safeStorage.encryptString(value), decrypt: (value) => safeStorage.decryptString(value)
  }, (url, init) => net.fetch(url, init));
}

export function registerProviderIpc(): void {
  const registry = createProviderRegistry();
  // Settings updates already reconfigure Electron centrally. Initialize once here;
  // reapplying for every probe would close another window's active connections.
  let networkReady: Promise<void> | undefined;
  function prepareNetwork() {
    return networkReady ??= applyElectronNetworkSettings().catch((error) => { networkReady = undefined; throw error; });
  }
  ipcMain.handle(IPC_CHANNELS.listModelConfiguration, () => registry.list());
  ipcMain.handle(IPC_CHANNELS.saveModelProvider, (_event, request: SaveProviderRequest) => registry.saveProvider(request));
  ipcMain.handle(IPC_CHANNELS.saveModelProfile, (_event, request: SaveProfileRequest) => registry.saveProfile(request));
  ipcMain.handle(IPC_CHANNELS.removeModelConfiguration, (_event, request: { kind: 'provider' | 'profile'; id: string; expectedRevision: number }) => registry.remove(request.kind, request.id, request.expectedRevision));
  ipcMain.handle(IPC_CHANNELS.discoverProviderModels, async (_event, providerId: string) => {
    await prepareNetwork(); return registry.discover(providerId);
  });
  const owners = new Map<string, { senderId: number; cancelled: boolean }>();
  ipcMain.handle(IPC_CHANNELS.probeProviderModel, async (event, request: ProbeRequest & { operationId: string }) => {
    if (owners.has(request.operationId)) throw new Error('Diagnostic operation is already running.');
    const owner = { senderId: event.sender.id, cancelled: false };
    owners.set(request.operationId, owner);
    try { await prepareNetwork(); return owner.cancelled ? await registry.list() : await registry.probe(request, request.operationId); }
    finally { owners.delete(request.operationId); }
  });
  ipcMain.handle(IPC_CHANNELS.cancelProviderProbe, (event, operationId: string) => {
    const owner = owners.get(operationId);
    if (owner?.senderId !== event.sender.id) return false;
    owner.cancelled = true; registry.cancel(operationId); return true;
  });
  ipcMain.handle(IPC_CHANNELS.selectModelConfiguration, async () => {
    const selected = await dialog.showOpenDialog({ title: 'Review a runtime configuration', properties: ['openFile'], filters: [{ name: 'JSON configuration', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return validateConfiguration(await readBoundedJson(selected.filePaths[0]));
  });
  ipcMain.handle(IPC_CHANNELS.importModelConfiguration, (_event, request: { configuration: unknown; expectedRevision: number }) => registry.importProfile(request.configuration, request.expectedRevision));
  ipcMain.handle(IPC_CHANNELS.exportModelConfiguration, async (_event, request: { profileId: string; expectedRevision: number }) => {
    const configuration = await registry.exportProfile(request.profileId, request.expectedRevision);
    const selected = await dialog.showSaveDialog({ title: 'Export a new runtime configuration (no credentials)', defaultPath: 'runtime-configuration.json', filters: [{ name: 'JSON configuration', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return null;
    await fs.writeFile(selected.filePath, JSON.stringify(configuration, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return selected.filePath;
  });
}
