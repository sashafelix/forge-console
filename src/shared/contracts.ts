export type Capability =
  | 'repository.read'
  | 'repository.write'
  | 'command.execute'
  | 'git.worktree'
  | 'jira.read'
  | 'jira.write'
  | 'confluence.read'
  | 'github.read'
  | 'github.write'
  | 'mcp.tools'
  | 'structured.output';

export interface PipelineInputProperty {
  type: 'string' | 'number' | 'boolean';
  title: string;
  description?: string;
  default?: string | number | boolean;
  enum?: Array<string | number>;
  multiline?: boolean;
  secret?: boolean;
}

export interface PipelineInputSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, PipelineInputProperty>;
}

export interface PipelineStage {
  id: string;
  name: string;
  description: string;
  order: number;
  role: string;
  requiredCapabilities: Capability[];
}

export interface PipelineManifest {
  schemaVersion: '1.0';
  id: string;
  name: string;
  description: string;
  version: string;
  inputSchema: PipelineInputSchema;
  requiredCapabilities: Capability[];
  supportedRuntimes: string[];
  stages: PipelineStage[];
}

export type RuntimeKind = 'process' | 'http' | 'mcp';
export type AdapterStatus = 'available' | 'unconfigured' | 'unavailable';

export interface RuntimeAdapterDescriptor {
  id: string;
  name: string;
  description: string;
  kind: RuntimeKind;
  status: AdapterStatus;
  capabilities: Capability[];
  configurationHint?: string;
  executablePath?: string;
  version?: string;
  checkedAt?: string;
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
}

export interface ProjectSelection {
  name: string;
  path: string;
  isGitRepository: boolean;
}

export interface CreateRunDraftRequest {
  project: ProjectSelection;
  pipelineId: string;
  pipelineVersion: string;
  runtimeId: string;
  inputs: Record<string, unknown>;
}

export interface RunDraft extends CreateRunDraftRequest {
  id: string;
  createdAt: string;
  status: 'draft';
  storagePath: string;
}

export type PreviewRunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunEventType = 'run.started' | 'runtime.stdout' | 'runtime.stderr' | 'run.completed' | 'run.failed' | 'run.cancelled';

export interface RunEvent {
  runId: string;
  sequence: number;
  timestamp: string;
  type: RunEventType;
  message: string;
  payload?: unknown;
}

export interface PreviewRun extends CreateRunDraftRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PreviewRunStatus;
  storagePath: string;
  exitCode?: number;
  error?: string;
}

export type RunEventListener = (event: RunEvent) => void;

export interface DesktopApi {
  getSystemInfo(): Promise<SystemInfo>;
  listPipelines(): Promise<PipelineManifest[]>;
  installPipelinePack(): Promise<PipelineManifest | null>;
  listRuntimes(): Promise<RuntimeAdapterDescriptor[]>;
  selectProjectDirectory(): Promise<ProjectSelection | null>;
  createRunDraft(request: CreateRunDraftRequest): Promise<RunDraft>;
  startPreviewRun(request: CreateRunDraftRequest): Promise<PreviewRun>;
  getPreviewRun(runId: string): Promise<PreviewRun | null>;
  cancelPreviewRun(runId: string): Promise<boolean>;
  onRunEvent(listener: RunEventListener): () => void;
  openPath(path: string): Promise<string>;
}
