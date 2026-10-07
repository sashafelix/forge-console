import { useEffect, useMemo, useState } from 'react';
import { useConsoleTheme } from './useConsoleTheme';
import './forge-cockpit.css';
import './connections.css';
import type {
  ConnectionId,
  ConnectionSummary,
  NetworkProxyMode,
  NetworkSettings,
  ProcessRuntimeId,
  RuntimeAdapterDescriptor,
  RuntimeConnectionTestResult,
  SaveConnectionRequest,
  SystemInfo
} from '../shared/contracts';

interface ConnectionDraft {
  serviceUrl: string;
  model: string;
  authHeader: string;
  authScheme: 'bearer' | 'raw';
  secret: string;
}

const IDS: ConnectionId[] = ['jira', 'confluence', 'self-hosted-llm'];
const DEFAULT_NETWORK: NetworkSettings = {
  proxyMode: 'inherit',
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
  caCertificatePath: ''
};

function draftFrom(summary: ConnectionSummary): ConnectionDraft {
  return {
    serviceUrl: summary.serviceUrl,
    model: summary.model ?? '',
    authHeader: summary.authHeader,
    authScheme: summary.authScheme,
    secret: ''
  };
}

function description(id: ConnectionId): string {
  if (id === 'jira') return 'Used by agents that declare JIRA_TOKEN or JIRA_URL.';
  if (id === 'confluence') return 'Used by agents that declare CONFLUENCE_TOKEN or CONFLUENCE_URL.';
  return 'OpenAI-compatible self-hosted endpoint, model name and authentication settings.';
}

function secretLabel(id: ConnectionId): string {
  return id === 'self-hosted-llm' ? 'API token' : 'Personal access token';
}

function proxyModeLabel(mode: NetworkProxyMode): string {
  if (mode === 'inherit') return 'Inherit launcher environment';
  if (mode === 'system') return 'Use operating-system proxy';
  if (mode === 'manual') return 'Manual proxy';
  return 'Direct connection';
}

function providerName(runtimeId: ProcessRuntimeId): string {
  return runtimeId === 'claude-code' ? 'Claude Code' : 'GitHub Copilot';
}

