import { useEffect, useRef, useState } from 'react';
import { exportConfiguration, newModel, newProfile, newProvider, PROBE_KINDS, profileWarnings, PROTOCOLS, PROVIDER_PRESETS, ROLES, validateProfile, validateProvider } from '../shared/providers';
import type { ModelBinding, ModelProfile, Provider, ProviderLibraryView, RuntimeConfiguration } from '../shared/providers';
import './model-configuration.css';

const DRAFT_KEY = 'agent-pipeline-ui.model-configuration-draft.v1';
const EMPTY: ProviderLibraryView = { schemaVersion: '1.0', revision: 0, providers: [], profiles: [], diagnostics: [], credentials: {} };
function problem(action: () => unknown): string { try { action(); return ''; } catch (error) { return error instanceof Error ? error.message : String(error); } }
function restored(): { provider: Provider | null; profile: ModelProfile | null } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY); if (!raw || raw.length > 200000) return { provider: null, profile: null };
    const value = JSON.parse(raw);
    // Drafts may be incomplete. Validate shape with safe placeholders, retaining actual form text.
    let provider: Provider | null = null; let profile: ModelProfile | null = null;
    if (value.provider && !problem(() => validateProvider({ ...value.provider, name: value.provider.name || 'Draft', baseUrl: value.provider.baseUrl || 'https://example.invalid' }))) provider = value.provider;
    if (value.profile && !problem(() => {
      const models = value.profile.models.map((model: ModelBinding) => ({ ...model, name: model.name || 'Draft', model: model.model || 'Draft' }));
      const providers = [...new Set<string>(models.map((model: ModelBinding) => model.providerId))].map((id) => validateProvider(newProvider(id, 'ollama')));
      validateProfile({ ...value.profile, name: value.profile.name || 'Draft', models }, providers, false);
    })) profile = value.profile;
    return { provider, profile };
  } catch { return { provider: null, profile: null }; }
}
function pretty(value: unknown) { return JSON.stringify(value, null, 2); }

