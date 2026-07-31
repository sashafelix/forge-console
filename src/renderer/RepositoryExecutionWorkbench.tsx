import { useEffect, useMemo, useState } from 'react';
import type {
  AgentDefinition,
  AgentExecutionRun,
  AgentLibrarySelection,
  ProcessRuntimeId,
  ProjectSelection,
  RunEvent,
  RuntimeAdapterDescriptor,
  SystemInfo
} from '../shared/contracts';

function statusLabel(status: RuntimeAdapterDescriptor['status']): string {
  return status === 'available' ? 'Ready' : status === 'unavailable' ? 'Unavailable' : 'Configure';
}

function isProcessRuntime(runtime: RuntimeAdapterDescriptor): runtime is RuntimeAdapterDescriptor & { id: ProcessRuntimeId } {
  return runtime.kind === 'process' && (runtime.id === 'claude-code' || runtime.id === 'github-copilot');
}

function isPipeline(definition: AgentDefinition): boolean {
  return /(?:^|[-_.])(orchestrator|pipeline)(?:$|[-_.])/i.test(definition.id)
    || /\b(?:orchestrates|orchestrator|full pipeline|stage transitions|invokable agents)\b/i.test(definition.description);
}

function definitionKey(definition: AgentDefinition): string {
  return `${definition.id}@${definition.relativePath}`;
}

function statusFromEvent(event: RunEvent): AgentExecutionRun['status'] | null {
  switch (event.type) {
    case 'run.started': return 'preparing';
    case 'approval.required': return 'awaiting_approval';
    case 'execution.started': return 'running';
    case 'validation.started':
    case 'validation.completed': return 'validating';
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.cancelled': return 'cancelled';
    default: return null;
  }
}

function readableEvent(event: RunEvent): string {
  if (!event.message.trim().startsWith('{')) return event.message;
  try {
    const value = JSON.parse(event.message) as Record<string, unknown>;
    const data = typeof value.data === 'object' && value.data !== null ? value.data as Record<string, unknown> : undefined;
    const content = typeof value.content === 'string' ? value.content : typeof data?.content === 'string' ? data.content : undefined;
    const message = typeof value.message === 'string' ? value.message : typeof data?.message === 'string' ? data.message : undefined;
    const status = typeof value.status === 'string' ? value.status : typeof data?.status === 'string' ? data.status : undefined;
    const serverName = typeof data?.serverName === 'string' ? data.serverName : undefined;
    if (content) return content;
    if (message) return message;
    if (serverName && status) return `MCP server ${serverName}: ${status}`;
    return typeof value.type === 'string' ? value.type.replaceAll('_', ' ') : event.message;
  } catch {
    return event.message;
  }
}

