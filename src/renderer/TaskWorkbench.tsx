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
import { PipelineConfiguration } from './PipelineConfiguration';
import { isConfigurationOnlyPipeline, RGR_CONFIGURATION_MESSAGE } from '../shared/pipeline-boundary';

const ACTIVE_RUN_STORAGE_KEY = 'agent-pipeline-ui.active-agent-run';
const ACTIVE_RUN_STATUSES = new Set<AgentExecutionRun['status']>([
  'preparing',
  'awaiting_approval',
  'running',
  'waiting_for_input',
  'validating'
]);
const WORKING_RUN_STATUSES = new Set<AgentExecutionRun['status']>([
  'preparing',
  'running',
  'validating'
]);
const RECENT_RUN_RECOVERY_MS = 12 * 60 * 60 * 1_000;

function keyFor(agent: AgentDefinition): string {
  return `${agent.id}@${agent.relativePath}`;
}

function isPipeline(agent: AgentDefinition): boolean {
  return /·\s*full pipeline\s*$/i.test(agent.name);
}

function isGuidedWorkflow(agent: AgentDefinition): boolean {
  return isPipeline(agent) || /story[-_ ]?intake/i.test(`${agent.id} ${agent.name} ${agent.relativePath}`);
}

function friendlyName(agent: AgentDefinition): string {
  const identity = `${agent.id} ${agent.name} ${agent.relativePath}`.toLowerCase();
  if (/story[-_ ]?intake/.test(identity)) return 'Shape a new Jira story';
  if (/story-orchestrator/.test(identity)) return 'Review or create Jira stories';
  if (/defect.*(?:orchestrator|pipeline)|(?:orchestrator|pipeline).*defect/.test(identity)) return 'Clarify a defect';
  if (/requirement.*(?:orchestrator|pipeline)|(?:orchestrator|pipeline).*requirement/.test(identity)) return 'Analyse requirements';
  if (/test.*(?:orchestrator|pipeline)|(?:orchestrator|pipeline).*test/.test(identity)) return 'Create and review test cases';
  if (/story-evaluator/.test(identity)) return 'Evaluate story quality';
  if (/story-investigator/.test(identity)) return 'Investigate a Jira story';
  if (/story-creator/.test(identity)) return 'Create Jira stories';
  if (/defect|investigat/.test(identity)) return 'Investigate a defect';
  if (/test/.test(identity)) return 'Create or review test cases';
  const value = agent.name.replace(/·\s*full pipeline/i, '').replace(/[-_]+/g, ' ').trim();
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function friendlyDescription(agent: AgentDefinition): string {
  const identity = `${agent.id} ${agent.name} ${agent.relativePath}`;
  if (/story[-_ ]?intake/i.test(identity)) return 'Answer one purposeful question at a time and turn an idea into a governed Jira story.';
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
    case 'execution.started':
    case 'execution.resumed':
    case 'interaction.replied': return 'running';
    case 'interaction.requested': return 'waiting_for_input';
    case 'validation.started':
    case 'validation.completed': return 'validating';
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.cancelled': return 'cancelled';
    default: return null;
  }
}

function providerFailure(events: RunEvent[]): { title: string; message: string } | null {
  const text = events.map((event) => event.message).join('\n');
  if (/oauth session expired|failed to authenticate|claude code.*sign-in|claude code.*login/i.test(text)) {
    return {
      title: 'Claude Code needs attention',
      message: 'Its saved sign-in has expired on this computer. Open a terminal, run `claude`, complete sign-in, then fully restart the workbench.'
    };
  }
  if (/You're not logged in to GitHub|No authentication information found|Authentication token found but could not be validated|copilot_internal\/user|OAuth user login/i.test(text)) {
    return {
      title: 'Copilot needs attention',
      message: 'GitHub Copilot could not use its login in this desktop session. Run `copilot login`, complete sign-in, then fully restart the workbench.'
    };
  }
  return null;
}

