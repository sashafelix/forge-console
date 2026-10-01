/** Versioned, secret-free runtime configuration. Does not grant execution authority. */
export const PROTOCOLS = ['openai-responses', 'openai-chat', 'anthropic-messages', 'gemini'] as const;
export type Protocol = typeof PROTOCOLS[number];
export const ROLES = ['orchestrator', 'repository_analyst', 'specifier', 'consistency_analyst', 'test_author',
  'implementer', 'refactorer', 'independent_verifier', 'convergence_reviewer', 'risk_reviewer',
  'threat_modeler', 'migration_reviewer', 'infrastructure_reviewer', 'contract_reviewer', 'accessibility_reviewer'] as const;
export type Role = typeof ROLES[number];
export interface Provider {
  id: string; name: string; protocol: Protocol; baseUrl: string; locality: 'local' | 'external';
  auth: { mode: 'none' | 'bearer' | 'header'; header: string; credentialRef: string | null };
  allowInsecureHttp: boolean; timeoutMs: number; discoveryRetries: number;
}
export interface ModelBinding {
  id: string; name: string; providerId: string; model: string;
  maxOutputTokens: number; contextWindow: number | null; temperature: number | null; reasoningEffort: string | null;
}
export interface ModelRoute { role: Role; models: string[] }
export interface ModelProfile {
  id: string; name: string; projectId: string | null; localOnly: boolean;
  models: ModelBinding[]; routes: ModelRoute[];
}
export interface RuntimeConfiguration {
  schema_version: '1.0'; kind: 'rgr-runtime-configuration';
  profile: ModelProfile; providers: Provider[];
}
export type ProbeKind = 'generation' | 'streaming' | 'structured-output' | 'tool-calling';
export const PROBE_KINDS: ProbeKind[] = ['generation', 'streaming', 'structured-output', 'tool-calling'];
export interface ProbeResult {
  kind: ProbeKind; status: 'passed' | 'failed'; message: string; testedAt: string; latencyMs: number;
}
export interface ModelDiagnostic {
  profileId: string; modelId: string; fingerprint: string; results: ProbeResult[];
}
export interface ProviderLibrary {
  schemaVersion: '1.0'; revision: number; providers: Provider[]; profiles: ModelProfile[];
  diagnostics: ModelDiagnostic[];
}
export interface ProviderLibraryView extends ProviderLibrary { credentials: Record<string, boolean> }
export interface ModelDiscovery { models: string[]; truncated: boolean; message: string }
export interface SaveProviderRequest { expectedRevision: number; provider: Provider; secret?: string; clearSecret?: boolean }
export interface SaveProfileRequest { expectedRevision: number; profile: ModelProfile }
export interface ProbeRequest { profileId: string; modelId: string; kinds: ProbeKind[] }

