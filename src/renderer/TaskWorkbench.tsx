import { useEffect, useMemo, useState } from 'react';
import type {
  AgentDefinition,
  AgentExecutionRun,
  AgentLibrarySelection,
  ProcessRuntimeId,
  ProjectSelection,
  RunEvent,
  RuntimeAdapterDescriptor
} from '../shared/contracts';
import { AgentWorkbench } from './AgentWorkbench';

function keyFor(agent: AgentDefinition): string {
  return `${agent.id}@${agent.relativePath}`;
}

function isPipeline(agent: AgentDefinition): boolean {
  return /orchestrat|pipeline|workflow/i.test(`${agent.id} ${agent.name} ${agent.relativePath}`);
}

function friendlyName(agent: AgentDefinition): string {
  const value = agent.name.replace(/[-_]+/g, ' ').trim();
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function friendlyDescription(agent: AgentDefinition): string {
  if (isPipeline(agent)) return agent.description || 'Run the complete guided workflow from start to finish.';
  if (/defect|investigat/i.test(agent.name)) return 'Investigate and clarify a defect using the ticket and affected code.';
  if (/requirement|story|clarif/i.test(agent.name)) return 'Analyse and improve requirements or Jira stories.';
  if (/test/i.test(agent.name)) return 'Create or review test cases and quality evidence.';
  return agent.description || 'Run this specialist workflow.';
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

function providerFailure(events: RunEvent[]): string | null {
  const text = events.map((event) => event.message).join('\n');
  if (/Authentication token found but could not be validated|copilot_internal\/user|OAuth user login/i.test(text)) {
    return 'GitHub Copilot is installed and has a token, but it cannot reach the BMW GitHub Enterprise authentication service from this app session. Check the corporate network, proxy or certificate setup, then retry.';
  }
  return null;
}

function isProcessRuntime(runtime: RuntimeAdapterDescriptor): runtime is RuntimeAdapterDescriptor & { id: ProcessRuntimeId } {
  return runtime.kind === 'process' && (runtime.id === 'claude-code' || runtime.id === 'github-copilot');
}

export function TaskWorkbench() {
  const [advancedMode, setAdvancedMode] = useState(false);
  const [library, setLibrary] = useState<AgentLibrarySelection | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [target, setTarget] = useState<ProjectSelection | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [runtimeId, setRuntimeId] = useState<ProcessRuntimeId>('claude-code');
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [run, setRun] = useState<AgentExecutionRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const agents = library?.agents ?? [];
  const pipelines = agents.filter(isPipeline);
  const specialists = agents.filter((agent) => !isPipeline(agent));
  const selected = useMemo(() => agents.find((agent) => keyFor(agent) === selectedKey) ?? null, [agents, selectedKey]);
  const processRuntimes = runtimes.filter(isProcessRuntime);
  const selectedRuntime = processRuntimes.find((runtime) => runtime.id === runtimeId) ?? null;
  const visibleEvents = run ? events.filter((event) => event.runId === run.id) : [];
  const friendlyProviderError = providerFailure(visibleEvents);
  const active = Boolean(run && ['preparing', 'awaiting_approval', 'running', 'validating'].includes(run.status)) || busy;

  useEffect(() => {
    window.agentPipeline.listRuntimes().then((available) => {
      setRuntimes(available);
      const preferred = available.find((runtime) => isProcessRuntime(runtime) && runtime.status === 'available');
      if (preferred && isProcessRuntime(preferred)) setRuntimeId(preferred.id);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => window.agentPipeline.onRunEvent((event) => {
    setEvents((current) => [...current, event].slice(-1500));
    const status = statusFromEvent(event);
    if (!status) return;
    setRun((current) => current?.id === event.runId ? { ...current, status, updatedAt: event.timestamp } : current);
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      void window.agentPipeline.getAgentExecutionRun(event.runId).then((record) => record && setRun(record));
    }
  }), []);

  useEffect(() => {
    if (!selected || active) return;
    setInputs(Object.fromEntries(selected.inputs.map((input) => [input.name, ''])));
    setRun(null);
    setEvents([]);
  }, [selectedKey]);

  async function chooseWorkflowRepository(): Promise<void> {
    if (active) return;
    setError('');
    try {
      const selection = await window.agentPipeline.selectAgentLibrary();
      if (!selection) return;
      setLibrary(selection);
      setTarget(selection.source.isGitRepository ? selection.source : null);
      const preferred = selection.agents.find(isPipeline) ?? selection.agents[0];
      setSelectedKey(preferred ? keyFor(preferred) : '');
      setRun(null);
      setEvents([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function chooseTarget(): Promise<void> {
    if (active) return;
    const selection = await window.agentPipeline.selectProjectDirectory();
    if (selection) setTarget(selection);
  }

  async function prepare(): Promise<void> {
    if (!selected || !target?.isGitRepository || !selectedRuntime || selectedRuntime.status !== 'available') return;
    setBusy(true);
    setError('');
    setEvents([]);
    try {
      setRun(await window.agentPipeline.prepareAgentExecution({
        agentSourceRoot: selected.sourceRoot,
        agentRelativePath: selected.relativePath,
        agentId: selected.id,
        targetProject: target,
        runtimeId,
        inputs
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function start(): Promise<void> {
    if (!run) return;
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
    await window.agentPipeline.cancelAgentExecution(run.id);
    const refreshed = await window.agentPipeline.getAgentExecutionRun(run.id);
    if (refreshed) setRun(refreshed);
  }

  if (advancedMode) return <AgentWorkbench />;

  const requiredComplete = Boolean(selected && selected.inputs.every((input) => {
    const value = inputs[input.name];
    return !input.required || String(value ?? '').trim().length > 0;
  }));
  const canPrepare = Boolean(selected && target?.isGitRepository && selectedRuntime?.status === 'available' && requiredComplete && !active);

  return (
    <div className="task-shell">
      <header className="task-header">
        <div>
          <span className="task-kicker">QUALITY WORKBENCH</span>
          <h1>What would you like help with?</h1>
          <p>Choose a workflow, provide the ticket or task, and let the workbench guide the rest.</p>
        </div>
        <div className="task-header-actions">
          <button type="button" onClick={() => { window.location.href = './connections.html'; }}>Connections</button>
          <button type="button" onClick={() => setAdvancedMode(true)}>Advanced</button>
        </div>
      </header>

      {error && <div className="task-alert error" role="alert">{error}</div>}
      {friendlyProviderError && <div className="task-alert warning" role="alert"><strong>Copilot needs attention</strong><span>{friendlyProviderError}</span></div>}

      <main className="task-main">
        <section className="task-step">
          <div className="task-step-number">1</div>
          <div className="task-step-content">
            <h2>Choose the workflow library</h2>
            <p>Select the folder supplied by your team. The available quality workflows will appear automatically.</p>
            <button className="task-picker" type="button" disabled={active} onClick={chooseWorkflowRepository}>
              <span>{library ? '✓' : '＋'}</span>
              <div><strong>{library?.source.name ?? 'Choose workflow folder'}</strong><small>{library?.source.path ?? 'For example, Jira Story Agent or the AI Dev Kit'}</small></div>
            </button>
          </div>
        </section>

        {library && (
          <section className="task-step">
            <div className="task-step-number">2</div>
            <div className="task-step-content">
              <h2>Choose what you want to do</h2>
              {pipelines.length > 0 && <><h3>Guided workflows</h3><div className="task-card-grid">{pipelines.map((agent) => {
                const key = keyFor(agent);
                return <button key={key} type="button" disabled={active} className={selectedKey === key ? 'task-card selected' : 'task-card'} onClick={() => setSelectedKey(key)}><span className="task-card-icon">◆</span><strong>{friendlyName(agent)}</strong><small>{friendlyDescription(agent)}</small><em>Complete workflow</em></button>;
              })}</div></>}
              {specialists.length > 0 && <details className="task-specialists"><summary>Run a specialist step instead</summary><div className="task-card-grid">{specialists.map((agent) => {
                const key = keyFor(agent);
                return <button key={key} type="button" disabled={active} className={selectedKey === key ? 'task-card selected' : 'task-card'} onClick={() => setSelectedKey(key)}><span className="task-card-icon">●</span><strong>{friendlyName(agent)}</strong><small>{friendlyDescription(agent)}</small></button>;
              })}</div></details>}
            </div>
          </section>
        )}

        {selected && (
          <section className="task-step">
            <div className="task-step-number">3</div>
            <div className="task-step-content">
              <h2>Tell us what needs to be done</h2>
              <p>{friendlyDescription(selected)}</p>
              <div className="task-form">
                {selected.inputs.map((input) => (
                  <label key={input.name}><span>{input.title}{input.required ? ' *' : ''}</span><textarea rows={input.name === 'task' ? 4 : 2} disabled={active} placeholder={input.name === 'task' ? 'For example: Review NSCNL-123456 and clarify anything that is incomplete.' : `Enter ${input.title.toLowerCase()}`} value={String(inputs[input.name] ?? '')} onChange={(event) => setInputs((current) => ({ ...current, [input.name]: event.target.value }))} /></label>
                ))}
                {selected.inputs.length === 0 && <div className="task-alert warning">This workflow has not declared a user input. Open Advanced to inspect its definition.</div>}
              </div>

              <div className="task-project-row">
                <div><strong>Project to work on</strong><small>{target?.path ?? 'Choose the repository containing the relevant code or documents.'}</small></div>
                <button type="button" disabled={active} onClick={chooseTarget}>{target ? 'Change project' : 'Choose project'}</button>
              </div>

              <details className="task-advanced-options">
                <summary>Advanced options</summary>
                <label><span>AI provider</span><select disabled={active} value={runtimeId} onChange={(event) => setRuntimeId(event.target.value as ProcessRuntimeId)}>{processRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id} disabled={runtime.status !== 'available'}>{runtime.name}{runtime.status === 'available' ? '' : ' — unavailable'}</option>)}</select></label>
                <small>The workbench automatically chooses an available provider. Technical permissions and isolated-worktree controls are applied in the background.</small>
              </details>

              {!run && <div className="task-primary-row"><button className="task-primary" type="button" disabled={!canPrepare} onClick={prepare}>{busy ? 'Preparing…' : 'Continue'}</button></div>}
            </div>
          </section>
        )}

        {run?.status === 'awaiting_approval' && (
          <section className="task-confirmation">
            <span className="task-confirm-icon">✓</span>
            <div><h2>Ready to start</h2><p>The workbench prepared a safe, isolated copy of <strong>{target?.name}</strong>. It will run <strong>{friendlyName(selected!)}</strong> and will not commit, push, merge or deploy anything.</p>{run.runtimePolicy.missingEnvironment.length > 0 && <div className="task-alert warning">Connections still required: {run.runtimePolicy.missingEnvironment.join(', ')}</div>}</div>
            <div className="task-confirm-actions"><button type="button" onClick={cancel}>Cancel</button><button className="task-primary" type="button" disabled={busy || run.runtimePolicy.missingEnvironment.length > 0} onClick={start}>{busy ? 'Starting…' : 'Start task'}</button></div>
          </section>
        )}

        {run && run.status !== 'awaiting_approval' && (
          <section className={`task-progress ${run.status}`}>
            <div className="task-progress-heading"><div><span className="task-progress-dot"/><h2>{run.status === 'completed' ? 'Task completed' : run.status === 'failed' ? 'Task could not be completed' : run.status === 'cancelled' ? 'Task cancelled' : 'Working on your task…'}</h2></div><button type="button" onClick={() => window.agentPipeline.openPath(run.storagePath)}>Open details</button></div>
            <div className="task-progress-list">{visibleEvents.slice(-8).map((event) => <div key={`${event.runId}-${event.sequence}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><span>{event.message.startsWith('{') ? 'Processing workflow step…' : event.message}</span></div>)}</div>
            <div className="task-progress-actions"><button type="button" onClick={() => window.agentPipeline.openPath(run.worktreePath)}>Open results</button>{['running', 'validating'].includes(run.status) && <button type="button" onClick={cancel}>Cancel</button>}</div>
          </section>
        )}
      </main>
    </div>
  );
}