export function ConnectionsWorkbench({ onBack }: { onBack: () => void }) {
  const [theme, setTheme] = useConsoleTheme();
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ConnectionId, ConnectionDraft>>>({});
  const [network, setNetwork] = useState<NetworkSettings>(DEFAULT_NETWORK);
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [providerTests, setProviderTests] = useState<Partial<Record<ProcessRuntimeId, RuntimeConnectionTestResult>>>({});
  const [busyId, setBusyId] = useState<ConnectionId | null>(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const byId = useMemo(
    () => Object.fromEntries(connections.map((connection) => [connection.id, connection])) as Partial<Record<ConnectionId, ConnectionSummary>>,
    [connections]
  );
  const processRuntimes = useMemo(
    () => runtimes.filter((runtime): runtime is RuntimeAdapterDescriptor & { id: ProcessRuntimeId } => runtime.kind === 'process' && (runtime.id === 'claude-code' || runtime.id === 'github-copilot')),
    [runtimes]
  );

  function applyConnections(next: ConnectionSummary[]): void {
    setConnections(next);
    setDrafts((current) => {
      const updated = { ...current };
      for (const connection of next) {
        const existing = current[connection.id];
        updated[connection.id] = existing
          ? { ...existing, serviceUrl: connection.serviceUrl, model: connection.model ?? '', authHeader: connection.authHeader, authScheme: connection.authScheme, secret: '' }
          : draftFrom(connection);
      }
      return updated;
    });
  }

  useEffect(() => {
    Promise.all([
      window.agentPipeline.getSystemInfo(),
      window.agentPipeline.listConnections(),
      window.agentPipeline.getSettings(),
      window.agentPipeline.listRuntimes()
    ])
      .then(([info, configured, settings, runtimeList]) => {
        setSystem(info);
        applyConnections(configured);
        setNetwork(settings.network);
        setRuntimes(runtimeList);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  function updateDraft(id: ConnectionId, patch: Partial<ConnectionDraft>): void {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { serviceUrl: '', model: '', authHeader: 'Authorization', authScheme: 'bearer', secret: '' }), ...patch }
    }));
  }

  function requestFromDraft(id: ConnectionId, draft: ConnectionDraft): SaveConnectionRequest {
    return {
      id,
      serviceUrl: draft.serviceUrl,
      model: id === 'self-hosted-llm' ? draft.model : undefined,
      authHeader: draft.authHeader,
      authScheme: draft.authScheme,
      secret: draft.secret || undefined
    };
  }

  async function saveNetwork(): Promise<void> {
    setNetworkBusy(true);
    setError('');
    setMessage('');
    try {
      const settings = await window.agentPipeline.saveNetworkSettings(network);
      setNetwork(settings.network);
      setProviderTests({});
      setMessage('Network and proxy settings saved. Provider readiness checks will use them immediately.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setNetworkBusy(false);
    }
  }

  async function chooseCaCertificate(): Promise<void> {
    try {
      const selected = await window.agentPipeline.selectNetworkCaCertificate();
      if (selected) setNetwork((current) => ({ ...current, caCertificatePath: selected }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function testProvider(runtimeId: ProcessRuntimeId): Promise<void> {
    setNetworkBusy(true);
    setError('');
    setMessage('');
    try {
      const settings = await window.agentPipeline.saveNetworkSettings(network);
      setNetwork(settings.network);
      const result = await window.agentPipeline.testRuntimeConnection(runtimeId);
      setProviderTests((current) => ({ ...current, [runtimeId]: result }));
      if (result.ok) setMessage(result.message);
      else setError(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setNetworkBusy(false);
    }
  }

  async function save(id: ConnectionId): Promise<void> {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      applyConnections(await window.agentPipeline.saveConnection(requestFromDraft(id, draft)));
      setMessage(`${byId[id]?.name ?? id} saved securely.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  }

  async function test(id: ConnectionId): Promise<void> {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await window.agentPipeline.saveConnection(requestFromDraft(id, draft));
      const result = await window.agentPipeline.testConnection(id);
      applyConnections(await window.agentPipeline.listConnections());
      if (result.ok) setMessage(`${byId[id]?.name ?? id}: ${result.message}.`);
      else setError(`${byId[id]?.name ?? id}: ${result.message}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: ConnectionId): Promise<void> {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      applyConnections(await window.agentPipeline.removeConnection(id));
      setMessage(`${byId[id]?.name ?? id} credentials removed.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="forge-cockpit connections-shell" data-theme={theme}>
      <header className="forge-header">
        <div className="forge-brand"><span aria-hidden="true">F</span><div><strong>Forge Console</strong><small>Connections & network</small></div></div>
        <div className="forge-header-actions">
          <label className="forge-theme"><span className="forge-sr">Colour theme</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="system">System theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <button type="button" onClick={onBack}>← Back to previous page</button>
        </div>
      </header>

      <main className="connections-content">
        <div className="forge-page-title"><div><span className="forge-eyebrow">WORKSPACE SETTINGS</span><h1 tabIndex={-1}>Connections</h1><p>Configure service credentials and the network route used by local AI providers.</p></div>
          {system && <small>{system.platform} · {system.arch} · v{system.appVersion}</small>}</div>
        {error && <div className="forge-alert error" role="alert">{error}</div>}
        {message && <div className="forge-alert success" role="status">{message}</div>}
        <div className="security-note">
          <strong>Secure storage</strong>
          <span>Tokens are encrypted by Electron safeStorage using the operating system credential service. Proxy URLs must not contain credentials. Saved secrets are never returned to this screen, written into repositories, or persisted in run records.</span>
        </div>

        <section className="connection-card network-card">
          <div className="connection-heading">
            <div>
              <span className="forge-eyebrow">NETWORK &amp; PROXY</span>
              <h2>Provider network route</h2>
              <p>Set the network route for coding assistants, service connections and model-provider probes.</p>
            </div>
            <span className={`connection-status ${network.proxyMode === 'inherit' ? 'missing' : 'configured'}`}>{proxyModeLabel(network.proxyMode)}</span>
          </div>

          <label className="field network-mode-field">
            <span>Proxy mode</span>
            <select aria-label="Proxy mode" disabled={networkBusy} value={network.proxyMode} onChange={(event) => setNetwork((current) => ({ ...current, proxyMode: event.target.value as NetworkProxyMode }))}>
              <option value="inherit">Inherit proxy variables from the shell that launched the app</option>
              <option value="system">Use the operating-system proxy / PAC configuration</option>
              <option value="manual">Use manually configured proxy URLs</option>
              <option value="direct">Connect directly without a proxy</option>
            </select>
            <small>Use “inherit” when starting the app from a terminal after configuring proxy variables. Use “system” for macOS or Windows PAC/WPAD settings.</small>
          </label>

          {network.proxyMode === 'manual' && (
            <div className="network-proxy-grid">
              <label className="field">
                <span>HTTP proxy</span>
                <input disabled={networkBusy} placeholder="http://proxy.example:8080" value={network.httpProxy} onChange={(event) => setNetwork((current) => ({ ...current, httpProxy: event.target.value }))} />
              </label>
              <label className="field">
                <span>HTTPS proxy</span>
                <input disabled={networkBusy} placeholder="http://proxy.example:8080" value={network.httpsProxy} onChange={(event) => setNetwork((current) => ({ ...current, httpsProxy: event.target.value }))} />
              </label>
            </div>
          )}

          <label className="field">
            <span>NO_PROXY / bypass hosts</span>
            <input disabled={networkBusy || network.proxyMode === 'direct'} placeholder="localhost,127.0.0.1,.example.internal" value={network.noProxy} onChange={(event) => setNetwork((current) => ({ ...current, noProxy: event.target.value }))} />
          </label>

          <div className="network-ca-row">
            <label className="field">
              <span>Corporate CA certificate bundle</span>
              <input disabled={networkBusy} placeholder="Optional .pem, .crt, or .cer file" value={network.caCertificatePath} onChange={(event) => setNetwork((current) => ({ ...current, caCertificatePath: event.target.value }))} />
              <small>Applied to provider child processes through NODE_EXTRA_CA_CERTS and SSL_CERT_FILE. Electron service tests continue to use the operating-system trust store.</small>
            </label>
            <button className="secondary" type="button" disabled={networkBusy} onClick={chooseCaCertificate}>Choose certificate</button>
          </div>

          <div className="provider-test-grid">
            {processRuntimes.map((runtime) => {
              const result = providerTests[runtime.id];
              return (
                <div className="provider-test" key={runtime.id}>
                  <div>
                    <strong>{runtime.name}</strong>
                    <span className={result ? (result.ok ? 'ok' : 'failed') : ''}>{result?.message ?? (runtime.status === 'available' ? 'Installed — not tested with these settings' : runtime.configurationHint ?? 'Unavailable')}</span>
                    {result && <small>{new Date(result.testedAt).toLocaleString()}</small>}
                  </div>
                  <button className="secondary" type="button" disabled={networkBusy || runtime.status !== 'available'} onClick={() => testProvider(runtime.id)}>{networkBusy ? 'Testing…' : `Test ${providerName(runtime.id)}`}</button>
                </div>
              );
            })}
          </div>

          <div className="network-actions">
            <button className="forge-primary" type="button" disabled={networkBusy} onClick={saveNetwork}>{networkBusy ? 'Applying…' : 'Save network settings'}</button>
          </div>
        </section>

        <div className="connection-grid">
          {IDS.map((id) => {
            const summary = byId[id];
            const draft = drafts[id];
            if (!summary || !draft) return null;
            const busy = busyId === id;
            const hasTestableSecret = summary.configured || draft.secret.trim().length > 0;
            return (
              <section className="connection-card" key={id} aria-label={summary.name}>
                <div className="connection-heading">
                  <div>
                    <span className="forge-eyebrow">{id === 'self-hosted-llm' ? 'MODEL PROVIDER' : 'SERVICE CONNECTION'}</span>
                    <h2>{summary.name}</h2>
                    <p>{description(id)}</p>
                  </div>
                  <span className={`connection-status ${summary.configured ? 'configured' : 'missing'}`}>
                    {summary.configured ? 'Configured' : 'Not configured'}
                  </span>
                </div>

                <label className="field">
                  <span>Service URL *</span>
                  <input value={draft.serviceUrl} disabled={busy} onChange={(event) => updateDraft(id, { serviceUrl: event.target.value })} />
                </label>

                {id === 'self-hosted-llm' && (
                  <label className="field">
                    <span>Model / deployment name *</span>
                    <input value={draft.model} disabled={busy} onChange={(event) => updateDraft(id, { model: event.target.value })} />
                  </label>
                )}

                <div className="connection-auth-grid">
                  <label className="field">
                    <span>Authentication header</span>
                    <input value={draft.authHeader} disabled={busy} onChange={(event) => updateDraft(id, { authHeader: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Authentication format</span>
                    <select value={draft.authScheme} disabled={busy} onChange={(event) => updateDraft(id, { authScheme: event.target.value as 'bearer' | 'raw' })}>
                      <option value="raw">Raw token</option>
                      <option value="bearer">Bearer token</option>
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>{secretLabel(id)}{summary.configured ? ' — leave blank to keep existing' : ' *'}</span>
                  <input type="password" autoComplete="new-password" value={draft.secret} disabled={busy} onChange={(event) => updateDraft(id, { secret: event.target.value })} />
                </label>

                <div className="connection-test-state">
                  <strong>Connection test</strong>
                  <span className={summary.lastTestStatus}>{summary.lastTestMessage ?? 'Not tested yet'}</span>
                  {summary.lastTestedAt && <small>{new Date(summary.lastTestedAt).toLocaleString()}</small>}
                </div>

                {id === 'self-hosted-llm' && summary.configured && (
                  <div className="adapter-warning">The endpoint is configured and testable. Direct Self hosted LLM agent execution remains disabled until the controller-mediated HTTP execution loop is implemented.</div>
                )}

                <div className="connection-actions">
                  <button className="secondary" type="button" disabled={busy || !hasTestableSecret} onClick={() => test(id)}>Test current values</button>
                  <button className="secondary danger" type="button" disabled={busy || !summary.configured} onClick={() => remove(id)}>Remove</button>
                  <button className="forge-primary" type="button" disabled={busy} onClick={() => save(id)}>{busy ? 'Working…' : 'Save securely'}</button>
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