export const PROVIDER_PRESETS: Record<string, { label: string; protocol: Protocol; baseUrl: string; locality: Provider['locality']; auth: Provider['auth']['mode']; header: string }> = {
  openai: { label: 'OpenAI', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', locality: 'external', auth: 'bearer', header: 'Authorization' },
  anthropic: { label: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', locality: 'external', auth: 'header', header: 'x-api-key' },
  gemini: { label: 'Google Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', locality: 'external', auth: 'header', header: 'x-goog-api-key' },
  ollama: { label: 'Ollama', protocol: 'openai-chat', baseUrl: 'http://localhost:11434/v1', locality: 'local', auth: 'none', header: 'Authorization' },
  lmstudio: { label: 'LM Studio', protocol: 'openai-chat', baseUrl: 'http://localhost:1234/v1', locality: 'local', auth: 'none', header: 'Authorization' },
  vllm: { label: 'vLLM', protocol: 'openai-chat', baseUrl: 'http://localhost:8000/v1', locality: 'local', auth: 'none', header: 'Authorization' },
  gateway: { label: 'Custom / compatible gateway', protocol: 'openai-chat', baseUrl: '', locality: 'external', auth: 'bearer', header: 'Authorization' }
};

export function newProvider(id: string, preset = 'openai'): Provider {
  const p = PROVIDER_PRESETS[preset] ?? PROVIDER_PRESETS.gateway;
  return { id, name: p.label, protocol: p.protocol, baseUrl: p.baseUrl, locality: p.locality,
    auth: { mode: p.auth, header: p.header, credentialRef: p.auth === 'none' ? null : `env:LLM_${id.replaceAll('-', '_').toUpperCase()}_KEY` },
    allowInsecureHttp: false, timeoutMs: 30000, discoveryRetries: 1 };
}
export function newProfile(id: string, name = 'New profile'): ModelProfile {
  return { id, name, projectId: null, localOnly: false, models: [], routes: ROLES.map((role) => ({ role, models: [] })) };
}
export function newModel(id: string, providerId: string): ModelBinding {
  return { id, name: 'New model', providerId, model: '', maxOutputTokens: 4096, contextWindow: null, temperature: null, reasoningEffort: null };
}

function object(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}: unsupported field ${key}.`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new Error(`${label}: missing ${key}.`);
}
function text(value: unknown, label: string, maximum = 256): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must be nonempty text (maximum ${maximum} characters, no control characters).`);
}
function id(value: unknown, label: string): asserts value is string {
  text(value, label, 80);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${label} must contain lowercase letters, digits and hyphens.`);
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate IDs.`);
}
export function validateProvider(value: unknown): Provider {
  object(value, ['id', 'name', 'protocol', 'baseUrl', 'locality', 'auth', 'allowInsecureHttp', 'timeoutMs', 'discoveryRetries'], 'Provider');
  id(value.id, 'Provider ID'); text(value.name, 'Provider name', 120); text(value.baseUrl, 'API base URL', 2048);
  if (!PROTOCOLS.includes(value.protocol as Protocol)) throw new Error('Unsupported API protocol.');
  if (value.locality !== 'local' && value.locality !== 'external') throw new Error('Invalid provider locality.');
  if (typeof value.allowInsecureHttp !== 'boolean') throw new Error('HTTP opt-in must be boolean.');
  const url = new URL(value.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API base URL must be HTTP(S), without embedded credentials, query or fragment.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback && !(value.locality === 'local' && value.allowInsecureHttp)) throw new Error('Remote endpoints require HTTPS; a local server needs explicit HTTP opt-in.');
  if (value.locality === 'external' && value.allowInsecureHttp) throw new Error('HTTP opt-in is for local servers only.');
  integer(value.timeoutMs, 1000, 120000, 'Timeout'); integer(value.discoveryRetries, 0, 2, 'Discovery retries');
  object(value.auth, ['mode', 'header', 'credentialRef'], 'Authentication');
  if (!['none', 'bearer', 'header'].includes(String(value.auth.mode))) throw new Error('Unsupported authentication mode.');
  text(value.auth.header, 'Authentication header', 80);
  if (!/^[A-Za-z0-9-]+$/.test(value.auth.header) || /^(host|content-length|content-type|accept|connection|cookie|proxy-authorization|anthropic-version)$/i.test(value.auth.header)) throw new Error('Unsafe authentication header name.');
  if (value.auth.mode === 'none' && value.auth.credentialRef !== null) throw new Error('Unauthenticated providers cannot have a credential reference.');
  if (value.auth.mode !== 'none' && (typeof value.auth.credentialRef !== 'string' || !/^env:[A-Z][A-Z0-9_]{0,127}$/.test(value.auth.credentialRef))) throw new Error('Use an environment reference such as env:OPENAI_API_KEY, never a key value.');
  return JSON.parse(JSON.stringify(value)) as Provider;
}

