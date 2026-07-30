import { app, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/channels';
import type {
  CreateRunDraftRequest,
  PipelineManifest,
  ProjectSelection,
  RunDraft,
  SystemInfo
} from '../shared/contracts';
import { listPipelineManifests, listRuntimeAdapters } from './catalog';
import { installPipelinePackFromDialog } from './packs';
import { PreviewRunController } from './run-controller';

const previewRuns = new PreviewRunController();

async function selectProjectDirectory(): Promise<ProjectSelection | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a local project repository',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const selectedPath = await fs.realpath(path.resolve(result.filePaths[0]));
  let isGitRepository = false;
  try {
    const gitEntry = await fs.stat(path.join(selectedPath, '.git'));
    isGitRepository = gitEntry.isDirectory() || gitEntry.isFile();
  } catch {
    isGitRepository = false;
  }

  return {
    name: path.basename(selectedPath),
    path: selectedPath,
    isGitRepository
  };
}

async function resolveManifest(request: CreateRunDraftRequest): Promise<PipelineManifest> {
  const manifest = (await listPipelineManifests()).find(
    (candidate) => candidate.id === request.pipelineId && candidate.version === request.pipelineVersion
  );
  if (!manifest) throw new Error(`Pipeline ${request.pipelineId}@${request.pipelineVersion} is not installed`);
  if (!manifest.supportedRuntimes.includes(request.runtimeId)) {
    throw new Error(`Pipeline ${manifest.id} does not support runtime ${request.runtimeId}`);
  }
  return manifest;
}

function sanitizedInputs(manifest: PipelineManifest, inputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, value]) => [name, manifest.inputSchema.properties[name]?.secret ? '[REDACTED]' : value])
  );
}

async function createRunDraft(request: CreateRunDraftRequest): Promise<RunDraft> {
  if (!request.project?.path || !request.pipelineId || !request.pipelineVersion || !request.runtimeId) {
    throw new Error('Project, pipeline and runtime are required');
  }
  const manifest = await resolveManifest(request);

  const id = randomUUID();
  const runDirectory = path.join(app.getPath('userData'), 'runs', id);
  await fs.mkdir(runDirectory, { recursive: true });
  const draft: RunDraft = {
    ...request,
    inputs: sanitizedInputs(manifest, request.inputs),
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
  ipcMain.handle(IPC_CHANNELS.installPipelinePack, installPipelinePackFromDialog);
  ipcMain.handle(IPC_CHANNELS.listRuntimes, listRuntimeAdapters);
  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, selectProjectDirectory);
  ipcMain.handle(IPC_CHANNELS.createRunDraft, (_event, request: CreateRunDraftRequest) => createRunDraft(request));
  ipcMain.handle(IPC_CHANNELS.startPreviewRun, async (event, request: CreateRunDraftRequest) => {
    const manifest = await resolveManifest(request);
    return previewRuns.start(request, manifest, (runEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.runEvent, runEvent);
    });
  });
  ipcMain.handle(IPC_CHANNELS.getPreviewRun, (_event, runId: string) => previewRuns.get(runId));
  ipcMain.handle(IPC_CHANNELS.cancelPreviewRun, (_event, runId: string) => previewRuns.cancel(runId));
  ipcMain.handle(IPC_CHANNELS.openPath, async (_event, targetPath: string) => shell.openPath(path.resolve(targetPath)));
}
