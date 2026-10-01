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
  | 'structured.output'
  | 'user.input';

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

export interface PipelineValidationCommand {
  id: string;
  name: string;
  executable: string;
  windowsExecutable?: string;
  args: string[];
  cwd?: string;
  timeoutSeconds: number;
  required: boolean;
}

export interface PipelineExecutionContract {
  mode: 'runtime-prompt';
  isolation: 'git-worktree';
  promptTemplate: string;
  maxTurns: number;
  validationCommands: PipelineValidationCommand[];
}

export interface PipelineManifest {
  schemaVersion: '1.0' | '1.1';
  id: string;
  name: string;
  description: string;
  version: string;
  inputSchema: PipelineInputSchema;
  requiredCapabilities: Capability[];
  supportedRuntimes: string[];
  stages: PipelineStage[];
  execution?: PipelineExecutionContract;
}

export type RuntimeKind = 'process' | 'http' | 'mcp';
export type AdapterStatus = 'available' | 'unconfigured' | 'unavailable';
export type ProcessRuntimeId = 'claude-code' | 'github-copilot';

export interface RuntimeAdapterDescriptor {
  id: string;
  name: string;
  description: string;
  kind: RuntimeKind;
  status: AdapterStatus;
  capabilities: Capability[];
  configurationHint?: string;
  executablePath?: string;
  executableSource?: 'configured' | 'path';
  version?: string;
  checkedAt?: string;
}

export type NetworkProxyMode = 'inherit' | 'system' | 'manual' | 'direct';

export interface NetworkSettings {
  proxyMode: NetworkProxyMode;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
  caCertificatePath: string;
}

export interface SaveNetworkSettingsRequest extends NetworkSettings {}

export interface RuntimeConnectionTestResult {
  runtimeId: ProcessRuntimeId;
  ok: boolean;
  testedAt: string;
  message: string;
}

export interface AppSettings {
  schemaVersion: '1.1';
  runtimeExecutableOverrides: Partial<Record<ProcessRuntimeId, string>>;
  network: NetworkSettings;
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

export interface AgentInputDefinition {
  name: string;
  title: string;
  description: string;
  required: boolean;
}

export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  sourceRoot: string;
  sourcePath: string;
  relativePath: string;
  tools: string[];
  inputs: AgentInputDefinition[];
  writes: string[];
  requiredEnvironment: string[];
  requestedCapabilities: Capability[];
  shellRequested: boolean;
  networkRequested: boolean;
  writeRequested: boolean;
  interactive: boolean;
  maxTurns: number;
  supportedRuntimes: ProcessRuntimeId[];
}

export interface AgentLibrarySelection {
  source: ProjectSelection;
  agents: AgentDefinition[];
}

export interface AgentExecutionRequest {
  agentSourceRoot: string;
  agentRelativePath: string;
  agentId: string;
  targetProject: ProjectSelection;
  runtimeId: ProcessRuntimeId;
  inputs: Record<string, unknown>;
}

export type ConnectionId = 'jira' | 'confluence' | 'self-hosted-llm';
export type ConnectionTestStatus = 'untested' | 'ok' | 'failed';

export interface ConnectionSummary {
  id: ConnectionId;
  name: string;
  configured: boolean;
  serviceUrl: string;
  model?: string;
  authHeader: string;
  authScheme: 'bearer' | 'raw';
  lastTestedAt?: string;
  lastTestStatus: ConnectionTestStatus;
  lastTestMessage?: string;
}

export interface SaveConnectionRequest {
  id: ConnectionId;
  serviceUrl: string;
  model?: string;
  authHeader?: string;
  authScheme?: 'bearer' | 'raw';
  secret?: string;
}

export interface ConnectionTestResult {
  id: ConnectionId;
  ok: boolean;
  status?: number;
  testedAt: string;
  message: string;
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
export type ExecutionRunStatus =
  | 'preparing'
  | 'awaiting_approval'
  | 'running'
  | 'waiting_for_input'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentQuestion {
  id: string;
  question: string;
  reason?: string;
  choices: string[];
  allowFreeText: boolean;
  requestedAt: string;
}

export interface AgentConversationMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: string;
  questionId?: string;
}

export type RunEventType =
  | 'run.started'
  | 'runtime.stdout'
  | 'runtime.stderr'
  | 'worktree.created'
  | 'approval.required'
  | 'execution.started'
  | 'execution.resumed'
  | 'interaction.requested'
  | 'interaction.replied'
  | 'validation.started'
  | 'validation.stdout'
  | 'validation.stderr'
  | 'validation.completed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

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

export interface ValidationCommandResult {
  commandId: string;
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  timedOut: boolean;
  passed: boolean;
  required: boolean;
}

export interface ExecutionRun extends CreateRunDraftRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ExecutionRunStatus;
  storagePath: string;
  repositoryRoot: string;
  baseRevision: string;
  worktreePath: string;
  workingDirectory: string;
  branchName: string;
  approvalRequired: true;
  approvedAt?: string;
  runtimePolicy: {
    fileWrites: 'worktree-only';
    shell: 'denied-to-model';
    network: 'denied-to-model';
    maxTurns: number;
    validationCommands: PipelineValidationCommand[];
  };
  validationResults: ValidationCommandResult[];
  exitCode?: number;
  error?: string;
}