export function RepositoryExecutionWorkbench() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [library, setLibrary] = useState<AgentLibrarySelection | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [target, setTarget] = useState<ProjectSelection | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [runtimeId, setRuntimeId] = useState<ProcessRuntimeId>('claude-code');
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [run, setRun] = useState<AgentExecutionRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const definitions = library?.agents ?? [];
  const pipelines = useMemo(() => definitions.filter(isPipeline), [definitions]);
  const agents = useMemo(() => definitions.filter((definition) => !isPipeline(definition)), [definitions]);
  const selected = useMemo(() => definitions.find((definition) => definitionKey(definition) === selectedId) ?? null, [definitions, selectedId]);
  const processRuntimes = useMemo(() => runtimes.filter(isProcessRuntime), [runtimes]);
  const selectedRuntime = processRuntimes.find((runtime) => runtime.id === runtimeId) ?? null;
  const blocking = run?.status === 'preparing' || run?.status === 'awaiting_approval' || run?.status === 'running' || run?.status === 'validating' || busy;

  useEffect(() => {
    Promise.all([window.agentPipeline.getSystemInfo(), window.agentPipeline.listRuntimes()])
      .then(([info, runtimeList]) => {
        setSystem(info);
        setRuntimes(runtimeList);
        const available = runtimeList.find((runtime) => isProcessRuntime(runtime) && runtime.status === 'available');
        if (available && isProcessRuntime(available)) setRuntimeId(available.id);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => window.agentPipeline.onRunEvent((event) => {
    setEvents((current) => [...current, event].slice(-2_000));
    const status = statusFromEvent(event);
    if (!status) return;
    setRun((current) => current?.id === event.runId ? { ...current, status, updatedAt: event.timestamp } : current);
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      void window.agentPipeline.getAgentExecutionRun(event.runId).then((record) => record && setRun(record));
    }
  }), []);

  useEffect(() => {
    if (!selected || blocking) return;
    setInputs(Object.fromEntries(selected.inputs.map((input) => [input.name, ''])));
    setRun(null);
    setEvents([]);
    setApproved(false);
  }, [selectedId]);

  async function chooseWorkflowRepository(): Promise<void> {
    if (blocking) return;
    setError('');
    try {
      const selection = await window.agentPipeline.selectAgentLibrary();
      if (!selection) return;
      setLibrary(selection);
      setTarget(selection.source);
      const preferred = selection.agents.find(isPipeline) ?? selection.agents[0];
      setSelectedId(preferred ? definitionKey(preferred) : '');
      setRun(null);
      setEvents([]);
      setApproved(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function chooseTarget(): Promise<void> {
    if (blocking) return;
    const selection = await window.agentPipeline.selectProjectDirectory();
    if (selection) setTarget(selection);
  }

  async function refreshRuntimes(): Promise<void> {
    setBusy(true);
    try {
      setRuntimes(await window.agentPipeline.listRuntimes());
    } finally {
      setBusy(false);
    }
  }

  async function configureRuntime(): Promise<void> {
    if (!selectedRuntime || blocking) return;
    setBusy(true);
    try {
      setRuntimes(await window.agentPipeline.configureRuntimeExecutable(selectedRuntime.id));
    } finally {
      setBusy(false);
    }
  }

  async function prepare(): Promise<void> {
    if (!selected || !target || !selectedRuntime) return;
    setBusy(true);
    setError('');
    setEvents([]);
    setApproved(false);
    try {
      setRun(await window.agentPipeline.prepareAgentExecution({
        agentSourceRoot: selected.sourceRoot,
        agentRelativePath: selected.relativePath,
        agentId: selected.id,
        targetProject: target,
        runtimeId: selectedRuntime.id,
        inputs
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function start(): Promise<void> {
    if (!run || !approved || run.runtimePolicy.missingEnvironment.length > 0) return;
    setBusy(true);
    setError('');
    try {
      setRun(await window.agentPipeline.approveAndStartAgentExecution(run.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      const refreshed = await window.agentPipeline.getAgentExecutionRun(run.id);
      if (refreshed) setRun(refreshed);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!run) return;
    const cancelled = await window.agentPipeline.cancelAgentExecution(run.id);
    if (!cancelled) setError('This run can no longer be cancelled from its current state.');
    const refreshed = await window.agentPipeline.getAgentExecutionRun(run.id);
    if (refreshed) setRun(refreshed);
  }

  const requiredComplete = Boolean(selected && selected.inputs.every((input) => {
    const value = inputs[input.name];
    return !input.required || (value !== undefined && value !== null && String(value).trim().length > 0);
  }));
  const runtimeSupported = Boolean(selected?.supportedRuntimes.includes(runtimeId));
  const canPrepare = Boolean(selected && target?.isGitRepository && selectedRuntime?.status === 'available' && runtimeSupported && requiredComplete && !blocking);
  const visibleEvents = run ? events.filter((event) => event.runId === run.id) : [];

  function renderDefinitionList(title: string, items: AgentDefinition[]) {
    return (
      <section>
        <h2>{title}</h2>
        <div className="option-list agent-list">
          {items.length === 0 && <small>{library ? `No ${title.toLowerCase()} discovered.` : 'Choose a workflow repository first.'}</small>}
          {items.map((definition) => {
            const key = definitionKey(definition);
            return (
              <button className={selectedId === key ? 'option active' : 'option'} key={key} type="button" disabled={blocking} onClick={() => setSelectedId(key)}>
                <strong>{definition.name}</strong>
                <small>{definition.version} · {definition.relativePath}</small>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL AGENT WORKBENCH</span>
          <h1>Repository Workbench</h1>
          <p>Discover complete pipelines and standalone agents from a repository, then run them against the appropriate target.</p>
        </div>
        <div className="system-pill"><span className="status-dot" />{system ? `${system.platform} · ${system.arch} · v${system.appVersion}` : 'Loading system…'}</div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <main className="workspace agent-workspace">
        <aside className="sidebar">
          <section>
            <h2>Workflow repository</h2>
            <button className="project-button" type="button" disabled={blocking} onClick={chooseWorkflowRepository}>
              <span className="project-icon">A</span>
              <span><strong>{library?.source.name ?? 'Choose repository'}</strong><small>{library?.source.path ?? 'Repository containing agents or pipelines'}</small></span>
            </button>
          </section>

          <section>
            <h2>Execution target</h2>
            <button className="project-button" type="button" disabled={blocking} onClick={chooseTarget}>
              <span className="project-icon">⌘</span>
              <span><strong>{target?.name ?? 'Choose target repository'}</strong><small>{target?.path ?? 'Defaults to the workflow repository'}</small></span>
            </button>
            {library && target?.path !== library.source.path && <button type="button" onClick={() => setTarget(library.source)}>Use workflow repository</button>}
          </section>

          {renderDefinitionList('Pipelines', pipelines)}
          {renderDefinitionList('Agents', agents)}

          <section>
            <div className="sidebar-title"><h2>Runtime</h2><button type="button" onClick={refreshRuntimes} disabled={blocking}>Refresh</button></div>
            <div className="option-list">
              {processRuntimes.map((runtime) => (
                <button className={runtime.id === runtimeId ? 'option active' : 'option'} key={runtime.id} type="button" disabled={blocking} onClick={() => setRuntimeId(runtime.id)}>
                  <span className="option-row"><strong>{runtime.name}</strong><em className={runtime.status}>{statusLabel(runtime.status)}</em></span>
                  <small>{runtime.version ?? runtime.configurationHint}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="content">
          {!selected ? (
            <div className="empty-state"><h2>Choose a workflow repository</h2><p>The workbench will discover valid agent definitions and separate orchestrators into Pipelines.</p></div>
          ) : (
            <>
              <div className="pipeline-heading">
                <div><span className="eyebrow">SELECTED {isPipeline(selected) ? 'PIPELINE' : 'AGENT'}</span><h2>{selected.name}</h2><p>{selected.description}</p></div>
                <div className="heading-chips"><span className="mode-chip execute">{isPipeline(selected) ? 'Pipeline' : 'Standalone'}</span><span className="version-chip">{selected.version}</span></div>
              </div>

              <div className="agent-context-grid">
                <div><span>Workflow source</span><strong>{library?.source.name}</strong><small>{selected.relativePath}</small></div>
                <div><span>Execution target</span><strong>{target?.name ?? 'Not selected'}</strong><small>{target?.path ?? 'Choose a Git repository'}</small></div>
                <div><span>Maximum turns</span><strong>{selected.maxTurns}</strong><small>Inferred from the definition</small></div>
              </div>

              <div className="form-panel">
                <div className="section-title"><div><span className="eyebrow">RUN INPUT</span><h3>Tell the workflow what to do</h3></div><span>Execution target required</span></div>
                <div className="form-grid">
                  {selected.inputs.map((input) => (
                    <label className="field" key={input.name}>
                      <span>{input.title}{input.required ? ' *' : ''}</span>
                      {input.name === 'instruction' ? (
                        <textarea rows={5} disabled={blocking} placeholder={isPipeline(selected) ? 'Review NSCNL-123456' : undefined} value={String(inputs[input.name] ?? '')} onChange={(event) => setInputs((current) => ({ ...current, [input.name]: event.target.value }))} />
                      ) : (
                        <input disabled={blocking} value={String(inputs[input.name] ?? '')} onChange={(event) => setInputs((current) => ({ ...current, [input.name]: event.target.value }))} />
                      )}
                      <small>{input.description}</small>
                    </label>
                  ))}
                </div>

                <div className="agent-permission-preview">
                  <div><strong>Requested tools</strong><span>{selected.tools.length > 0 ? selected.tools.join(', ') : 'Inferred from repository instructions'}</span></div>
                  <div><strong>Connections</strong><span>{selected.requiredEnvironment.length > 0 ? selected.requiredEnvironment.join(', ') : 'None declared'}</span></div>
                  <div><strong>Writes</strong><span>{selected.writes.length > 0 ? selected.writes.join(' · ') : selected.writeRequested ? 'Write access requested' : 'None requested'}</span></div>
                </div>

                {selectedRuntime && (
                  <div className={`runtime-configuration ${selectedRuntime.status}`}>
                    <div><strong>{selectedRuntime.name}</strong><small>{selectedRuntime.executablePath ?? selectedRuntime.configurationHint}</small></div>
                    <button type="button" onClick={configureRuntime} disabled={blocking}>Choose executable</button>
                  </div>
                )}

                <div className="actions">
                  <button className="secondary" type="button" disabled={!library} onClick={() => library && window.agentPipeline.openPath(library.source.path)}>Open workflow repo</button>
                  <button className="secondary" type="button" disabled={!target} onClick={() => target && window.agentPipeline.openPath(target.path)}>Open target</button>
                  <button className="primary" type="button" disabled={!canPrepare} onClick={prepare}>{busy ? 'Preparing…' : `Prepare ${isPipeline(selected) ? 'pipeline' : 'agent'} run`}</button>
                </div>
              </div>

              {run?.status === 'awaiting_approval' && (
                <div className="approval-panel">
                  <div className="section-title"><div><span className="eyebrow">APPROVAL REQUIRED</span><h3>Review runtime access</h3></div><span>{run.branchName}</span></div>
                  {run.runtimePolicy.missingEnvironment.length > 0 && <div className="error-banner">Missing connections: {run.runtimePolicy.missingEnvironment.join(', ')}. Configure them in Connections, then prepare the run again.</div>}
                  <div className="agent-permission-preview">
                    <div><strong>File writes</strong><span>{run.runtimePolicy.fileWrites}</span></div>
                    <div><strong>Shell</strong><span>{run.runtimePolicy.shell}</span></div>
                    <div><strong>Network</strong><span>{run.runtimePolicy.network}</span></div>
                  </div>
                  <label className="checkbox-field"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span><strong>I approve this exact isolated run</strong><small>No commit, push, merge or deploy is automatic.</small></span></label>
                  <div className="actions"><button className="secondary danger" type="button" onClick={cancel}>Discard</button><button className="primary" type="button" disabled={!approved || run.runtimePolicy.missingEnvironment.length > 0 || busy} onClick={start}>Approve and start</button></div>
                </div>
              )}

              {run && (
                <div className="run-panel">
                  <div className="run-header"><strong>{selected.name}: {run.status}</strong><span>{run.id}</span></div>
                  <div className="event-log">
                    {visibleEvents.map((event) => <div key={`${event.runId}-${event.sequence}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><span>{readableEvent(event)}</span></div>)}
                    {visibleEvents.length === 0 && <small>No live events received yet. The complete event file remains in the run folder.</small>}
                  </div>
                  <div className="actions">
                    <button className="secondary" type="button" onClick={() => window.agentPipeline.openPath(run.worktreePath)}>Open worktree</button>
                    <button className="secondary" type="button" onClick={() => window.agentPipeline.openPath(run.storagePath)}>Open run folder</button>
                    {(run.status === 'running' || run.status === 'validating') && <button className="secondary danger" type="button" onClick={cancel}>Cancel</button>}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