export function validateModel(value: unknown, providers: Provider[]): ModelBinding {
  object(value, ['id', 'name', 'providerId', 'model', 'maxOutputTokens', 'contextWindow', 'temperature', 'reasoningEffort'], 'Model');
  id(value.id, 'Model ID'); text(value.name, 'Model label', 120); text(value.model, 'Model ID / deployment name', 256);
  if (!providers.some((p) => p.id === value.providerId)) throw new Error('Model references an unknown provider.');
  integer(value.maxOutputTokens, 1, 262144, 'Output token limit');
  if (value.contextWindow !== null) integer(value.contextWindow, 1, 10000000, 'Context budget');
  if (value.contextWindow !== null && Number(value.maxOutputTokens) > Number(value.contextWindow)) throw new Error('Output limit exceeds the configured context budget.');
  if (value.temperature !== null && (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) throw new Error('Temperature must be blank or between 0 and 2.');
  if (value.reasoningEffort !== null) text(value.reasoningEffort, 'Reasoning effort', 32);
  return JSON.parse(JSON.stringify(value)) as ModelBinding;
}

export function validateProfile(value: unknown, providers: Provider[], requireRoutes = true): ModelProfile {
  object(value, ['id', 'name', 'projectId', 'localOnly', 'models', 'routes'], 'Profile');
  id(value.id, 'Profile ID'); text(value.name, 'Profile name', 120);
  if (value.projectId !== null) text(value.projectId, 'Project ID', 120);
  if (typeof value.localOnly !== 'boolean') throw new Error('Local-only policy must be boolean.');
  if (!Array.isArray(value.models) || value.models.length > 100) throw new Error('A profile supports at most 100 model bindings.');
  const models = value.models.map((m) => validateModel(m, providers)); unique(models.map((m) => m.id), 'Models');
  if (!Array.isArray(value.routes) || value.routes.length !== ROLES.length) throw new Error('Profile must include all governed roles.');
  const routes = value.routes.map((route) => {
    object(route, ['role', 'models'], 'Route');
    if (!ROLES.includes(route.role as Role) || !Array.isArray(route.models) || route.models.length > 10) throw new Error('Unknown role or excessive fallback chain.');
    if (requireRoutes && !route.models.length) throw new Error(`Choose a primary model for ${route.role}.`);
    if (!route.models.every((m) => typeof m === 'string' && models.some((candidate) => candidate.id === m))) throw new Error(`Unknown model in ${route.role} route.`);
    unique(route.models as string[], `${route.role} fallbacks`);
    return route as unknown as ModelRoute;
  });
  unique(routes.map((r) => r.role), 'Roles');
  if (value.localOnly && models.some((m) => providers.find((p) => p.id === m.providerId)?.locality !== 'local')) throw new Error('Local-only profiles cannot contain external models, including fallbacks.');
  return { id: value.id, name: value.name, projectId: value.projectId as string | null, localOnly: value.localOnly, models, routes };
}
export function exportConfiguration(profile: ModelProfile, providers: Provider[]): RuntimeConfiguration {
  const selected = providers.filter((p) => profile.models.some((m) => m.providerId === p.id)).map(validateProvider);
  return { schema_version: '1.0', kind: 'rgr-runtime-configuration', profile: validateProfile(profile, selected), providers: selected };
}
export function validateConfiguration(value: unknown): RuntimeConfiguration {
  object(value, ['schema_version', 'kind', 'profile', 'providers'], 'Runtime configuration');
  if (value.schema_version !== '1.0' || value.kind !== 'rgr-runtime-configuration') throw new Error('Unsupported runtime configuration version.');
  if (!Array.isArray(value.providers) || !value.providers.length || value.providers.length > 100) throw new Error('Configuration needs 1–100 providers.');
  const providers = value.providers.map(validateProvider); unique(providers.map((p) => p.id), 'Providers');
  const profile = validateProfile(value.profile, providers);
  if (providers.some((p) => !profile.models.some((m) => m.providerId === p.id))) throw new Error('Export contains an unused provider.');
  return { schema_version: '1.0', kind: 'rgr-runtime-configuration', providers, profile };
}
export function profileWarnings(profile: ModelProfile, providers: Provider[]): string[] {
  const warnings: string[] = [];
  const implementer = profile.routes.find((r) => r.role === 'implementer')?.models[0];
  if (implementer && profile.routes.find((r) => r.role === 'independent_verifier')?.models[0] === implementer) warnings.push('Implementation and verification use the same model. The pipeline must still use separate verifier identity and context.');
  if (profile.models.some((m) => providers.find((p) => p.id === m.providerId)?.locality === 'local')) warnings.push('Locality is operator-declared. A gateway may forward requests elsewhere; verify its upstream routing.');
  warnings.push('HTTP protocols support configuration and diagnostic probes here. No governed HTTP execution adapter is shipped by this workbench.');
  return warnings;
}
