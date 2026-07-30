import { app, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/channels';
import type {
  CreateRunDraftRequest,
  DiscoverAgentsRequest,
  PipelineManifest,
  PrepareAgentExecutionRequest,
  ProcessRuntimeId,
  ProjectSelection,
  RunDraft,
  RunEvent,
  SystemInfo
} from '../shared/contracts';
import { isProcessRuntimeId } from '../shared/settings';
import { createAgentExecutionPack, discoverAgents } from './agents';
import { listPipelineManifests, listRuntimeAdapters } from './catalog';
import { ExecutionController } from './execution-controller';
import { installPipelinePackFromDialog, resolvePipelinePack } from './packs';
import { PreviewRunController } from './run-controller';
import { clearRuntimeExecutableOverride, loadSettings, setRuntimeExecutableOverride } from './settings';

const previewRuns = new PreviewRunController();
const executionRuns = new ExecutionController();

async function selectionFromPath(selectedPath: string): Promise<ProjectSelection> {
  const resolved = await fs.realpath(path.resolve(selectedPath));
  let isGitRepository = false;
  try {
    const gitEntry = await fs.stat(path.join(resolved, '.git'));
    isGitRepository = gitEntry.isDirectory() || gitEntry.isFile();
  } catch {
    isGitRepository = false;
  }
  return { name: path.basename(resolved), path: resolved, isGitRepository };
}

async function selectDirectory(title: string): Promise<ProjectSelection | null> {
  const result = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return selectionFromPath(result.filePaths[0]);
}

async function selectProjectDirectory(): Promise<ProjectSelection | null> {
  return selectDirectory('Choose a local project repository');
}

async function selectAgentLibraryDirectory(): Promise<ProjectSelection | null> {
  return selectDirectory('Choose an agent library repository');
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
  if (!manifest.supportedRuntimes.includes(request.runtimeId)) {
    throw new Error(`Pipeline ${manifest.id} does not support runtime ${request.runtimeId}`);
  }
  return manifest;
}

async function ensureRuntimeAvailable(runtimeId: string): Promise<void> {
  const runtime = (await listRuntimeAdapters()).find((candidate) => candidate.id === runtimeId);
  if (!runtime) throw new Error(`Runtime ${runtimeId} is not registered`);
  if (runtime.status !== 'available') throw new Error(runtime.configurationHint ?? `Runtime ${runtime.name} is not available`);
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

function rendererEmitter(event: Electron.IpcMainInvokeEvent): (runEvent: RunEvent) => void {
  return (runEvent) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.runEvent, runEvent);
  };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getSystemInfo, (): SystemInfo => ({
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  }));
  ipcMain.handle(IPC_CHANNELS.getSettings, loadSettings);
  ipcMain.handle(IPC_CHANNELS.listPipelines, listPipelineManifests);
  ipcMain.handle(IPC_CHANNELS.installPipelinePack, installPipelinePackFromDialog);
  ipcMain.handle(IPC_CHANNELS.listRuntimes, listRuntimeAdapters);
  ipcMain.handle(IPC_CHANNELS.configureRuntimeExecutable, (_event, runtimeId: ProcessRuntimeId) => configureRuntimeExecutable(runtimeId));
  ipcMain.handle(IPC_CHANNELS.clearRuntimeExecutable, (_event, runtimeId: ProcessRuntimeId) => clearRuntimeExecutable(runtimeId));
  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, selectProjectDirectory);
  ipcMain.handle(IPC_CHANNELS.selectAgentLibraryDirectory, selectAgentLibraryDirectory);
  ipcMain.handle(IPC_CHANNELS.discoverAgents, (_event, request: DiscoverAgentsRequest) => discoverAgents(request.sourceRepository));
  ipcMain.handle(IPC_CHANNELS.prepareAgentExecution, async (event, request: PrepareAgentExecutionRequest) => {
    await ensureRuntimeAvailable(request.runtimeId);
    const generated = await createAgentExecutionPack(request);
    const record = await executionRuns.prepare(generated.request, generated.pack, rendererEmitter(event));
    record.runtimePolicy.shell = request.agent.requiresShell ? 'allowed-to-model' : 'denied-to-model';
    record.runtimePolicy.network = request.agent.requiresNetwork ? 'allowed-to-model' : 'denied-to-model';
    await fs.writeFile(path.join(record.storagePath, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return record;
  });
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
    if (!pack.manifest.supportedRuntimes.includes(request.runtimeId)) {
      throw new Error(`Pipeline ${pack.manifest.id} does not support runtime ${request.runtimeId}`);
    }
    await ensureRuntimeAvailable(request.runtimeId);
    return executionRuns.prepare(request, pack, rendererEmitter(event));
  });
  ipcMain.handle(IPC_CHANNELS.approveAndStartExecution, async (event, runId: string) => {
    const record = await executionRuns.get(runId);
    if (!record) throw new Error('Execution run was not found');
    await ensureRuntimeAvailable(record.runtimeId);
    const generatedAgentPack = path.join(app.getPath('userData'), 'generated-agent-packs');
    let pack;
    if (record.pipelineId.startsWith('agent-')) {
      const promptPath = path.join(record.storagePath, 'prompt.txt');
      const prompt = await fs.readFile(promptPath, 'utf8');
      const directory = path.dirname((await fs.readdir(generatedAgentPack, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(generatedAgentPack, entry.name, 'agent-prompt.md'))
        .find(async () => false) ?? promptPath);
      const ephemeralDirectory = path.join(record.storagePath, 'agent-pack');
      await fs.mkdir(ephemeralDirectory, { recursive: true });
      await fs.writeFile(path.join(ephemeralDirectory, 'agent-prompt.md'), prompt, 'utf8');
      pack = {
        directory: ephemeralDirectory,
        manifest: {
          schemaVersion: '1.1' as const,
          id: record.pipelineId,
          name: record.pipelineId.replace(/^agent-/, ''),
          description: 'Standalone agent execution',
          version: record.pipelineVersion,
          inputSchema: { type: 'object' as const, properties: {} },
          requiredCapabilities: ['repository.read' as const, 'repository.write' as const],
          supportedRuntimes: [record.runtimeId],
          stages: [{ id: 'agent', name: 'Agent', description: 'Standalone agent', order: 1, role: 'agent', requiredCapabilities: ['repository.read' as const] }],
          execution: {
            mode: 'runtime-prompt' as const,
            isolation: 'git-worktree' as const,
            promptTemplate: 'agent-prompt.md',
            maxTurns: record.runtimePolicy.maxTurns,
            validationCommands: record.runtimePolicy.validationCommands,
            modelShell: record.runtimePolicy.shell === 'allowed-to-model' ? 'allowed' as const : 'denied' as const,
            modelNetwork: record.runtimePolicy.network === 'allowed-to-model' ? 'allowed' as const : 'denied' as const
          }
        }
      };
      void directory;
    } else {
      pack = await resolvePipelinePack(record.pipelineId, record.pipelineVersion);
    }
    return executionRuns.start(runId, pack, rendererEmitter(event));
  });
  ipcMain.handle(IPC_CHANNELS.getExecutionRun, (_event, runId: string) => executionRuns.get(runId));
  ipcMain.handle(IPC_CHANNELS.cancelExecution, (event, runId: string) => executionRuns.cancel(runId, rendererEmitter(event)));
  ipcMain.handle(IPC_CHANNELS.openPath, async (_event, targetPath: string) => shell.openPath(path.resolve(targetPath)));
}
