import { useEffect, useMemo, useState } from 'react';
import type {
  AgentDefinition,
  ExecutionRun,
  ProcessRuntimeId,
  ProjectSelection,
  RunEvent,
  RuntimeAdapterDescriptor
} from '../shared/contracts';

function executionStatus(event: RunEvent): ExecutionRun['status'] | null {
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

function RepositoryCard({ label, value, onChoose, disabled }: {
  label: string;
  value: ProjectSelection | null;
  onChoose: () => void;
  disabled: boolean;
}) {
  return (
    <button className="project-button" type="button" onClick={onChoose} disabled={disabled}>
      <span className="project-icon">⌘</span>
      <span>
        <strong>{value?.name ?? label}</strong>
        <small>{value?.path ?? 'Choose a local repository'}</small>
      </span>
    </button>
  );
}

export function AgentApp() {
  const [sourceRepository, setSourceRepository] = useState<ProjectSelection | null>(null);
  const [targetProject, setTargetProject] = useState<ProjectSelection | null>(null);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [agentId, setAgentId] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [runtimeId, setRuntimeId] = useState<ProcessRuntimeId>('claude-code');
  const [executionRun, setExecutionRun] = useState<ExecutionRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === agentId) ?? null, [agents, agentId]);
  const active = executionRun && ['preparing', 'awaiting_approval', 'running', 'validating'].includes(executionRun.status);

  useEffect(() => {
    window.agentPipeline.listRuntimes().then((items) => {
      const processRuntimes = items.filter((runtime) => runtime.kind === 'process');
      setRuntimes(processRuntimes);
      const available = processRuntimes.find((runtime) => runtime.status === 'available');
      if (available?.id === 'claude-code' || available?.id === 'github-copilot') setRuntimeId(available.id);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => window.agentPipeline.onRunEvent((event) => {
    setEvents((current) => [...current, event].slice(-2_000));
    const status = executionStatus(event);
    if (status) {
      setExecutionRun((current) => current?.id === event.runId
        ? { ...current, status, updatedAt: event.timestamp }
        : current);
    }
  }), []);

  async function chooseAgentLibrary() {
    if (active) return;
    setError('');
    const selection = await window.agentPipeline.selectAgentLibraryDirectory();
    if (!selection) return;
    setSourceRepository(selection);
    setTargetProject(null);
    setExecutionRun(null);
    setEvents([]);
    setInputs({});
    const discovered = await window.agentPipeline.discoverAgents({ sourceRepository: selection });
    setAgents(discovered);
    setAgentId(discovered[0]?.id ?? '');
  }

  async function chooseTargetProject() {
    if (active) return;
    const selection = await window.agentPipeline.selectProjectDirectory();
    if (selection) setTargetProject(selection);
  }

  function selectAgent(id: string) {
    if (active) return;
    setAgentId(id);
    setInputs({});
    setExecutionRun(null);
    setEvents([]);
    setApproved(false);
  }

  async function prepare() {
    if (!selectedAgent || !targetProject) return;
    setBusy(true);
    setError('');
    setEvents([]);
    setExecutionRun(null);
    setApproved(false);
    try {
      const record = await window.agentPipeline.prepareAgentExecution({
        agent: selectedAgent,
        targetProject,
        runtimeId,
        inputs
      });
      setExecutionRun(record);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!executionRun || !approved) return;
    setBusy(true);
    setError('');
    try {
      setExecutionRun(await window.agentPipeline.approveAndStartExecution(executionRun.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!executionRun) return;
    const cancelled = await window.agentPipeline.cancelExecution(executionRun.id);
    if (!cancelled) setError('The run can no longer be cancelled from its current state.');
  }

  const inputsComplete = Boolean(selectedAgent && selectedAgent.inputs.every((name) => inputs[name]?.trim()));
  const runtimeReady = runtimes.some((runtime) => runtime.id === runtimeId && runtime.status === 'available');
  const canPrepare = Boolean(sourceRepository && targetProject?.isGitRepository && selectedAgent && inputsComplete && runtimeReady && !active && !busy);
  const visibleEvents = executionRun ? events.filter((event) => event.runId === executionRun.id) : [];

  return (
    <div className="agent-workbench">
      {error && <div className="error-banner" role="alert">{error}</div>}
      <main className="workspace">
        <aside className="sidebar">
          <section>
            <h2>Agent library</h2>
            <RepositoryCard label="Choose agent library" value={sourceRepository} onChoose={chooseAgentLibrary} disabled={Boolean(active)} />
          </section>
          <section>
            <h2>Target code</h2>
            <RepositoryCard label="Choose target repository" value={targetProject} onChoose={chooseTargetProject} disabled={Boolean(active)} />
            {targetProject && <span className={`git-badge ${targetProject.isGitRepository ? 'ok' : 'warn'}`}>{targetProject.isGitRepository ? 'Git repository' : 'Git repository required'}</span>}
          </section>
          <section>
            <h2>Agents</h2>
            <div className="option-list">
              {agents.length === 0 && <small>Choose an agent library to discover standalone agents.</small>}
              {agents.map((agent) => (
                <button className={agent.id === agentId ? 'option active' : 'option'} key={agent.id} type="button" disabled={Boolean(active)} onClick={() => selectAgent(agent.id)}>
                  <span className="option-row"><strong>{agent.name}</strong></span>
                  <small>v{agent.version} · {agent.inputs.length} input{agent.inputs.length === 1 ? '' : 's'}</small>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2>Runtime</h2>
            <div className="option-list">
              {runtimes.map((runtime) => (
                <button className={runtime.id === runtimeId ? 'option active' : 'option'} key={runtime.id} type="button" disabled={Boolean(active)} onClick={() => {
                  if (runtime.id === 'claude-code' || runtime.id === 'github-copilot') setRuntimeId(runtime.id);
                }}>
                  <span className="option-row"><strong>{runtime.name}</strong><em className={runtime.status}>{runtime.status === 'available' ? 'Ready' : 'Unavailable'}</em></span>
                  <small>{runtime.version ?? runtime.description}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="content">
          {selectedAgent ? (
            <>
              <div className="pipeline-heading">
                <div>
                  <span className="eyebrow">STANDALONE AGENT</span>
                  <h2>{selectedAgent.name}</h2>
                  <p>{selectedAgent.description}</p>
                </div>
                <div className="heading-chips"><span className="mode-chip execute">Isolated execution</span><span className="version-chip">{selectedAgent.version}</span></div>
              </div>

              <div className="form-panel">
                <div className="section-title"><div><span className="eyebrow">AGENT INPUT</span><h3>Configure agent run</h3></div><span>Source and target repositories are separate</span></div>
                <div className="form-grid">
                  {selectedAgent.inputs.map((name) => (
                    <label className="field" key={name}>
                      <span>{name.replaceAll('-', ' ').replaceAll('_', ' ')} *</span>
                      <input type="text" disabled={Boolean(active)} value={inputs[name] ?? ''} onChange={(event) => setInputs((current) => ({ ...current, [name]: event.target.value }))} />
                    </label>
                  ))}
                </div>

                <div className="policy-grid">
                  <div><strong>Agent source</strong><span>{selectedAgent.sourcePath}</span></div>
                  <div><strong>Target repository</strong><span>{targetProject?.path ?? 'Not selected'}</span></div>
                  <div><strong>Shell</strong><span>{selectedAgent.requiresShell ? 'Requested — approval required' : 'Denied'}</span></div>
                  <div><strong>Network</strong><span>{selectedAgent.requiresNetwork ? 'Requested — approval required' : 'Denied'}</span></div>
                </div>
                <div className="validation-list">
                  <h4>Declared writes</h4>
                  {selectedAgent.writes.length ? selectedAgent.writes.map((write) => <div key={write}><code>{write}</code></div>) : <p>No write paths were declared by this agent.</p>}
                </div>
                {selectedAgent.requiresNetwork && <div className="runtime-hint">This agent needs network access. During development, launch the desktop app from a terminal that already exports the required credentials such as ATC_JIRA_TOKEN.</div>}
                <div className="actions">
                  <button className="secondary" type="button" disabled={!canPrepare} onClick={prepare}>{busy ? 'Preparing…' : 'Prepare isolated agent run'}</button>
                </div>
              </div>

              {executionRun?.status === 'awaiting_approval' && (
                <section className="approval-panel">
                  <div className="approval-heading"><div><span className="eyebrow">EXPLICIT APPROVAL REQUIRED</span><h3>Review the standalone agent boundary</h3></div><span className="approval-status">Not started</span></div>
                  <dl className="execution-details">
                    <div><dt>Branch</dt><dd>{executionRun.branchName}</dd></div>
                    <div><dt>Worktree</dt><dd>{executionRun.worktreePath}</dd></div>
                    <div><dt>Shell</dt><dd>{executionRun.runtimePolicy.shell}</dd></div>
                    <div><dt>Network</dt><dd>{executionRun.runtimePolicy.network}</dd></div>
                  </dl>
                  <label className="approval-check"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>I approve this agent to run in the isolated target worktree with the permissions shown above. It may not commit, push, merge or deploy.</span></label>
                  <div className="approval-actions">
                    <button className="secondary" type="button" onClick={() => window.agentPipeline.openPath(executionRun.worktreePath)}>Open worktree</button>
                    <button className="danger" type="button" onClick={cancel}>Discard</button>
                    <button className="primary" type="button" disabled={!approved || busy} onClick={start}>{busy ? 'Starting…' : 'Approve and start'}</button>
                  </div>
                </section>
              )}

              {executionRun && executionRun.status !== 'awaiting_approval' && (
                <div className={`execution-summary ${executionRun.status}`}>
                  <div><span className={`run-state ${executionRun.status.replaceAll('_', '-')}`} /><strong>Agent run: {executionRun.status.replaceAll('_', ' ')}</strong></div>
                  <span>{executionRun.branchName}</span>
                  <div className="execution-summary-actions"><button type="button" onClick={() => window.agentPipeline.openPath(executionRun.worktreePath)}>Open worktree</button>{active && <button className="danger-link" type="button" onClick={cancel}>Cancel</button>}</div>
                </div>
              )}

              {executionRun && (
                <div className="run-console">
                  <div className="console-heading"><div><span className={`run-state ${executionRun.status.replaceAll('_', '-')}`} /><strong>{executionRun.status.replaceAll('_', ' ')}</strong></div><code>{executionRun.id}</code></div>
                  <div className="console-output" aria-live="polite">
                    {visibleEvents.length === 0 ? <span>Waiting for runtime output…</span> : visibleEvents.map((event) => <div className={`console-line ${event.type.replaceAll('.', '-')}`} key={`${event.runId}-${event.sequence}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><span>{event.message}</span></div>)}
                  </div>
                  <div className="console-actions"><button type="button" onClick={() => window.agentPipeline.openPath(executionRun.storagePath)}>Open run folder</button><button type="button" onClick={() => window.agentPipeline.openPath(executionRun.worktreePath)}>Open worktree</button></div>
                </div>
              )}
            </>
          ) : <div className="empty">Choose an agent library repository to discover agents.</div>}
        </section>
      </main>
    </div>
  );
}
