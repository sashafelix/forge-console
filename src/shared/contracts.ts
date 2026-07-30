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

export interface DesktopApi {
  getSystemInfo(): Promise<SystemInfo>;
  listPipelines(): Promise<PipelineManifest[]>;
  listRuntimes(): Promise<RuntimeAdapterDescriptor[]>;
  selectProjectDirectory(): Promise<ProjectSelection | null>;
  createRunDraft(request: CreateRunDraftRequest): Promise<RunDraft>;
  openPath(path: string): Promise<string>;
}
