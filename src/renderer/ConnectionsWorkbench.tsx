import { useEffect, useMemo, useState } from 'react';
import type {
  ConnectionId,
  ConnectionSummary,
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

const IDS: ConnectionId[] = ['jira-atc', 'confluence-atc', 'bmw-llm'];

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
  if (id === 'jira-atc') return 'Used by agents that declare ATC_JIRA_TOKEN or ATC_JIRA_URL.';
  if (id === 'confluence-atc') return 'Used by agents that declare ATC_CONFLUENCE_TOKEN or ATC_CONFLUENCE_URL.';
  return 'Internal model endpoint, deployment/model name and authentication settings.';
}

function secretLabel(id: ConnectionId): string {
  return id === 'bmw-llm' ? 'API token' : 'Personal access token';
}

export function ConnectionsWorkbench() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ConnectionId, ConnectionDraft>>>({});
  const [busyId, setBusyId] = useState<ConnectionId | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const byId = useMemo(
    () => Object.fromEntries(connections.map((connection) => [connection.id, connection])) as Partial<Record<ConnectionId, ConnectionSummary>>,
    [connections]
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
    Promise.all([window.agentPipeline.getSystemInfo(), window.agentPipeline.listConnections()])
      .then(([info, configured]) => {
        setSystem(info);
        applyConnections(configured);
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
      model: id === 'bmw-llm' ? draft.model : undefined,
      authHeader: draft.authHeader,
      authScheme: draft.authScheme,
      secret: draft.secret || undefined
    };
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
    <div className="app-shell connections-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL AGENT WORKBENCH</span>
          <h1>Connections</h1>
          <p>Configure service credentials once and expose them only to approved agents that explicitly declare them.</p>
        </div>
        <div className="system-pill"><span className="status-dot" />{system ? `${system.platform} · ${system.arch} · v${system.appVersion}` : 'Loading system…'}</div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}

      <main className="connections-content">
        <div className="security-note">
          <strong>Secure storage</strong>
          <span>Tokens are encrypted by Electron safeStorage using the operating system credential service. Testing current values saves them securely first; saved secrets are never returned to this screen, written into repositories, or persisted in run records.</span>
        </div>

        <div className="connection-grid">
          {IDS.map((id) => {
            const summary = byId[id];
            const draft = drafts[id];
            if (!summary || !draft) return null;
            const busy = busyId === id;
            const hasTestableSecret = summary.configured || draft.secret.trim().length > 0;
            return (
              <section className="connection-card" key={id}>
                <div className="connection-heading">
                  <div>
                    <span className="eyebrow">{id === 'bmw-llm' ? 'MODEL PROVIDER' : 'SERVICE CONNECTION'}</span>
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

                {id === 'bmw-llm' && (
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

                {id === 'bmw-llm' && summary.configured && (
                  <div className="adapter-warning">The BMW endpoint is now configured and testable. Direct BMW LLM agent execution remains disabled until the controller-mediated HTTP tool loop is implemented.</div>
                )}

                <div className="connection-actions">
                  <button className="secondary" type="button" disabled={busy || !hasTestableSecret} onClick={() => test(id)}>Test current values</button>
                  <button className="secondary danger" type="button" disabled={busy || !summary.configured} onClick={() => remove(id)}>Remove</button>
                  <button className="primary" type="button" disabled={busy} onClick={() => save(id)}>{busy ? 'Working…' : 'Save securely'}</button>
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