function isProcessRuntime(runtime: RuntimeAdapterDescriptor): runtime is RuntimeAdapterDescriptor & { id: ProcessRuntimeId } {
  return runtime.kind === 'process' && (runtime.id === 'claude-code' || runtime.id === 'github-copilot');
}

function isActiveRun(run: AgentExecutionRun | null): boolean {
  return Boolean(run && ACTIVE_RUN_STATUSES.has(run.status));
}

function isRecentRun(run: AgentExecutionRun): boolean {
  return Date.now() - Date.parse(run.updatedAt) <= RECENT_RUN_RECOVERY_MS;
}

function WorkingDots() {
  return (
    <span className="task-working-dots" aria-label="Still working">
      <i /><i /><i />
    </span>
  );
}

function runHeading(status: AgentExecutionRun['status']): string {
  if (status === 'completed') return 'Task completed';
  if (status === 'failed') return 'Task could not be completed';
  if (status === 'cancelled') return 'Task cancelled';
  if (status === 'waiting_for_input') return 'Your input is needed';
  if (status === 'validating') return 'Checking the results';
  return 'Working on your task';
}

export function TaskWorkbench() {
  const [configurationMode, setConfigurationMode] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [library, setLibrary] = useState<AgentLibrarySelection | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [target, setTarget] = useState<ProjectSelection | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [runtimeId, setRuntimeId] = useState<ProcessRuntimeId>('claude-code');
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [run, setRun] = useState<AgentExecutionRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [reply, setReply] = useState('');
  const [restoredRun, setRestoredRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const agents = library?.agents ?? [];
  const guidedWorkflows = agents.filter(isGuidedWorkflow);
  const specialists = agents.filter((agent) => !isGuidedWorkflow(agent));
  const selected = useMemo(() => agents.find((agent) => keyFor(agent) === selectedKey) ?? null, [agents, selectedKey]);
  const processRuntimes = runtimes.filter(isProcessRuntime);
  const selectedRuntime = processRuntimes.find((runtime) => runtime.id === runtimeId) ?? null;
  const visibleEvents = run ? events.filter((event) => event.runId === run.id) : [];
  const friendlyProviderError = providerFailure(visibleEvents);
  const active = isActiveRun(run) || busy;
  const runDisplayName = selected ? friendlyName(selected) : run?.agentName?.replace(/·\s*full pipeline/i, '') ?? 'Previous task';
  const runTargetName = target?.name ?? run?.targetProject.name ?? 'the selected project';
  const runIsWorking = Boolean(run && WORKING_RUN_STATUSES.has(run.status));
  const conversation = run?.conversation ?? [];
  const pendingQuestion = run?.pendingQuestion;

  useEffect(() => {
    window.agentPipeline.listRuntimes().then((available) => {
      setRuntimes(available);
      const preferred = available.find((runtime) => isProcessRuntime(runtime) && runtime.status === 'available');
      if (preferred && isProcessRuntime(preferred) && !localStorage.getItem(ACTIVE_RUN_STORAGE_KEY)) setRuntimeId(preferred.id);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    let disposed = false;
    async function restoreRun(): Promise<void> {
      const storedRunId = localStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
      let record = storedRunId ? await window.agentPipeline.getAgentExecutionRun(storedRunId) : null;
      if (!record) record = await window.agentPipeline.getLatestAgentExecutionRun();
      if (!record || disposed) {
        if (storedRunId) localStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
        return;
      }
      if (!storedRunId && !isActiveRun(record) && !isRecentRun(record)) return;

      localStorage.setItem(ACTIVE_RUN_STORAGE_KEY, record.id);
      setRun(record);
      setTarget(record.targetProject);
      setRuntimeId(record.runtimeId);
      setInputs(record.inputs);
      setEvents(await window.agentPipeline.getAgentExecutionEvents(record.id));
      setRestoredRun(true);
    }
    void restoreRun().catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => window.agentPipeline.onRunEvent((event) => {
    setEvents((current) => [...current.filter((existing) => !(existing.runId === event.runId && existing.sequence === event.sequence)), event].slice(-2_000));
    const status = statusFromEvent(event);
    if (!status) return;
    setRun((current) => current?.id === event.runId ? { ...current, status, updatedAt: event.timestamp } : current);
    if (['waiting_for_input', 'completed', 'failed', 'cancelled'].includes(status)) {
      void window.agentPipeline.getAgentExecutionRun(event.runId).then((record) => record && setRun(record));
    }
  }), []);

  useEffect(() => {
    if (!run?.id) return;
    localStorage.setItem(ACTIVE_RUN_STORAGE_KEY, run.id);

    let disposed = false;
    async function refreshRun(): Promise<void> {
      const [record, persistedEvents] = await Promise.all([
        window.agentPipeline.getAgentExecutionRun(run!.id),
        window.agentPipeline.getAgentExecutionEvents(run!.id)
      ]);
      if (disposed) return;
      if (record) setRun(record);
      setEvents(persistedEvents);
    }

    void refreshRun().catch(() => undefined);
    if (!ACTIVE_RUN_STATUSES.has(run.status)) return () => { disposed = true; };
    const interval = window.setInterval(() => { void refreshRun().catch(() => undefined); }, 1_500);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!selected || active || run) return;
    setInputs(Object.fromEntries(selected.inputs.map((input) => [input.name, ''])));
    setEvents([]);
  }, [selectedKey]);

  useEffect(() => {
    setReply('');
  }, [pendingQuestion?.id]);

  function clearCurrentRun(): void {
    localStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
    setRun(null);
    setEvents([]);
    setReply('');
    setRestoredRun(false);
    setError('');
  }

  async function chooseWorkflowRepository(): Promise<void> {
    if (active) return;
    setError('');
    try {
      const selection = await window.agentPipeline.selectAgentLibrary();
      if (!selection) return;
      clearCurrentRun();
      setLibrary(selection);
      setTarget(selection.source.isGitRepository ? selection.source : null);
      const preferred = selection.agents.find(isGuidedWorkflow) ?? selection.agents[0];
      setSelectedKey(preferred ? keyFor(preferred) : '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function chooseTarget(): Promise<void> {
    if (active) return;
    const selection = await window.agentPipeline.selectProjectDirectory();
    if (selection) setTarget(selection);
  }

  async function openConnections(): Promise<void> {
    setError('');
    try {
      await window.agentPipeline.openAgentWorkbench();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function prepare(): Promise<void> {
    if (!selected || !target?.isGitRepository || !selectedRuntime || selectedRuntime.status !== 'available') return;
    setBusy(true);
    setError('');
    setEvents([]);
    try {
      const prepared = await window.agentPipeline.prepareAgentExecution({
        agentSourceRoot: selected.sourceRoot,
        agentRelativePath: selected.relativePath,
        agentId: selected.id,
        targetProject: target,
        runtimeId,
        inputs
      });
      localStorage.setItem(ACTIVE_RUN_STORAGE_KEY, prepared.id);
      setRun(prepared);
      setRestoredRun(false);
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
      const started = await window.agentPipeline.approveAndStartAgentExecution(run.id);
      localStorage.setItem(ACTIVE_RUN_STORAGE_KEY, started.id);
      setRun(started);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      const refreshed = await window.agentPipeline.getAgentExecutionRun(run.id);
      if (refreshed) setRun(refreshed);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(): Promise<void> {
    if (!run || run.status !== 'waiting_for_input' || !pendingQuestion || !reply.trim()) return;
    setBusy(true);
    setError('');
    try {
      const resumed = await window.agentPipeline.replyToAgentExecution({
        runId: run.id,
        questionId: pendingQuestion.id,
        reply: reply.trim()
      });
      setReply('');
      setRun(resumed);
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

  if (configurationMode) return <PipelineConfiguration onBack={() => setConfigurationMode(false)} />;

  if (advancedMode) {
    return (
      <div className="advanced-workbench-shell">
        <div className="advanced-workbench-nav">
          <button type="button" onClick={() => setAdvancedMode(false)}>← Back to guided workbench</button>
          {run && <span>{runDisplayName} · {run.status.replaceAll('_', ' ')}</span>}
        </div>
        <AgentWorkbench />
      </div>
    );
  }

  const requiredComplete = Boolean(selected && selected.inputs.every((input) => {
    const value = inputs[input.name];
    return !input.required || String(value ?? '').trim().length > 0;
  }));
  const configurationOnly = Boolean(selected && isConfigurationOnlyPipeline(selected.id, selected.relativePath));
  const canPrepare = Boolean(selected && !configurationOnly && target?.isGitRepository && selectedRuntime?.status === 'available' && requiredComplete && !active);
  const canSendReply = Boolean(pendingQuestion && reply.trim() && !busy && (pendingQuestion.allowFreeText || pendingQuestion.choices.includes(reply.trim())));

  return (
    <div className="task-shell">
      <header className="task-header">
        <div>
          <span className="task-kicker">QUALITY WORKBENCH</span>
          <h1>What would you like help with?</h1>
          <p>Choose a workflow, provide the ticket or task, and let the workbench guide the rest.</p>
        </div>
        <div className="task-header-actions">
          <button type="button" disabled={active} onClick={() => setConfigurationMode(true)}>Pipeline configuration</button>
          <button type="button" onClick={() => { void openConnections(); }}>Connections</button>
          <button type="button" onClick={() => setAdvancedMode(true)}>Advanced</button>
        </div>
      </header>

      {error && <div className="task-alert error" role="alert">{error}</div>}
      {configurationOnly && <div className="task-alert info" role="status">{RGR_CONFIGURATION_MESSAGE}</div>}
      {restoredRun && run && <div className="task-alert info" role="status"><strong>Previous run restored</strong><span>The workbench reconnected to {runDisplayName}. Current status: {run.status.replaceAll('_', ' ')}.</span></div>}
      {friendlyProviderError && <div className="task-alert warning" role="alert"><strong>{friendlyProviderError.title}</strong><span>{friendlyProviderError.message}</span></div>}

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
              {guidedWorkflows.length > 0 && <><h3>Guided workflows</h3><div className="task-card-grid">{guidedWorkflows.map((agent) => {
                const key = keyFor(agent);
                return <button key={key} type="button" disabled={active} className={selectedKey === key ? 'task-card selected' : 'task-card'} onClick={() => setSelectedKey(key)}><span className="task-card-icon">◆</span><strong>{friendlyName(agent)}</strong><small>{friendlyDescription(agent)}</small><em>{agent.interactive ? 'Guided conversation' : 'Complete workflow'}</em></button>;
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
                <small>The workbench checks the provider before creating the safe worktree. Interactive workflows preserve their provider session between questions.</small>
              </details>

              {!run && <div className="task-primary-row"><button className="task-primary" type="button" disabled={!canPrepare} onClick={prepare}>{busy && <span className="task-inline-spinner" aria-hidden="true" />}{busy ? 'Checking provider…' : 'Continue'}</button></div>}
            </div>
          </section>
        )}

        {busy && !run && (
          <section className="task-busy-card" role="status" aria-live="polite">
            <span className="task-busy-spinner" aria-hidden="true" />
            <div>
              <strong>Getting things ready</strong>
              <span>Checking {selectedRuntime?.name ?? 'the selected provider'} and preparing a safe workspace. This can take a little while.</span>
            </div>
            <WorkingDots />
          </section>
        )}

        {run?.status === 'awaiting_approval' && (
          <section className="task-confirmation">
            <span className="task-confirm-icon">✓</span>
            <div><h2>Ready to start</h2><p>The workbench prepared a safe, isolated copy of <strong>{runTargetName}</strong>. It will run <strong>{runDisplayName}</strong> and will not commit, push, merge or deploy anything.</p>{run.runtimePolicy.missingEnvironment.length > 0 && <div className="task-alert warning">Connections still required: {run.runtimePolicy.missingEnvironment.join(', ')}</div>}</div>
            <div className="task-confirm-actions"><button type="button" onClick={cancel}>Cancel</button><button className="task-primary" type="button" disabled={busy || run.runtimePolicy.missingEnvironment.length > 0} onClick={start}>{busy && <span className="task-inline-spinner" aria-hidden="true" />}{busy ? 'Starting…' : 'Start task'}</button></div>
          </section>
        )}

        {run && run.status !== 'awaiting_approval' && (
          <section className={`task-progress ${run.status}`} aria-live="polite">
            <div className="task-progress-heading"><div><span className="task-progress-dot"/><h2>{runHeading(run.status)}</h2>{runIsWorking && <WorkingDots />}</div><button type="button" onClick={() => window.agentPipeline.openPath(run.storagePath)}>Open details</button></div>

            {conversation.length > 0 && (
              <div className="task-conversation" aria-label="Task conversation">
                {conversation.map((message) => (
                  <article className={`task-message ${message.role}`} key={message.id}>
                    <span>{message.role === 'assistant' ? 'Workbench' : message.role === 'user' ? 'You' : 'System'}</span>
                    <p>{message.content}</p>
                    <time>{new Date(message.timestamp).toLocaleTimeString()}</time>
                  </article>
                ))}
              </div>
            )}

            {run.status === 'waiting_for_input' && pendingQuestion && (
              <div className="task-reply-panel">
                <div className="task-question-heading">
                  <span className="task-question-icon">?</span>
                  <div><strong>{pendingQuestion.question}</strong>{pendingQuestion.reason && <p>{pendingQuestion.reason}</p>}</div>
                </div>
                {pendingQuestion.choices.length > 0 && <div className="task-reply-choices">{pendingQuestion.choices.map((choice) => <button className={reply === choice ? 'selected' : ''} type="button" key={choice} disabled={busy} onClick={() => setReply(choice)}>{choice}</button>)}</div>}
                {pendingQuestion.allowFreeText && <label className="task-reply-field"><span>Your answer</span><textarea autoFocus rows={4} disabled={busy} value={reply} placeholder="Type your answer here. The workflow will continue from this exact point." onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSendReply) void sendReply(); }} /></label>}
                <div className="task-reply-actions"><small>Your answer is saved with this run. Press Ctrl/⌘ + Enter to send.</small><button className="task-primary" type="button" disabled={!canSendReply} onClick={sendReply}>{busy && <span className="task-inline-spinner" aria-hidden="true" />}{busy ? 'Continuing…' : 'Send answer and continue'}</button></div>
              </div>
            )}

            <details className="task-progress-details">
              <summary>Technical progress</summary>
              <div className="task-progress-list">
                {visibleEvents.length === 0 && <div><time>Now</time><span>Run status restored. Waiting for the next persisted update…</span></div>}
                {visibleEvents.slice(-12).map((event) => <div key={`${event.runId}-${event.sequence}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><span>{event.message.startsWith('{') ? 'Processing workflow step…' : event.message}</span></div>)}
              </div>
            </details>

            {run.status === 'completed' && run.resultSummary && <div className="task-result-summary"><strong>Result</strong><p>{run.resultSummary}</p></div>}
            {run.status === 'failed' && run.error && <div className="task-alert error"><strong>What stopped the task</strong><span>{run.error}</span></div>}

            <div className="task-progress-actions">
              <button type="button" onClick={() => window.agentPipeline.openPath(run.worktreePath)}>Open results</button>
              {['running', 'waiting_for_input', 'validating'].includes(run.status) && <button type="button" onClick={cancel}>Cancel</button>}
              {!ACTIVE_RUN_STATUSES.has(run.status) && <button type="button" onClick={clearCurrentRun}>Start a new task</button>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
