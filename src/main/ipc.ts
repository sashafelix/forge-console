import { app, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/channels';
import type { CreateRunDraftRequest, ProjectSelection, RunDraft, SystemInfo } from '../shared/contracts';
import { listPipelineManifests, listRuntimeAdapters } from './catalog';

async function selectProjectDirectory(): Promise<ProjectSelection | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a local project repository',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const selectedPath = path.resolve(result.filePaths[0]);
  let isGitRepository = false;
  try {
    isGitRepository = (await fs.stat(path.join(selectedPath, '.git'))).isDirectory() || (await fs.stat(path.join(selectedPath, '.git'))).isFile();
  } catch {
    isGitRepository = false;
  }

  return {
    name: path.basename(selectedPath),
    path: selectedPath,
    isGitRepository
  };
}

async function createRunDraft(request: CreateRunDraftRequest): Promise<RunDraft> {
  if (!request.project?.path || !request.pipelineId || !request.pipelineVersion || !request.runtimeId) {
    throw new Error('Project, pipeline and runtime are required');
  }

  const id = randomUUID();
  const runDirectory = path.join(app.getPath('userData'), 'runs', id);
  await fs.mkdir(runDirectory, { recursive: true });
  const draft: RunDraft = {
    ...request,
    id,
    createdAt: new Date().toISOString(),
    status: 'draft',
    storagePath: runDirectory
  };
  await fs.writeFile(path.join(runDirectory, 'run.json'), `${JSON.stringify(draft, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return draft;
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getSystemInfo, (): SystemInfo => ({
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  }));
  ipcMain.handle(IPC_CHANNELS.listPipelines, listPipelineManifests);
  ipcMain.handle(IPC_CHANNELS.listRuntimes, async () => listRuntimeAdapters());
  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, selectProjectDirectory);
  ipcMain.handle(IPC_CHANNELS.createRunDraft, (_event, request: CreateRunDraftRequest) => createRunDraft(request));
  ipcMain.handle(IPC_CHANNELS.openPath, async (_event, targetPath: string) => shell.openPath(path.resolve(targetPath)));
}
