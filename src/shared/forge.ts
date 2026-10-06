export const FORGE_STAGES = ['prepare','brainstorm','plan','analyze','red_test','green_code','refactor','quality_gate','converge'] as const;
export type ForgeStage = typeof FORGE_STAGES[number];
export type ForgeAction = 'approve' | 'advance' | 'resume' | 'retry' | 'cancel';
export interface HostView {
  schema_version: '1.0'; host_version: '1.0'; id: string; story_id: string; created_at: string; updated_at: string;
  status: 'preparing' | 'awaiting_approval' | 'ready' | 'running' | 'failed' | 'completed' | 'cancelled';
  stage: ForgeStage | 'close'; attempt: number; base_revision: string; profile: string; completed_stages: ForgeStage[];
  tokens_estimated: number; error: string | null; recoverable: boolean;
  approval: { id: string; reason: string; binding_sha256: string; expires_at: number } | null;
  available_actions: ForgeAction[]; sandbox: { ready: boolean; backend?: string; reason?: string };
  permissions: { source_paths: string[]; test_paths: string[]; commands: Record<string, string[]>; network: string; publication: string;
    image?: string; max_turns?: number; command_timeout?: number; max_tokens?: number;
    providers?: { name: string; base_url: string; locality: string; credential_ref: string | null }[] };
  policy_sha256: string; configuration_sha256: string; bundle_path: string; workspace_path: string;
}
export interface ForgeEvent {
  sequence: number; timestamp: string; attempt: number; stage: string; event_type: string;
  actor_role: string; safe_summary?: string | null; artifact_refs: string[]; invocation_id?: string;
}
export interface EvidenceCriterion { id: string; statement: string; status: string; tests: string[]; evidence: string[] }
export interface EvidenceCommand {
  id: string; stage: string; role: string; invocationId?: string; command: string; exitCode: number;
  outputRef: string; collected?: number; passed?: number; failed?: number; wallTimeMs?: number;
}
export interface ForgeRunSnapshot {
  id: string; source: 'imported' | 'managed'; storyId: string; profile: string; baseRevision: string;
  updatedAt: string; status: string; verdict: string; evidenceLevel: 'imported_claims' | 'files_checked' | 'host_verified';
  issues: string[]; stages: string[]; attempt: number; criteria: EvidenceCriterion[]; commands: EvidenceCommand[];
  artifacts: { path: string; bytes: number }[]; eventCount: number; host?: HostView;
}
export interface ForgeSetup {
  host: { root: string; python: string; sha256: string } | null;
  inputs: { configuration: string; policy: string; inventory: string; facts: string;
    providers: { name: string; model: string; locality: string }[]; credentialNames: string[];
    permissions: { source_paths: string[]; test_paths: string[]; commands: Record<string, string[]>; image: string } } | null;
}
export interface ForgeDoctor {
  ready: boolean; host_version: string; sandbox: { ready: boolean; reason?: string };
  routes: { stage: string; model_id: string; provider_id: string; protocol: string; fallback: boolean }[];
  execution_authority: false;
  profile?: string; manual_checkpoints?: string[]; specialist_roles?: string[];
}
export interface ForgeApi {
  getForgeSetup(): Promise<ForgeSetup>;
  configureForgeHost(): Promise<ForgeSetup>;
  selectForgeInputs(): Promise<ForgeSetup>;
  doctorForgeHost(): Promise<ForgeDoctor>;
  prepareForgeRun(request: { project: import('./contracts').ProjectSelection; task: string }): Promise<ForgeRunSnapshot>;
  forgeAction(request: { id: string; action: ForgeAction; approvalId?: string; binding?: string; stage?: ForgeStage }): Promise<ForgeRunSnapshot>;
  listForgeRuns(): Promise<ForgeRunSnapshot[]>;
  importForgeBundle(): Promise<ForgeRunSnapshot | null>;
  getForgeRun(id: string): Promise<ForgeRunSnapshot>;
  getForgeEvents(request: { id: string; after: number; limit: number }): Promise<{ events: ForgeEvent[]; nextCursor: number }>;
  getForgeArtifact(request: { id: string; path: string }): Promise<{ path: string; text: string; redactions: number; truncated: boolean }>;
}
