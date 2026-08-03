import { app, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/channels';
import type {
  AgentExecutionRequest,
  AgentLibrarySelection,
  ConnectionId,
  CreateRunDraftRequest,
  PipelineManifest,
  ProcessRuntimeId,
  ProjectSelection,
  RunDraft,
  RunEvent,
  SaveConnectionRequest,
  SaveNetworkSettingsRequest,
  SystemInfo
} from '../shared/contracts';
import { isProcessRuntimeId } from '../shared/settings';
import { AgentExecutionController } from './agent-execution-controller';
import { discoverAgents } from './agents';
import { listPipelineManifests, listRuntimeAdapters } from './catalog';
import { listConnections, removeConnection, saveConnection, testConnection } from './connections';
import { ExecutionController } from './execution-controller';
import { applyElectronNetworkSettings } from './network-settings';
import { installPipelinePackFromDialog, resolvePipelinePack } from './packs';
import { clearRuntimePreflightCache, preflightRuntimeSession, testRuntimeConnection } from './runtime';
import { PreviewRunController } from './run-controller';
import { clearRuntimeExecutableOverride, loadSettings, setNetworkSettings, setRuntimeExecutableOverride } from './settings';

const previewRuns = new PreviewRunController();
const executionRuns = new ExecutionController();
const agentRuns = new AgentExecutionController();

async function describeDirectory(selectedPath: string): Promise<ProjectSelection> {
  const realPath = await fs.realpath(path.resolve(selectedPath));
  let isGitRepository = false;
  try {
    const gitEntry = await fs.stat(path.join(realPath, '.git'));
    isGitRepository = gitEntry.isDirectory() || gitEntry.isFile();
  } catch {
    isGitRepository = false;
  }
  return { name: path.basename(realPath), path: realPath, isGitRepository };
}

async function selectProjectDirectory(): Promise<ProjectSelection | null> {
  const result = await dialog.showOpenDialog({ title: 'Choose a local project repository', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return describeDirectory(result.filePaths[0]);
}

async function selectAgentLibrary(): Promise<AgentLibrarySelection | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a repository containing agent definitions',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const source = await describeDirectory(result.filePaths[0]);
  const agents = await discoverAgents(source.path);
  if (agents.length === 0) {
    throw new Error('No agents were found under agents/, .github/agents/, or .claude/agents/.');
  }
  return { source, agents };
}

async function selectNetworkCaCertificate(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a corporate CA certificate bundle',
    properties: ['openFile'],
    filters: [
      { name: 'Certificate files', extensions: ['pem', 'crt', 'cer'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selectedPath = await fs.realpath(path.resolve(result.filePaths[0]));
  const details = await fs.stat(selectedPath);
  if (!details.isFile()) throw new Error('Selected CA certificate is not a file');
  return selectedPath;
}

async function configureRuntimeExecutable(runtimeId: ProcessRuntimeId) {
  if (!isProcessRuntimeId(runtimeId)) throw new Error(`Unsupported process runtime: ${String(runtimeId)}`);
  const result = await dialog.showOpenDialog({
    title: `Choose the ${runtimeId === 'claude-code' ? 'Claude Code' : 'GitHub Copilot'} executable`,
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return listRuntimeAdapters();
  const selectedPath = await fs.realpath(path.resolve(result.filePaths[0]));
  const details = await fs.stat(selectedPath);
  if (!details.isFile()) throw new Error('The selected runtime executable is not a file');
  await setRuntimeExecutableOverride(runtimeId, selectedPath);
  return listRuntimeAdapters();
}

async function clearRuntimeExecutable(runtimeId: ProcessRuntimeId) {
  if (!isProcessRuntimeId(runtimeId)) throw new Error(`Unsupported process runtime: ${String(runtimeId)}`);
  await clearRuntimeExecutableOverride(runtimeId);
  return listRuntimeAdapters();
}

async function resolveManifest(request: CreateRunDraftRequest): Promise<PipelineManifest> {
  const manifest = (await listPipelineManifests()).find(
    (candidate) => candidate.id === request.pipelineId && candidate.version === request.pipelineVersion
  );
  if (!manifest) throw new Error(`Pipeline ${request.pipelineId}@${request.pipelineVersion} is not installed`);
  if (!manifest.supportedRuntimes.includes(request.runtimeId)) throw new Error(`Pipeline ${manifest.id} does not support runtime ${request.runtimeId}`);
  return manifest;
}

async function ensureRuntimeAvailable(runtimeId: string): Promise<void> {
  const runtime = (await listRuntimeAdapters()).find((candidate) => candidate.id === runtimeId);
  if (!runtime) throw new Error(`Runtime ${runtimeId} is not registered`);
  if (runtime.status !== 'available') throw new Error(runtime.configurationHint ?? `Runtime ${runtime.name} is not available`);
}

function sanitizedInputs(manifest: PipelineManifest, inputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, manifest.inputSchema.properties[name]?.secret ? '[REDACTED]' : value]));
}

async function createRunDraft(request: CreateRunDraftRequest): Promise<RunDraft> {
  if (!request.project?.path || !request.pipelineId || !request.pipelineVersion || !request.runtimeId) throw new Error('Project, pipeline and runtime are required');
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

function rendererEmitter(event: Electron.IpcMainInvokeEvent): (runEvent: RunEvent) => void {
  return (runEvent) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.runEvent, runEvent);
  };
}

export function registerIpcHandlers(openAgentWorkbench: () => void): void {
  ipcMain.handle(IPC_CHANNELS.getSystemInfo, (): SystemInfo => ({
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  }));
  ipcMain.handle(IPC_CHANNELS.getSettings, loadSettings);
  ipcMain.handle(IPC_CHANNELS.saveNetworkSettings, async (_event, request: SaveNetworkSettingsRequest) => {
    const settings = await setNetworkSettings(request);
    clearRuntimePreflightCache();
    await applyElectronNetworkSettings();
    return settings;
  });
  ipcMain.handle(IPC_CHANNELS.selectNetworkCaCertificate, selectNetworkCaCertificate);
  ipcMain.handle(IPC_CHANNELS.testRuntimeConnection, async (_event, runtimeId: ProcessRuntimeId) => {
    if (!isProcessRuntimeId(runtimeId)) throw new Error(`Unsupported process runtime: ${String(runtimeId)}`);
    await ensureRuntimeAvailable(runtimeId);
    return testRuntimeConnection(runtimeId, app.getPath('userData'));
  });
  ipcMain.handle(IPC_CHANNELS.listPipelines, listPipelineManifests);
  ipcMain.handle(IPC_CHANNELS.installPipelinePack, installPipelinePackFromDialog);
  ipcMain.handle(IPC_CHANNELS.listRuntimes, listRuntimeAdapters);
  ipcMain.handle(IPC_CHANNELS.configureRuntimeExecutable, (_event, runtimeId: ProcessRuntimeId) => configureRuntimeExecutable(runtimeId));
  ipcMain.handle(IPC_CHANNELS.clearRuntimeExecutable, (_event, runtimeId: ProcessRuntimeId) => clearRuntimeExecutable(runtimeId));
  ipcMain.handle(IPC_CHANNELS.listConnections, listConnections);
  ipcMain.handle(IPC_CHANNELS.saveConnection, (_event, request: SaveConnectionRequest) => saveConnection(request));
  ipcMain.handle(IPC_CHANNELS.removeConnection, (_event, id: ConnectionId) => removeConnection(id));
  ipcMain.handle(IPC_CHANNELS.testConnection, (_event, id: ConnectionId) => testConnection(id));
  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, selectProjectDirectory);
  ipcMain.handle(IPC_CHANNELS.selectAgentLibrary, selectAgentLibrary);
  ipcMain.handle(IPC_CHANNELS.createRunDraft, (_event, request: CreateRunDraftRequest) => createRunDraft(request));
  ipcMain.handle(IPC_CHANNELS.startPreviewRun, async (event, request: CreateRunDraftRequest) => {
    const manifest = await resolveManifest(request);
    await ensureRuntimeAvailable(request.runtimeId);
    return previewRuns.start(request, manifest, rendererEmitter(event));
  });
  ipcMain.handle(IPC_CHANNELS.getPreviewRun, (_event, runId: string) => previewRuns.get(runId));
  ipcMain.handle(IPC_CHANNELS.cancelPreviewRun, (_event, runId: string) => previewRuns.cancel(runId));
  ipcMain.handle(IPC_CHANNELS.prepareExecution, async (event, request: CreateRunDraftRequest) => {
    const pack = await resolvePipelinePack(request.pipelineId, request.pipelineVersion);
    if (!pack.manifest.supportedRuntimes.includes(request.runtimeId)) throw new Error(`Pipeline ${pack.manifest.id} does not support runtime ${request.runtimeId}`);
    await ensureRuntimeAvailable(request.runtimeId);
    return executionRuns.prepare(request, pack, rendererEmitter(event));
  });
  ipcMain.handle(IPC_CHANNELS.approveAndStartExecution, async (event, runId: string) => {
    const record = await executionRuns.get(runId);
    if (!record) throw new Error('Execution run was not found');
    await ensureRuntimeAvailable(record.runtimeId);
    const pack = await resolvePipelinePack(record.pipelineId, record.pipelineVersion);
    return executionRuns.start(runId, pack, rendererEmitter(event));
  });
  ipcMain.handle(IPC_CHANNELS.getExecutionRun, (_event, runId: string) => executionRuns.get(runId));
  ipcMain.handle(IPC_CHANNELS.cancelExecution, (event, runId: string) => executionRuns.cancel(runId, rendererEmitter(event)));
  ipcMain.handle(IPC_CHANNELS.prepareAgentExecution, async (event, request: AgentExecutionRequest) => {
    await ensureRuntimeAvailable(request.runtimeId);
    await preflightRuntimeSession(request.runtimeId, request.targetProject.path);
    return agentRuns.prepare(request, rendererEmitter(event));
  });
  ipcMain.handle(IPC_CHANNELS.approveAndStartAgentExecution, async (event, runId: string) => {
    const record = await agentRuns.get(runId);
    if (!record) throw new Error('Agent execution was not found');
    await ensureRuntimeAvailable(record.runtimeId);
    return agentRuns.start(runId, rendererEmitter(event));
  });
  ipcMain.handle(IPC_CHANNELS.getAgentExecutionRun, (_event, runId: string) => agentRuns.get(runId));
  ipcMain.handle(IPC_CHANNELS.cancelAgentExecution, (event, runId: string) => agentRuns.cancel(runId, rendererEmitter(event)));
  ipcMain.handle(IPC_CHANNELS.openAgentWorkbench, () => openAgentWorkbench());
  ipcMain.handle(IPC_CHANNELS.openPath, async (_event, targetPath: string) => shell.openPath(path.resolve(targetPath)));
}