export interface AgentExecutionRun extends AgentExecutionRequest {
  id: string;
  agentName: string;
  agentVersion: string;
  agentSourcePath: string;
  agentDescription: string;
  createdAt: string;
  updatedAt: string;
  status: ExecutionRunStatus;
  storagePath: string;
  repositoryRoot: string;
  baseRevision: string;
  worktreePath: string;
  workingDirectory: string;
  branchName: string;
  approvalRequired: true;
  approvedAt?: string;
  providerSessionId?: string;
  pendingQuestion?: AgentQuestion;
  conversation: AgentConversationMessage[];
  interactionCount: number;
  resultSummary?: string;
  runtimePolicy: {
    fileWrites: 'worktree-only' | 'denied-to-model';
    shell: 'allowed-to-model' | 'denied-to-model';
    network: 'allowed-through-approved-tools' | 'denied-to-model';
    interactive: boolean;
    maxTurns: number;
    requestedTools: string[];
    declaredWrites: string[];
    requiredEnvironment: string[];
    missingEnvironment: string[];
  };
  changedFiles: string[];
  exitCode?: number;
  error?: string;
}

export interface ReplyToAgentExecutionRequest {
  runId: string;
  reply: string;
  questionId?: string;
}

export type RunEventListener = (event: RunEvent) => void;

export interface DesktopApi {
  listModelConfiguration(): Promise<import('./providers').ProviderLibraryView>;
  saveModelProvider(request: import('./providers').SaveProviderRequest): Promise<import('./providers').ProviderLibraryView>;
  saveModelProfile(request: import('./providers').SaveProfileRequest): Promise<import('./providers').ProviderLibraryView>;
  removeModelConfiguration(request: { kind: 'provider' | 'profile'; id: string; expectedRevision: number }): Promise<import('./providers').ProviderLibraryView>;
  discoverProviderModels(providerId: string): Promise<import('./providers').ModelDiscovery>;
  probeProviderModel(request: import('./providers').ProbeRequest & { operationId: string }): Promise<import('./providers').ProviderLibraryView>;
  cancelProviderProbe(operationId: string): Promise<boolean>;
  selectModelConfiguration(): Promise<import('./providers').RuntimeConfiguration | null>;
  importModelConfiguration(request: { configuration: import('./providers').RuntimeConfiguration; expectedRevision: number }): Promise<import('./providers').ProviderLibraryView>;
  exportModelConfiguration(request: { profileId: string; expectedRevision: number }): Promise<string | null>;
  exportProjectProfile(draft: import('./project-profile').ProjectProfileDraft): Promise<string | null>;
  getSystemInfo(): Promise<SystemInfo>;
  getSettings(): Promise<AppSettings>;
  saveNetworkSettings(request: SaveNetworkSettingsRequest): Promise<AppSettings>;
  selectNetworkCaCertificate(): Promise<string | null>;
  testRuntimeConnection(runtimeId: ProcessRuntimeId): Promise<RuntimeConnectionTestResult>;
  listPipelines(): Promise<PipelineManifest[]>;
  installPipelinePack(): Promise<PipelineManifest | null>;
  listRuntimes(): Promise<RuntimeAdapterDescriptor[]>;
  configureRuntimeExecutable(runtimeId: ProcessRuntimeId): Promise<RuntimeAdapterDescriptor[]>;
  clearRuntimeExecutable(runtimeId: ProcessRuntimeId): Promise<RuntimeAdapterDescriptor[]>;
  selectProjectDirectory(): Promise<ProjectSelection | null>;
  selectAgentLibrary(): Promise<AgentLibrarySelection | null>;
  listConnections(): Promise<ConnectionSummary[]>;
  saveConnection(request: SaveConnectionRequest): Promise<ConnectionSummary[]>;
  removeConnection(connectionId: ConnectionId): Promise<ConnectionSummary[]>;
  testConnection(connectionId: ConnectionId): Promise<ConnectionTestResult>;
  createRunDraft(request: CreateRunDraftRequest): Promise<RunDraft>;
  startPreviewRun(request: CreateRunDraftRequest): Promise<PreviewRun>;
  getPreviewRun(runId: string): Promise<PreviewRun | null>;
  cancelPreviewRun(runId: string): Promise<boolean>;
  prepareExecution(request: CreateRunDraftRequest): Promise<ExecutionRun>;
  approveAndStartExecution(runId: string): Promise<ExecutionRun>;
  getExecutionRun(runId: string): Promise<ExecutionRun | null>;
  cancelExecution(runId: string): Promise<boolean>;
  prepareAgentExecution(request: AgentExecutionRequest): Promise<AgentExecutionRun>;
  approveAndStartAgentExecution(runId: string): Promise<AgentExecutionRun>;
  replyToAgentExecution(request: ReplyToAgentExecutionRequest): Promise<AgentExecutionRun>;
  getAgentExecutionRun(runId: string): Promise<AgentExecutionRun | null>;
  getLatestAgentExecutionRun(): Promise<AgentExecutionRun | null>;
  getAgentExecutionEvents(runId: string): Promise<RunEvent[]>;
  cancelAgentExecution(runId: string): Promise<boolean>;
  openAgentWorkbench(): Promise<void>;
  onRunEvent(listener: RunEventListener): () => void;
  openPath(path: string): Promise<string>;
}
