import { useEffect, useMemo, useState } from 'react';
import { RunPermissions } from './RunPermissions';
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

function executionStatusFromEvent(event: RunEvent): AgentExecutionRun['status'] | null {
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

function readableEventMessage(event: RunEvent): string {
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
    const type = typeof value.type === 'string' ? value.type.replaceAll('_', ' ') : 'runtime event';
    return status ? `${type}: ${status}` : type;
  } catch {
    return event.message;
  }
}

function isProcessRuntime(runtime: RuntimeAdapterDescriptor): runtime is RuntimeAdapterDescriptor & { id: ProcessRuntimeId } {
  return runtime.kind === 'process' && (runtime.id === 'claude-code' || runtime.id === 'github-copilot');
}

function pathTail(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

export function AgentWorkbench() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [library, setLibrary] = useState<AgentLibrarySelection | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [targetProject, setTargetProject] = useState<ProjectSelection | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [runtimeId, setRuntimeId] = useState<ProcessRuntimeId>('claude-code');
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [run, setRun] = useState<AgentExecutionRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const agents = library?.agents ?? [];
  const selectedAgent = useMemo(
    () => agents.find((agent) => `${agent.id}@${agent.relativePath}` === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
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
    const status = executionStatusFromEvent(event);
    if (status) {
      setRun((current) => current?.id === event.runId ? { ...current, status, updatedAt: event.timestamp } : current);
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        void window.agentPipeline.getAgentExecutionRun(event.runId).then((record) => {
          if (record) setRun(record);
        });
      }
    }
  }), []);

  useEffect(() => {
    if (!selectedAgent || blocking) return;
    setInputs(Object.fromEntries(selectedAgent.inputs.map((input) => [input.name, ''])));
    setRun(null);
    setEvents([]);
    setApprovalAcknowledged(false);
  }, [selectedAgentId]);

  async function chooseLibrary(): Promise<void> {
    if (blocking) return;
    setError('');
    try {
      const selection = await window.agentPipeline.selectAgentLibrary();
      if (!selection) return;
      setLibrary(selection);
      const first = selection.agents[0];
      setSelectedAgentId(first ? `${first.id}@${first.relativePath}` : '');
      setRun(null);
      setEvents([]);
      setApprovalAcknowledged(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function chooseTarget(): Promise<void> {
    if (blocking) return;
    setError('');
    try {
      const selection = await window.agentPipeline.selectProjectDirectory();
      if (!selection) return;
      setTargetProject(selection);
      setRun(null);
      setEvents([]);
      setApprovalAcknowledged(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
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
    if (!selectedRuntime || !isProcessRuntime(selectedRuntime) || blocking) return;
    setBusy(true);
    setError('');
    try {
      setRuntimes(await window.agentPipeline.configureRuntimeExecutable(selectedRuntime.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function prepare(): Promise<void> {
    if (!selectedAgent || !targetProject || !selectedRuntime || !isProcessRuntime(selectedRuntime)) return;
    setBusy(true);
    setError('');
    setEvents([]);
    setApprovalAcknowledged(false);
    try {
      setRun(await window.agentPipeline.prepareAgentExecution({
        agentSourceRoot: selectedAgent.sourceRoot,
        agentRelativePath: selectedAgent.relativePath,
        agentId: selectedAgent.id,
        targetProject,
        runtimeId: selectedRuntime.id,
        inputs
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function approveAndStart(): Promise<void> {
    if (!run || !approvalAcknowledged || run.runtimePolicy.missingEnvironment.length > 0) return;
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
    setError('');
    const cancelled = await window.agentPipeline.cancelAgentExecution(run.id);
    if (!cancelled) setError('The standalone agent can no longer be cancelled from its current state.');
    const refreshed = await window.agentPipeline.getAgentExecutionRun(run.id);
    if (refreshed) setRun(refreshed);
  }

  const requiredComplete = Boolean(selectedAgent && selectedAgent.inputs.every((input) => {
    const value = inputs[input.name];
    return !input.required || (value !== undefined && value !== null && String(value).trim().length > 0);
  }));
  const runtimeSupported = Boolean(selectedAgent?.supportedRuntimes.includes(runtimeId));
  const canPrepare = Boolean(selectedAgent && targetProject?.isGitRepository && selectedRuntime?.status === 'available' && runtimeSupported && requiredComplete && !blocking);
  const visibleEvents = run ? events.filter((event) => event.runId === run.id) : [];
  const canCancel = run?.status === 'awaiting_approval' || run?.status === 'running' || run?.status === 'validating';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL AGENT WORKBENCH</span>
          <h1>Single Agent Runner</h1>
          <p>Load one agent from an agent library and run it against a separate target code repository.</p>
        </div>
        <div className="system-pill"><span className="status-dot" />{system ? `${system.platform} · ${system.arch} · v${system.appVersion}` : 'Loading system…'}</div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <main className="workspace agent-workspace">
        <aside className="sidebar">
          <section>
            <h2>Agent library</h2>
            <button className="project-button" type="button" disabled={blocking} onClick={chooseLibrary}>
              <span className="project-icon">A</span>
              <span><strong>{library?.source.name ?? 'Choose agent library'}</strong><small>{library?.source.path ?? 'AI Dev Kit or another agent repository'}</small></span>
            </button>
          </section>

          <section>
            <h2>Target code</h2>
            <button className="project-button" type="button" disabled={blocking} onClick={chooseTarget}>
              <span className="project-icon">⌘</span>
              <span><strong>{targetProject?.name ?? 'Choose code repository'}</strong><small>{targetProject?.path ?? 'Repository containing the code to investigate'}</small></span>
            </button>
            {targetProject && <span className={`git-badge ${targetProject.isGitRepository ? 'ok' : 'warn'}`}>{targetProject.isGitRepository ? 'Git repository' : 'No .git detected'}</span>}
          </section>

          <section>
            <h2>Agent</h2>
            <div className="option-list agent-list">
              {agents.length === 0 && <small>Choose an agent library to discover agents.</small>}
              {agents.map((agent) => {
                const key = `${agent.id}@${agent.relativePath}`;
                return (
                  <button className={key === selectedAgentId ? 'option active' : 'option'} key={key} type="button" disabled={blocking} onClick={() => setSelectedAgentId(key)}>
                    <strong>{agent.name}</strong><small>v{agent.version} · {agent.relativePath}</small>
                  </button>
                );
              })}
            </div>
          </section>

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
          {selectedAgent ? (
            <>
              <div className="pipeline-heading">
                <div><span className="eyebrow">SELECTED AGENT</span><h2>{selectedAgent.name}</h2><p>{selectedAgent.description}</p></div>
                <div className="heading-chips"><span className="mode-chip execute">Standalone</span><span className="version-chip">{selectedAgent.version}</span></div>
              </div>

              <div className="agent-context-grid">
                <div><span>Agent source</span><strong>{library?.source.name}</strong><small>{selectedAgent.relativePath}</small></div>
                <div><span>Target code</span><strong>{targetProject?.name ?? 'Not selected'}</strong><small>{targetProject?.path ?? 'Choose the affected repository'}</small></div>
                <div><span>Maximum turns</span><strong>{selectedAgent.maxTurns}</strong><small>Inferred from the agent definition</small></div>
              </div>

              <div className="form-panel">
                <div className="section-title"><div><span className="eyebrow">AGENT INPUTS</span><h3>Configure run</h3></div><span>Target repository required</span></div>
                {selectedAgent.inputs.length === 0 ? <p>This agent declares no `${'{input:...}'}` placeholders.</p> : (
                  <div className="form-grid">
                    {selectedAgent.inputs.map((input) => (
                      <label className="field" key={input.name}>
                        <span>{input.title}{input.required ? ' *' : ''}</span>
                        <input disabled={blocking} value={String(inputs[input.name] ?? '')} onChange={(event) => setInputs((current) => ({ ...current, [input.name]: event.target.value }))} />
                        <small>{input.description}</small>
                      </label>
                    ))}
                  </div>
                )}

                <div className="agent-permission-preview">
                  <div><strong>Requested tools</strong><span>{selectedAgent.tools.length > 0 ? selectedAgent.tools.join(', ') : 'No tools declared'}</span></div>
                  <div><strong>Environment</strong><span>{selectedAgent.requiredEnvironment.length > 0 ? selectedAgent.requiredEnvironment.join(', ') : 'None declared'}</span></div>
                  <div><strong>Writes</strong><span>{selectedAgent.writes.length > 0 ? selectedAgent.writes.join(' · ') : selectedAgent.writeRequested ? 'Write tools requested; paths not declared' : 'None requested'}</span></div>
                </div>

                {selectedRuntime && (
                  <div className={`runtime-configuration ${selectedRuntime.status}`}>
                    <div><strong>{selectedRuntime.name}</strong><small>{selectedRuntime.executablePath ?? selectedRuntime.configurationHint}</small>{selectedRuntime.executableSource && <span>{selectedRuntime.executableSource === 'configured' ? 'Manual executable' : 'Automatically discovered'}</span>}</div>
                    <button type="button" onClick={configureRuntime} disabled={blocking}>Choose executable</button>
                  </div>
                )}
                {!runtimeSupported && <div className="runtime-hint">This agent cannot currently run with the selected runtime.</div>}

                <div className="actions">
                  <button className="secondary" type="button" disabled={!library} onClick={() => library && window.agentPipeline.openPath(library.source.path)}>Open agent library</button>
                  <button className="secondary" type="button" disabled={!targetProject} onClick={() => targetProject && window.agentPipeline.openPath(targetProject.path)}>Open target</button>
                  <button className="primary" type="button" disabled={!canPrepare} onClick={prepare}>{busy ? 'Preparing…' : 'Prepare agent run'}</button>
                </div>
              </div>

              {run?.status === 'awaiting_approval' && (
                <section className="approval-panel agent-approval">
                  <div className="approval-heading"><div><span className="eyebrow">EXPLICIT APPROVAL REQUIRED</span><h3>Review the standalone-agent boundary</h3></div><span className="approval-status">Not started</span></div>
                  <dl className="execution-details">
                    <div><dt>Agent</dt><dd>{run.agentName} v{run.agentVersion}</dd></div>
                    <div><dt>Target repository</dt><dd>{run.repositoryRoot}</dd></div>
                    <div><dt>Worktree</dt><dd>{run.worktreePath}</dd></div>
                    <div><dt>Branch</dt><dd>{run.branchName}</dd></div>
                  </dl>
                  <RunPermissions run={run}/>
                  {run.runtimePolicy.missingEnvironment.length > 0 && <div className="runtime-hint">Configure the missing credentials in Connections before starting.</div>}
                  <label className="approval-check"><input type="checkbox" checked={approvalAcknowledged} onChange={(event) => setApprovalAcknowledged(event.target.checked)} /><span>I trust this agent definition and approve the displayed tools against the isolated target worktree.</span></label>
                  <div className="approval-actions">
                    <button className="secondary" type="button" onClick={() => window.agentPipeline.openPath(run.worktreePath)}>Open worktree</button>
                    <button className="danger" type="button" onClick={cancel}>Discard</button>
                    <button className="primary" type="button" disabled={!approvalAcknowledged || run.runtimePolicy.missingEnvironment.length > 0 || busy} onClick={approveAndStart}>{busy ? 'Starting…' : 'Approve and start'}</button>
                  </div>
                </section>
              )}

              {run && run.status !== 'awaiting_approval' && (
                <div className={`execution-summary ${run.status}`}>
                  <div><span className={`run-state ${run.status.replaceAll('_', '-')}`} /><strong>{run.agentName}: {run.status.replaceAll('_', ' ')}</strong></div>
                  <span>{run.branchName}</span>
                  <div className="execution-summary-actions"><button type="button" onClick={() => window.agentPipeline.openPath(run.worktreePath)}>Open worktree</button>{canCancel && <button className="danger-link" type="button" onClick={cancel}>Cancel</button>}</div>
                </div>
              )}

              {run?.changedFiles && run.changedFiles.length > 0 && (
                <section className="changed-files"><h3>Changed files</h3>{run.changedFiles.map((file) => <div key={file}><code>{file}</code><span>{pathTail(file)}</span></div>)}</section>
              )}

              {run && (
                <div className="run-console">
                  <div className="console-heading"><div><span className={`run-state ${run.status.replaceAll('_', '-')}`} /><strong>{run.status.replaceAll('_', ' ')}</strong></div><code>{run.id}</code></div>
                  <div className="console-output" aria-live="polite">
                    {visibleEvents.length === 0 ? <span>Waiting for runtime output…</span> : visibleEvents.map((event) => (
                      <div className={`console-line ${event.type.replaceAll('.', '-')}`} key={`${event.runId}-${event.sequence}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><span>{readableEventMessage(event)}</span></div>
                    ))}
                  </div>
                  <div className="console-actions"><button type="button" onClick={() => window.agentPipeline.openPath(run.worktreePath)}>Open worktree</button><button type="button" onClick={() => window.agentPipeline.openPath(run.storagePath)}>Open run folder</button></div>
                </div>
              )}
            </>
          ) : <div className="empty">Choose an agent library to begin.</div>}
        </section>
      </main>
    </div>
  );
}