export function ModelConfiguration({ onBack }: { onBack: () => void }) {
  const [initial] = useState(restored);
  const [library, setLibrary] = useState<ProviderLibraryView>(EMPTY);
  const [provider, setProvider] = useState<Provider | null>(initial.provider);
  const [profile, setProfile] = useState<ModelProfile | null>(initial.profile);
  const [tab, setTab] = useState<'providers' | 'profiles'>('providers');
  const [secret, setSecret] = useState(''); const [clearSecret, setClearSecret] = useState(false);
  const [discovered, setDiscovered] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [imported, setImported] = useState<RuntimeConfiguration | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ kind: 'provider' | 'profile'; id: string } | null>(null);
  const operation = useRef<string | null>(null);
  useEffect(() => { setReviewed(false); }, [library.revision]);
  useEffect(() => {
    window.agentPipeline.listModelConfiguration().then((next) => { setLibrary(next); setLoaded(true); })
      .catch((reason) => setError(String(reason)));
    return () => { if (operation.current) void window.agentPipeline.cancelProviderProbe(operation.current); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ provider, profile })); }
    catch { setError('Draft could not be stored locally. Save your configuration before closing.'); }
  }, [provider, profile]);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const savedProvider = library.providers.find((p) => p.id === provider?.id);
  const savedProfile = library.profiles.find((p) => p.id === profile?.id);
  const providerDirty = pretty(provider) !== pretty(savedProvider) || Boolean(secret) || clearSecret;
  const profileDirty = pretty(profile) !== pretty(savedProfile);
  const providerError = provider ? problem(() => validateProvider(provider)) : '';
  const profileError = profile ? problem(() => validateProfile(profile, library.providers, false)) : '';
  const exportError = profile ? problem(() => exportConfiguration(profile, library.providers)) : '';
  function chooseProvider(next: Provider) { setProvider(structuredClone(next)); setSecret(''); setClearSecret(false); }
  function editProvider(patch: Partial<Provider>) { setProvider((p) => p ? { ...p, ...patch } : p); setReviewed(false); }
  function editProfile(next: ModelProfile) { setProfile(next); setReviewed(false); }
  function editModel(id: string, patch: Partial<ModelBinding>) {
    if (profile) editProfile({ ...profile, models: profile.models.map((m) => m.id === id ? { ...m, ...patch } : m) });
  }
  function editRoute(role: string, models: string[]) {
    if (profile) editProfile({ ...profile, routes: profile.routes.map((r) => r.role === role ? { ...r, models } : r) });
  }
  async function runProbes(modelId: string, kinds = PROBE_KINDS) {
    if (!profile) return;
    const operationId = crypto.randomUUID(); operation.current = operationId;
    try { setLibrary(await window.agentPipeline.probeProviderModel({ profileId: profile.id, modelId, kinds, operationId })); setMessage('Diagnostics completed. Results describe only the probes performed.'); }
    finally { operation.current = null; }
  }
  function routeEditor(role: typeof ROLES[number]) {
    const route = profile!.routes.find((r) => r.role === role)!;
    return <div className="model-route" key={role}>
      <label htmlFor={`route-${role}`}>{role.replaceAll('_', ' ')}</label>
      <div><select id={`route-${role}`} value={route.models[0] ?? ''} onChange={(event) => editRoute(role, event.target.value ? [event.target.value, ...route.models.slice(1).filter((id) => id !== event.target.value)] : [])}>
        <option value="">Choose primary model</option>{profile!.models.map((m) => <option key={m.id} value={m.id}>{m.name || m.model}</option>)}
      </select>
      {route.models.slice(1).map((id, index) => <div className="fallback-row" key={id}><span>Fallback {index + 1}: {profile!.models.find((m) => m.id === id)?.name}</span>
        {index > 0 && <button type="button" aria-label={`Move fallback ${index + 1} up for ${role}`} onClick={() => { const next = [...route.models]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; editRoute(role, next); }}>↑</button>}
        <button type="button" aria-label={`Remove fallback ${index + 1} for ${role}`} onClick={() => editRoute(role, route.models.filter((m) => m !== id))}>Remove</button></div>)}
      {route.models.length > 0 && route.models.length < 10 && <select aria-label={`Add fallback for ${role}`} value="" onChange={(event) => { if (event.target.value) editRoute(role, [...route.models, event.target.value]); }}>
        <option value="">Add explicit fallback…</option>{profile!.models.filter((m) => !route.models.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name || m.model}</option>)}
      </select>}</div>
    </div>;
  }
  return <div className="task-shell models-shell">
    <header className="task-header"><div><span className="task-kicker">PIPELINE CONFIGURATION</span><h1>Models, providers and routing</h1><p>Connect your services, check individual models and prepare reusable configurations.</p></div><button disabled={busy} onClick={onBack}>Back to workbench</button></header>
    <div className="models-toolbar"><div role="tablist" aria-label="Model configuration sections">
      <button role="tab" aria-selected={tab === 'providers'} disabled={busy} onClick={() => setTab('providers')}>1 · Providers</button>
      <button role="tab" aria-selected={tab === 'profiles'} disabled={busy} onClick={() => setTab('profiles')}>2 · Profiles & routing</button></div>
      <button disabled={busy} onClick={() => void act(async () => { setLibrary(await window.agentPipeline.listModelConfiguration()); setLoaded(true); setMessage('Saved configuration refreshed. Drafts were preserved; review changes before saving.'); })}>Refresh</button>
      <button disabled={busy || !loaded} onClick={() => void act(async () => setImported(await window.agentPipeline.selectModelConfiguration()))}>Import profile</button>
    </div>
    {error && <div role="alert" className="task-alert error">{error}</div>}
    {message && <div role="status" className="task-alert info">{message}</div>}
    <p className="model-boundary">Configuration and diagnostic probes only. The pipeline retains execution, independent verification and approval. HTTP execution adapters are not installed by this screen.</p>
    {!loaded && <p role="status">Loading saved configuration…</p>}
    {tab === 'providers' ? <div className="models-layout"><aside className="models-sidebar"><h2>Saved providers</h2>
      {library.providers.map((p) => <button disabled={busy} className={provider?.id === p.id ? 'selected' : ''} key={p.id} onClick={() => chooseProvider(p)}><strong>{p.name}</strong><small>{p.locality} · {p.auth.mode === 'none' ? 'No authentication' : library.credentials[p.id] ? 'Credential saved' : 'Credential needed'}</small></button>)}
      <h3>Add a provider</h3><div className="provider-presets">{Object.entries(PROVIDER_PRESETS).map(([key, preset]) => <button disabled={busy} key={key} onClick={() => chooseProvider(newProvider(crypto.randomUUID(), key))}>{preset.label}</button>)}</div>
    </aside><main className="model-panel">{!provider ? <div className="models-empty"><h2>Start with a provider</h2><p>Choose a preset or a custom gateway. You can add several providers and use several models from each.</p><p>Existing CLI runtimes and the legacy connection remain available in Connections.</p></div> : <>
      <div className="model-panel-heading"><h2>{provider.name || 'New provider'}</h2><span className="model-badge">{providerDirty ? 'Unsaved draft' : 'Saved'}</span></div>
      <fieldset disabled={busy || !loaded}><legend>Connection</legend><div className="model-fields">
        <label>Name<input value={provider.name} maxLength={120} onChange={(e) => editProvider({ name: e.target.value })} /></label>
        <label>API protocol<select value={provider.protocol} onChange={(e) => editProvider({ protocol: e.target.value as Provider['protocol'] })}>{PROTOCOLS.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="wide">API base URL<input value={provider.baseUrl} placeholder="https://your-gateway.example/v1" onChange={(e) => editProvider({ baseUrl: e.target.value })} /><small>Include the API version/path prefix. No API keys in URLs.</small></label>
        <label>Service locality<select value={provider.locality} onChange={(e) => editProvider({ locality: e.target.value as Provider['locality'], allowInsecureHttp: false })}><option value="external">External / cloud</option><option value="local">Local / self-hosted</option></select></label>
        <label>Authentication<select value={provider.auth.mode} onChange={(e) => { const mode = e.target.value as Provider['auth']['mode']; editProvider({ auth: { ...provider.auth, mode, credentialRef: mode === 'none' ? null : provider.auth.credentialRef ?? `env:LLM_${provider.id.replaceAll('-', '_').toUpperCase()}_KEY` } }); setSecret(''); }}><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">Custom API-key header</option></select></label>
        {provider.auth.mode !== 'none' && <><label>Credential reference<input value={provider.auth.credentialRef ?? ''} onChange={(e) => editProvider({ auth: { ...provider.auth, credentialRef: e.target.value } })} /><small>Environment name used by the pipeline, e.g. env:OPENAI_API_KEY.</small></label>
          {provider.auth.mode === 'header' && <label>Authentication header<input value={provider.auth.header} onChange={(e) => editProvider({ auth: { ...provider.auth, header: e.target.value } })} /></label>}
          <label>API key / token<input type="password" autoComplete="new-password" value={secret} placeholder={library.credentials[provider.id] ? 'Saved securely · leave blank to retain' : 'Enter credential'} onChange={(e) => setSecret(e.target.value)} /><small>Kept in the operating-system protected vault; never exported.</small></label>
          {library.credentials[provider.id] && <label className="model-checkbox"><input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />Remove the saved credential</label>}</>}
      </div><details><summary>Advanced connection settings</summary><div className="model-fields">
        <label>Timeout (milliseconds)<input type="number" min={1000} max={120000} value={provider.timeoutMs} onChange={(e) => editProvider({ timeoutMs: Number(e.target.value) })} /></label>
        <label>Discovery retries<input type="number" min={0} max={2} value={provider.discoveryRetries} onChange={(e) => editProvider({ discoveryRetries: Number(e.target.value) })} /><small>Transient discovery failures only. Generation probes are never retried.</small></label>
        {provider.locality === 'local' && <label className="model-checkbox wide"><input type="checkbox" checked={provider.allowInsecureHttp} onChange={(e) => editProvider({ allowInsecureHttp: e.target.checked })} />Allow HTTP to this self-hosted service beyond localhost</label>}
      </div><p>API probes use the operating-system certificate trust and the proxy settings in Connections. Selected CA files apply to CLI runtimes. Locality is your declaration; check whether a gateway forwards to the cloud.</p></details></fieldset>
      {providerError && <p className="model-validation">{providerError}</p>}
      <div className="model-actions"><button className="primary" disabled={busy || !loaded || !!providerError || !providerDirty} onClick={() => void act(async () => { const next = await window.agentPipeline.saveModelProvider({ expectedRevision: library.revision, provider, secret: secret || undefined, clearSecret }); setLibrary(next); chooseProvider(next.providers.find((p) => p.id === provider.id)!); setMessage('Provider saved. Discover models or enter a model ID in a profile.'); })}>Save provider</button>
        <button disabled={busy || providerDirty || !savedProvider} onClick={() => void act(async () => { const result = await window.agentPipeline.discoverProviderModels(provider.id); setDiscovered((current) => ({ ...current, [provider.id]: result.models })); setMessage(`${result.models.length} model IDs found${result.truncated ? ' (list truncated)' : ''}. ${result.message}`); })}>Discover models</button>
        {savedProvider && <button disabled={busy} onClick={() => setRemoveTarget({ kind: 'provider', id: provider.id })}>Delete provider</button>}
      </div>
      {discovered[provider.id] && <section><h3>Advertised models</h3><div className="discovered-models">{discovered[provider.id].map((id) => <button disabled={busy} key={id} onClick={() => { const current = profile ?? newProfile(crypto.randomUUID(), 'Default profile'); const model = { ...newModel(crypto.randomUUID(), provider.id), name: id, model: id }; editProfile({ ...current, models: [...current.models, model], routes: current.routes.map((r) => r.models.length ? r : { ...r, models: [model.id] }) }); setTab('profiles'); }}>{id} +</button>)}</div><p>Adding a model creates a draft binding. It does not invoke the model.</p></section>}
      <details><summary>Review provider changes</summary><div className="config-comparison"><pre>{pretty(savedProvider ?? {})}</pre><pre>{pretty(provider)}</pre></div></details>
    </>}</main></div> : <div className="models-layout"><aside className="models-sidebar"><h2>Saved profiles</h2>{library.profiles.map((p) => <button disabled={busy} key={p.id} className={profile?.id === p.id ? 'selected' : ''} onClick={() => editProfile(structuredClone(p))}><strong>{p.name}</strong><small>{p.projectId ?? 'Reusable'} · {p.localOnly ? 'Local only' : 'Cloud permitted'}</small></button>)}
      <button disabled={busy} onClick={() => editProfile(newProfile(crypto.randomUUID()))}>+ New profile</button>
    </aside><main className="model-panel">{!profile ? <div className="models-empty"><h2>Create a model profile</h2><p>Add models from saved providers, then assign a default and adjust individual roles.</p></div> : <>
      <div className="model-panel-heading"><h2>{profile.name || 'New profile'}</h2><span className="model-badge">{profileDirty ? 'Unsaved draft' : 'Saved'}</span></div>
      <fieldset disabled={busy || !loaded}><legend>Profile</legend><div className="model-fields"><label>Name<input value={profile.name} onChange={(e) => editProfile({ ...profile, name: e.target.value })} /></label><label>Project ID (optional)<input value={profile.projectId ?? ''} onChange={(e) => editProfile({ ...profile, projectId: e.target.value || null })} /></label><label className="model-checkbox wide"><input type="checkbox" checked={profile.localOnly} onChange={(e) => editProfile({ ...profile, localOnly: e.target.checked })} />Local only — reject external models and fallbacks</label></div>
      <h3>Models in this profile</h3>{profile.models.map((model) => <section className="model-binding" key={model.id}>
        <div className="model-fields"><label>Label<input value={model.name} onChange={(e) => editModel(model.id, { name: e.target.value })} /></label>
          <label>Provider<select value={model.providerId} onChange={(e) => editModel(model.id, { providerId: e.target.value })}>{library.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="wide">Model ID / deployment name<input list={`models-${model.id}`} value={model.model} onChange={(e) => editModel(model.id, { model: e.target.value })} placeholder="Choose a discovered model or enter its exact ID" /><datalist id={`models-${model.id}`}>{(discovered[model.providerId] ?? []).map((id) => <option key={id} value={id} />)}</datalist></label>
        </div><details><summary>Model parameters</summary><div className="model-fields">
          <label>Maximum output tokens<input type="number" min={1} value={model.maxOutputTokens} onChange={(e) => editModel(model.id, { maxOutputTokens: Number(e.target.value) })} /></label>
          <label>Context budget (optional)<input type="number" min={1} value={model.contextWindow ?? ''} onChange={(e) => editModel(model.id, { contextWindow: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>Temperature (optional)<input type="number" min={0} max={2} step={0.1} value={model.temperature ?? ''} onChange={(e) => editModel(model.id, { temperature: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>Reasoning effort (optional)<input value={model.reasoningEffort ?? ''} placeholder="Provider/model-supported value" onChange={(e) => editModel(model.id, { reasoningEffort: e.target.value || null })} /></label>
        </div><p>Blank parameters use provider defaults. A context budget does not increase the model's actual context window. Provider rejections appear in probe results; a passing probe cannot detect parameters a server silently ignores.</p></details>
        <div className="model-actions"><button type="button" onClick={() => editProfile({ ...profile, routes: profile.routes.map((r) => ({ ...r, models: [model.id] })) })}>Use as default for all roles</button><button type="button" onClick={() => editProfile({ ...profile, models: profile.models.filter((m) => m.id !== model.id), routes: profile.routes.map((r) => ({ ...r, models: r.models.filter((id) => id !== model.id) })) })}>Remove binding</button></div>
      </section>)}
      <button type="button" disabled={!library.providers.length} onClick={() => editProfile({ ...profile, models: [...profile.models, newModel(crypto.randomUUID(), library.providers[0].id)] })}>+ Add model</button>
      {!library.providers.length && <p>Save a provider first.</p>}
      <h3>Role routing</h3><p>The first model is primary; fallbacks are tried in the displayed order only by a compatible governed adapter.</p>{ROLES.slice(0, 9).map(routeEditor)}
      <details><summary>Specialist roles</summary>{ROLES.slice(9).map(routeEditor)}</details></fieldset>
      {profileError && <p className="model-validation">{profileError}</p>}
      <div className="model-actions"><button className="primary" disabled={busy || !loaded || !!profileError || !profileDirty} onClick={() => void act(async () => { const next = await window.agentPipeline.saveModelProfile({ expectedRevision: library.revision, profile }); setLibrary(next); editProfile(next.profiles.find((p) => p.id === profile.id)!); setMessage('Profile saved. Incomplete routes can be saved as a draft but cannot be exported.'); })}>Save profile</button>
        <button disabled={busy} onClick={() => editProfile({ ...structuredClone(profile), id: crypto.randomUUID(), name: `${profile.name.slice(0, 113)} (copy)` })}>Duplicate</button>
        {savedProfile && <button disabled={busy} onClick={() => setRemoveTarget({ kind: 'profile', id: profile.id })}>Delete profile</button>}
      </div>
      <section className="model-tests"><h3>Diagnostics</h3><p>Explicit tests send fixed synthetic prompts only, capped at 512 output tokens per probe. They may incur provider charges. Tool-call probes never execute tools.</p>
        {profileDirty && <p>Save changes before testing. Editing configuration clears previous test results.</p>}
        {profile.models.map((model) => { const diagnostic = library.diagnostics.find((d) => d.profileId === profile.id && d.modelId === model.id); return <div className="model-diagnostic" key={model.id}><strong>{model.name}</strong><button disabled={busy || profileDirty || !savedProfile} onClick={() => void act(() => runProbes(model.id))}>Test all four capabilities</button>
          <ul>{PROBE_KINDS.map((kind) => { const result = !profileDirty ? diagnostic?.results.find((r) => r.kind === kind) : undefined; return <li key={kind}><span className={`model-badge ${result?.status ?? ''}`}>{kind}: {result?.status ?? 'untested'}</span>{result && <small>{result.message} · {result.latencyMs} ms · {new Date(result.testedAt).toLocaleString()}</small>}<button disabled={busy || profileDirty || !savedProfile} onClick={() => void act(() => runProbes(model.id, [kind]))}>Test</button></li>; })}</ul>
        </div>; })}
        {busy && operation.current && <button onClick={() => { if (operation.current) void window.agentPipeline.cancelProviderProbe(operation.current); }}>Cancel diagnostics</button>}
      </section>
      <section><h3>Review and export</h3><ul>{profileWarnings(profile, library.providers).map((warning) => <li key={warning}>{warning}</li>)}</ul>
        {exportError ? <p className="model-validation">{exportError}</p> : <details><summary>Preview secret-free runtime configuration</summary><pre>{pretty(exportConfiguration(profile, library.providers))}</pre></details>}
        <details><summary>Compare saved profile and draft</summary><div className="config-comparison"><pre>{pretty(savedProfile ?? {})}</pre><pre>{pretty(profile)}</pre></div></details>
        <label className="model-checkbox"><input type="checkbox" disabled={busy || profileDirty || !!exportError} checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed the models, locality and fallback order.</label>
        <button disabled={busy || profileDirty || !!exportError || !reviewed} onClick={() => void act(async () => { const filename = await window.agentPipeline.exportModelConfiguration({ profileId: profile.id, expectedRevision: library.revision }); if (filename) setMessage(`Exported ${filename}. Supply credentials separately and validate with the pipeline before use.`); })}>Export reviewed profile</button>
        <pre>python3 scripts/validate-runtime-configuration.py /path/to/runtime-configuration.json</pre>
      </section>
    </>}</main></div>}
    {imported && <div className="model-overlay"><section role="dialog" aria-modal="true" aria-labelledby="import-title" className="model-dialog"><h2 id="import-title">Review imported configuration</h2><p>This adds {imported.providers.length} providers and a new profile. Existing configurations are preserved. Credentials and diagnostic results are not imported.</p><pre>{pretty(imported)}</pre><div className="model-actions"><button disabled={busy} onClick={() => setImported(null)}>Cancel</button><button className="primary" disabled={busy} onClick={() => void act(async () => { const next = await window.agentPipeline.importModelConfiguration({ configuration: imported, expectedRevision: library.revision }); setLibrary(next); editProfile(next.profiles.at(-1)!); setTab('profiles'); setImported(null); setMessage('Imported as a new profile. Configure credentials for its providers before testing.'); })}>Import as new profile</button></div></section></div>}
    {removeTarget && <div className="model-overlay"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="model-dialog"><h2 id="delete-title">Delete saved {removeTarget.kind}?</h2><p>Other profiles will be preserved. Providers still used by a profile cannot be deleted.</p><div className="model-actions"><button disabled={busy} onClick={() => setRemoveTarget(null)}>Cancel</button><button disabled={busy} onClick={() => void act(async () => { setLibrary(await window.agentPipeline.removeModelConfiguration({ ...removeTarget, expectedRevision: library.revision })); if (removeTarget.kind === 'provider' && provider?.id === removeTarget.id) setProvider(null); if (removeTarget.kind === 'profile' && profile?.id === removeTarget.id) setProfile(null); setRemoveTarget(null); setMessage('Configuration removed.'); })}>Delete</button></div></section></div>}
  </div>;
}
