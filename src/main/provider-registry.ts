import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exportConfiguration, PROBE_KINDS, validateConfiguration, validateProfile, validateProvider } from '../shared/providers';
import type { ModelBinding, ModelDiagnostic, ModelProfile, ProbeRequest, ProbeResult, Provider, ProviderLibrary, ProviderLibraryView, RuntimeConfiguration, SaveProfileRequest, SaveProviderRequest } from '../shared/providers';
import { discoverModels, probeModel, type ProviderFetch } from './provider-protocols';

export interface CredentialVault { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
type StoredLibrary = ProviderLibrary & { secretSlots: Record<string, string> };
const LIMIT = 2 * 1024 * 1024;
export async function readBoundedJson(filename: string): Promise<unknown> {
  const handle = await fs.open(filename, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Select a regular JSON file.');
    const buffer = Buffer.alloc(LIMIT + 1); let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    if (offset > LIMIT) throw new Error('Configuration exceeds the 2 MiB limit.');
    return JSON.parse(buffer.subarray(0, offset).toString('utf8'));
  } finally { await handle.close(); }
}
async function atomic(filename: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
}
function fingerprint(provider: Provider, model: ModelBinding): string {
  return createHash('sha256').update(JSON.stringify({ provider, model })).digest('hex');
}
function emptyLibrary(): StoredLibrary { return { secretSlots: {}, schemaVersion: '1.0', revision: 0, providers: [], profiles: [], diagnostics: [] }; }

/** All mutations are serialised and revision-checked; secrets never cross back into the renderer. */
export class ProviderRegistry {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly active = new Map<string, AbortController>();
  constructor(private readonly directory: string, private readonly vault: CredentialVault, private readonly fetcher: ProviderFetch) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action); this.queue = next.catch(() => undefined); return next;
  }
  private async load(): Promise<StoredLibrary> {
    let raw: any;
    try { raw = await readBoundedJson(path.join(this.directory, 'model-providers.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLibrary(); throw error; }
    if (raw?.schemaVersion !== '1.0' || !Number.isInteger(raw.revision) || !Array.isArray(raw.providers) || !Array.isArray(raw.profiles) || !Array.isArray(raw.diagnostics) || raw.providers.length > 100 || raw.profiles.length > 100) throw new Error('Unsupported provider library format.');
    const providers = raw.providers.map(validateProvider) as Provider[];
    const profiles = raw.profiles.map((p: unknown) => validateProfile(p, providers, false)) as ModelProfile[];
    if (new Set(providers.map((p) => p.id)).size !== providers.length || new Set(profiles.map((p) => p.id)).size !== profiles.length) throw new Error('Duplicate provider or profile IDs.');
    const diagnostics = (raw.diagnostics as ModelDiagnostic[]).filter((d) => {
      const model = profiles.find((p) => p.id === d.profileId)?.models.find((m) => m.id === d.modelId);
      const provider = providers.find((p) => p.id === model?.providerId);
      return model && provider && d.fingerprint === fingerprint(provider, model) && Array.isArray(d.results);
    });
    const secretSlots = raw.secretSlots ?? {};
    if (!secretSlots || typeof secretSlots !== 'object' || Array.isArray(secretSlots) || Object.values(secretSlots).some((v) => typeof v !== 'string')) throw new Error('Invalid credential references.');
    return { schemaVersion: '1.0', revision: raw.revision, providers, profiles, diagnostics, secretSlots };
  }
  private async secrets(): Promise<Record<string, string>> {
    let bytes: Buffer;
    try { bytes = await fs.readFile(path.join(this.directory, 'model-providers.secrets')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
    if (!this.vault.available()) throw new Error('Secure credential storage is unavailable. Unlock or configure the operating-system keyring.');
    const value = JSON.parse(this.vault.decrypt(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((v) => typeof v !== 'string')) throw new Error('Invalid credential vault.');
    return value;
  }
  private async saveSecrets(values: Record<string, string>) {
    if (!this.vault.available()) throw new Error('Secure credential storage is unavailable; credentials were not saved.');
    await atomic(path.join(this.directory, 'model-providers.secrets'), this.vault.encrypt(JSON.stringify(values)));
  }
  private async view(library: StoredLibrary): Promise<ProviderLibraryView> {
    // Metadata remains usable when a keyring is temporarily locked. Probes fail explicitly.
    let keys: Record<string, string> = {};
    if (this.vault.available()) keys = await this.secrets();
    const { secretSlots, ...publicLibrary } = library;
    return { ...publicLibrary, credentials: Object.fromEntries(library.providers.map((p) => [p.id, Boolean(keys[secretSlots[p.id]])])) };
  }
  list(): Promise<ProviderLibraryView> { return this.serialize(async () => this.view(await this.load())); }
  private assertRevision(library: ProviderLibrary, expected: number) {
    if (library.revision !== expected) throw new Error('Configuration changed in another window. Refresh before saving; your draft is preserved.');
  }
  private async persist(library: StoredLibrary): Promise<ProviderLibraryView> {
    library.revision += 1;
    const content = JSON.stringify(library, null, 2) + '\n';
    if (Buffer.byteLength(content) > LIMIT) throw new Error('Provider library exceeds the 2 MiB limit. Remove unused profiles.');
    await atomic(path.join(this.directory, 'model-providers.json'), content);
    return this.view(library);
  }
  saveProvider(request: SaveProviderRequest): Promise<ProviderLibraryView> {
    return this.serialize(async () => {
      const provider = validateProvider(request.provider); const library = await this.load(); this.assertRevision(library, request.expectedRevision);
      const providers = [...library.providers.filter((p) => p.id !== provider.id), provider];
      if (providers.length > 100) throw new Error('Provider limit reached.');
      library.profiles.forEach((p) => validateProfile(p, providers, false));
      if (request.secret !== undefined && (typeof request.secret !== 'string' || request.secret.length > 16384 || /[\r\n\0]/.test(request.secret))) throw new Error('Credential must be a single bounded value.');
      if (request.secret?.trim() && provider.auth.mode === 'none') throw new Error('Choose authentication before saving a credential.');
      const previousSlots = { ...library.secretSlots };
      if (request.clearSecret || provider.auth.mode === 'none') delete library.secretSlots[provider.id];
      if (request.secret?.trim()) {
        const values = await this.secrets();
        const slot = randomUUID();
        // New immutable slot first, metadata pointer last: a failed metadata save
        // cannot change the credential used by the previous configuration.
        const retained = Object.fromEntries(Object.values(previousSlots).filter((key) => values[key]).map((key) => [key, values[key]]));
        retained[slot] = request.secret.trim();
        await this.saveSecrets(retained);
        library.secretSlots[provider.id] = slot;
      }
      library.providers = providers;
      library.diagnostics = library.diagnostics.filter((d) => !library.profiles.find((p) => p.id === d.profileId)?.models.some((m) => m.id === d.modelId && m.providerId === provider.id));
      return this.persist(library);
    });
  }
  saveProfile(request: SaveProfileRequest): Promise<ProviderLibraryView> {
    return this.serialize(async () => {
      const library = await this.load(); this.assertRevision(library, request.expectedRevision);
      const profile = validateProfile(request.profile, library.providers, false);
      library.profiles = [...library.profiles.filter((p) => p.id !== profile.id), profile];
      if (library.profiles.length > 100) throw new Error('Profile limit reached.');
      library.diagnostics = library.diagnostics.filter((d) => d.profileId !== profile.id);
      return this.persist(library);
    });
  }
  remove(kind: 'provider' | 'profile', id: string, expectedRevision: number): Promise<ProviderLibraryView> {
    return this.serialize(async () => {
      const library = await this.load(); this.assertRevision(library, expectedRevision);
      if (kind === 'provider') {
        if (library.profiles.some((p) => p.models.some((m) => m.providerId === id))) throw new Error('Provider is referenced by a profile. Remove those model bindings first.');
        delete library.secretSlots[id];
        library.providers = library.providers.filter((p) => p.id !== id);
      } else if (kind === 'profile') {
        library.profiles = library.profiles.filter((p) => p.id !== id); library.diagnostics = library.diagnostics.filter((d) => d.profileId !== id);
      } else throw new Error('Unknown configuration kind.');
      return this.persist(library);
    });
  }
  exportProfile(id: string, expectedRevision: number): Promise<RuntimeConfiguration> {
    return this.serialize(async () => {
      const library = await this.load(); this.assertRevision(library, expectedRevision);
      const profile = library.profiles.find((p) => p.id === id);
      if (!profile) throw new Error('Profile not found.');
      return exportConfiguration(profile, library.providers);
    });
  }
  importProfile(value: unknown, expectedRevision: number): Promise<ProviderLibraryView> {
    return this.serialize(async () => {
      const configuration = validateConfiguration(value); const library = await this.load(); this.assertRevision(library, expectedRevision);
      if (library.providers.length + configuration.providers.length > 100 || library.profiles.length >= 100) throw new Error('Import would exceed the configuration limit.');
      // Fresh local IDs prevent an imported file from binding to credentials already in the vault.
      const providerIds = new Map(configuration.providers.map((p) => [p.id, randomUUID()]));
      const modelIds = new Map(configuration.profile.models.map((m) => [m.id, randomUUID()]));
      library.providers.push(...configuration.providers.map((p) => ({ ...p, id: providerIds.get(p.id)! })));
      library.profiles.push({ ...configuration.profile, id: randomUUID(), name: `${configuration.profile.name.slice(0, 109)} (imported)`,
        models: configuration.profile.models.map((m) => ({ ...m, id: modelIds.get(m.id)!, providerId: providerIds.get(m.providerId)! })),
        routes: configuration.profile.routes.map((r) => ({ ...r, models: r.models.map((id) => modelIds.get(id)!) })) });
      return this.persist(library);
    });
  }
  async discover(providerId: string) {
    const { provider, secret } = await this.serialize(async () => {
      const library = await this.load();
      const provider = library.providers.find((p) => p.id === providerId);
      if (!provider) throw new Error('Save the provider before discovering models.');
      return { provider, secret: provider.auth.mode === 'none' ? undefined : (await this.secrets())[library.secretSlots[provider.id]] };
    });
    return discoverModels(this.fetcher, provider, secret);
  }
  cancel(operationId: string): boolean { const active = this.active.get(operationId); active?.abort(); return Boolean(active); }
  async probe(request: ProbeRequest, operationId: string): Promise<ProviderLibraryView> {
    if (!/^[a-z0-9-]{1,80}$/.test(operationId) || this.active.has(operationId)) throw new Error('Invalid or duplicate probe operation.');
    if (!Array.isArray(request.kinds) || !request.kinds.length || request.kinds.length > 4 || request.kinds.some((k) => !PROBE_KINDS.includes(k)) || new Set(request.kinds).size !== request.kinds.length) throw new Error('Choose one or more supported diagnostic probes.');
    const controller = new AbortController(); this.active.set(operationId, controller);
    try {
      const snapshot = await this.serialize(async () => {
        const library = await this.load(); const model = library.profiles.find((p) => p.id === request.profileId)?.models.find((m) => m.id === request.modelId);
        const provider = library.providers.find((p) => p.id === model?.providerId);
        if (!model || !provider) throw new Error('Save the model profile before testing.');
        return { revision: library.revision, model, provider, secret: provider.auth.mode === 'none' ? undefined : (await this.secrets())[library.secretSlots[provider.id]] };
      });
      const results: ProbeResult[] = [];
      for (const kind of request.kinds) {
        if (controller.signal.aborted) break;
        results.push(await probeModel(this.fetcher, snapshot.provider, snapshot.model, kind, snapshot.secret, controller.signal));
      }
      return await this.serialize(async () => {
        const library = await this.load(); this.assertRevision(library, snapshot.revision);
        const previous = library.diagnostics.find((d) => d.profileId === request.profileId && d.modelId === request.modelId);
        const resultKinds = new Set(results.map((r) => r.kind));
        const diagnostic = { profileId: request.profileId, modelId: request.modelId, fingerprint: fingerprint(snapshot.provider, snapshot.model), results: [...(previous?.results ?? []).filter((r) => !resultKinds.has(r.kind)), ...results] };
        library.diagnostics = [...library.diagnostics.filter((d) => d !== previous), diagnostic];
        return this.persist(library);
      });
    } finally { this.active.delete(operationId); }
  }
}
