import { useEffect, useMemo, useState } from 'react';
import type {
  ExecutionRun,
  PipelineInputProperty,
  PipelineManifest,
  PreviewRun,
  ProcessRuntimeId,
  ProjectSelection,
  RunEvent,
  RuntimeAdapterDescriptor,
  SystemInfo
} from '../shared/contracts';

type RunMode = 'preview' | 'execution' | null;

function statusLabel(status: RuntimeAdapterDescriptor['status']): string {
  return status === 'available' ? 'Ready' : status === 'unavailable' ? 'Unavailable' : 'Configure';
}

function pipelineKey(pipeline: Pick<PipelineManifest, 'id' | 'version'>): string {
  return `${pipeline.id}@${pipeline.version}`;
}

function isConfigurableRuntime(runtime: RuntimeAdapterDescriptor | null): runtime is RuntimeAdapterDescriptor & { id: ProcessRuntimeId } {
  return runtime?.kind === 'process' && (runtime.id === 'claude-code' || runtime.id === 'github-copilot');
}

function previewStatusFromEvent(event: RunEvent): PreviewRun['status'] | null {
  switch (event.type) {
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.cancelled': return 'cancelled';
    case 'run.started': return 'running';
    default: return null;
  }
}

function executionStatusFromEvent(event: RunEvent): ExecutionRun['status'] | null {
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

function Field({
  name,
  property,
  value,
  required,
  disabled,
  onChange
}: {
  name: string;
  property: PipelineInputProperty;
  value: unknown;
  required: boolean;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = `input-${name}`;
  if (property.type === 'boolean') {
    return (
      <label className="checkbox-field" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          disabled={disabled}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <strong>{property.title}</strong>
          {property.description && <small>{property.description}</small>}
        </span>
      </label>
    );
  }

  const shared = {
    id,
    required,
    disabled,
    value: value == null ? '' : String(value),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(property.type === 'number' ? Number(event.target.value) : event.target.value)
  };

  return (
    <label className="field" htmlFor={id}>
      <span>{property.title}{required ? ' *' : ''}</span>
      {property.enum ? (
        <select {...shared}>
          <option value="">Select…</option>
          {property.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
        </select>
      ) : property.multiline ? (
        <textarea {...shared} rows={4} />
      ) : (
        <input {...shared} type={property.secret ? 'password' : property.type === 'number' ? 'number' : 'text'} />
      )}
      {property.description && <small>{property.description}</small>}
    </label>
  );
}

export function App() {
  const [pipelines, setPipelines] = useState<PipelineManifest[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [project, setProject] = useState<ProjectSelection | null>(null);
  const [selectedPipelineKey, setSelectedPipelineKey] = useState('');
  const [runtimeId, setRuntimeId] = useState('');
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [previewRun, setPreviewRun] = useState<PreviewRun | null>(null);
  const [executionRun, setExecutionRun] = useState<ExecutionRun | null>(null);
  const [runMode, setRunMode] = useState<RunMode>(null);
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);

  async function refreshPipelines(preferredKey?: string): Promise<void> {
    const pipelineList = await window.agentPipeline.listPipelines();
    setPipelines(pipelineList);
    setSelectedPipelineKey((current) => {
      if (preferredKey && pipelineList.some((pipeline) => pipelineKey(pipeline) === preferredKey)) return preferredKey;
      if (pipelineList.some((pipeline) => pipelineKey(pipeline) === current)) return current;
      return pipelineList[0] ? pipelineKey(pipelineList[0]) : '';
    });
  }

  function applyRuntimeList(runtimeList: RuntimeAdapterDescriptor[]): void {
    setRuntimes(runtimeList);
    setRuntimeId((current) => runtimeList.some((runtime) => runtime.id === current)
      ? current
      : runtimeList.find((runtime) => runtime.status === 'available')?.id ?? runtimeList[0]?.id ?? '');
  }

  async function refreshRuntimes(): Promise<void> {
    setCatalogBusy(true);
    try {
      applyRuntimeList(await window.agentPipeline.listRuntimes());
    } finally {
      setCatalogBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([
      window.agentPipeline.listPipelines(),
      window.agentPipeline.listRuntimes(),
      window.agentPipeline.getSystemInfo()
    ]).then(([pipelineList, runtimeList, info]) => {
      setPipelines(pipelineList);
      setRuntimes(runtimeList);
      setSystem(info);
      setSelectedPipelineKey(pipelineList[0] ? pipelineKey(pipelineList[0]) : '');
      setRuntimeId(runtimeList.find((runtime) => runtime.status === 'available')?.id ?? runtimeList[0]?.id ?? '');
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => window.agentPipeline.onRunEvent((event) => {
    setEvents((current) => [...current, event].slice(-1_000));
    const previewStatus = previewStatusFromEvent(event);
    if (previewStatus) {
      setPreviewRun((current) => current?.id === event.runId
        ? { ...current, status: previewStatus, updatedAt: event.timestamp }
        : current);
    }
    const executionStatus = executionStatusFromEvent(event);
    if (executionStatus) {
      setExecutionRun((current) => current?.id === event.runId
        ? { ...current, status: executionStatus, updatedAt: event.timestamp }
        : current);
    }
  }), []);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipelineKey(pipeline) === selectedPipelineKey) ?? null,
    [selectedPipelineKey, pipelines]
  );
  const selectedRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === runtimeId) ?? null,
    [runtimeId, runtimes]
  );

  const previewActive = previewRun?.status === 'starting' || previewRun?.status === 'running';
  const executionBlocking = executionRun?.status === 'preparing'
    || executionRun?.status === 'awaiting_approval'
    || executionRun?.status === 'running'
    || executionRun?.status === 'validating';
  const runBlocking = Boolean(previewActive || executionBlocking || busy);

  useEffect(() => {
    if (!selectedPipeline || runBlocking) return;
    const defaults: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(selectedPipeline.inputSchema.properties)) {
      if (property.default !== undefined) defaults[name] = property.default;
    }
    setInputs(defaults);
    setPreviewRun(null);
    setExecutionRun(null);
    setRunMode(null);
    setApprovalAcknowledged(false);
    setEvents([]);
  }, [selectedPipeline, runBlocking]);

  function currentRequest() {
    if (!project || !selectedPipeline || !runtimeId) throw new Error('Project, pipeline and runtime are required');
    return {
      project,
      pipelineId: selectedPipeline.id,
      pipelineVersion: selectedPipeline.version,
      runtimeId,
      inputs
    };
  }

  async function chooseProject(): Promise<void> {
    if (runBlocking) return;
    const selection = await window.agentPipeline.selectProjectDirectory();
    if (selection) {
      setProject(selection);
      setPreviewRun(null);
      setExecutionRun(null);
      setRunMode(null);
      setApprovalAcknowledged(false);
      setEvents([]);
    }
  }

  async function installPack(): Promise<void> {
    if (runBlocking) return;
    setCatalogBusy(true);
    setError('');
    try {
      const installed = await window.agentPipeline.installPipelinePack();
      if (installed) await refreshPipelines(pipelineKey(installed));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCatalogBusy(false);
    }
  }

  async function configureSelectedRuntime(): Promise<void> {
    if (!isConfigurableRuntime(selectedRuntime) || runBlocking) return;
    setCatalogBusy(true);
    setError('');
    try {
      applyRuntimeList(await window.agentPipeline.configureRuntimeExecutable(selectedRuntime.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCatalogBusy(false);
    }
  }

  async function clearSelectedRuntime(): Promise<void> {
    if (!isConfigurableRuntime(selectedRuntime) || runBlocking) return;
    setCatalogBusy(true);
    setError('');
    try {
      applyRuntimeList(await window.agentPipeline.clearRuntimeExecutable(selectedRuntime.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCatalogBusy(false);
    }
  }

  async function startPreview(): Promise<void> {
    setBusy(true);
    setError('');
    setEvents([]);
    setExecutionRun(null);
    setApprovalAcknowledged(false);
    setRunMode('preview');
    try {
      setPreviewRun(await window.agentPipeline.startPreviewRun(currentRequest()));
    } catch (reason) {
      setRunMode(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function prepareExecution(): Promise<void> {
    setBusy(true);
    setError('');
    setEvents([]);
    setPreviewRun(null);
    setApprovalAcknowledged(false);
    setRunMode('execution');
    try {
      setExecutionRun(await window.agentPipeline.prepareExecution(currentRequest()));
    } catch (reason) {
      setRunMode(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function approveExecution(): Promise<void> {
    if (!executionRun || !approvalAcknowledged) return;
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

  async function cancelCurrentRun(): Promise<void> {
    setError('');
    if (runMode === 'preview' && previewRun) {
      const cancelled = await window.agentPipeline.cancelPreviewRun(previewRun.id);
      if (!cancelled) setError('The preview process is no longer active.');
      return;
    }
    if (runMode === 'execution' && executionRun) {
      const cancelled = await window.agentPipeline.cancelExecution(executionRun.id);
      if (!cancelled) {
        setError('The execution can no longer be cancelled from its current state.');
        return;
      }
      const updated = await window.agentPipeline.getExecutionRun(executionRun.id);
      if (updated) setExecutionRun(updated);
    }
  }

  const required = new Set(selectedPipeline?.inputSchema.required ?? []);
  const requiredComplete = [...required].every((name) => {
    const value = inputs[name];
    return value !== undefined && value !== null && String(value).trim().length > 0;
  });
  const runtimeSupported = Boolean(selectedPipeline && selectedRuntime && selectedPipeline.supportedRuntimes.includes(selectedRuntime.id));
  const baseReady = Boolean(
    project?.isGitRepository
      && selectedPipeline
      && selectedRuntime?.status === 'available'
      && runtimeSupported
      && requiredComplete
      && !runBlocking
  );
  const canPreview = baseReady;
  const canPrepareExecution = Boolean(baseReady && selectedPipeline?.execution && isConfigurableRuntime(selectedRuntime));
  const activeRunId = runMode === 'execution' ? executionRun?.id : previewRun?.id;
  const activeStatus = runMode === 'execution' ? executionRun?.status : previewRun?.status;
  const visibleEvents = activeRunId ? events.filter((event) => event.runId === activeRunId) : [];
  const canCancel = Boolean(previewActive || executionBlocking);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL AGENT WORKBENCH</span>
          <h1>Forge Console</h1>
          <p>Preview any compatible pipeline, or explicitly approve isolated write execution for packs that declare a validated execution contract.</p>
        </div>
        <div className="system-pill">
          <span className="status-dot" />
          {system ? `${system.platform} · ${system.arch} · v${system.appVersion}` : 'Loading system…'}
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <main className="workspace">
        <aside className="sidebar">
          <section>
            <h2>Project</h2>
            <button className="project-button" type="button" disabled={runBlocking} onClick={chooseProject}>
              <span className="project-icon">⌘</span>
              <span>
                <strong>{project?.name ?? 'Choose repository'}</strong>
                <small>{project?.path ?? 'Select a local folder'}</small>
              </span>
            </button>
            {project && <span className={`git-badge ${project.isGitRepository ? 'ok' : 'warn'}`}>{project.isGitRepository ? 'Git repository' : 'No .git detected'}</span>}
          </section>

          <section>
            <div className="sidebar-title"><h2>Pipeline</h2><button type="button" onClick={installPack} disabled={catalogBusy || runBlocking}>Install</button></div>
            <div className="option-list">
              {pipelines.map((pipeline) => {
                const key = pipelineKey(pipeline);
                return (
                  <button
                    className={key === selectedPipelineKey ? 'option active' : 'option'}
                    key={key}
                    type="button"
                    disabled={runBlocking}
                    onClick={() => setSelectedPipelineKey(key)}
                  >
                    <span className="option-row"><strong>{pipeline.name}</strong>{pipeline.execution && <em className="executable">Execute</em>}</span>
                    <small>v{pipeline.version} · {pipeline.stages.length} stages</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <div className="sidebar-title"><h2>Runtime</h2><button type="button" onClick={refreshRuntimes} disabled={catalogBusy || runBlocking}>Refresh</button></div>
            <div className="option-list">
              {runtimes.map((runtime) => (
                <button
                  className={runtime.id === runtimeId ? 'option active' : 'option'}
                  key={runtime.id}
                  type="button"
                  disabled={runBlocking}
                  onClick={() => setRuntimeId(runtime.id)}
                >
                  <span className="option-row"><strong>{runtime.name}</strong><em className={runtime.status}>{statusLabel(runtime.status)}</em></span>
                  <small>{runtime.version ?? `${runtime.kind} adapter`}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="content">
          {selectedPipeline ? (
            <>
              <div className="pipeline-heading">
                <div>
                  <span className="eyebrow">SELECTED PIPELINE</span>
                  <h2>{selectedPipeline.name}</h2>
                  <p>{selectedPipeline.description}</p>
                </div>
                <div className="heading-chips">
                  <span className={`mode-chip ${selectedPipeline.execution ? 'execute' : 'preview'}`}>{selectedPipeline.execution ? 'Executable pack' : 'Preview only'}</span>
                  <span className="version-chip">{selectedPipeline.version}</span>
                </div>
              </div>

              <div className="stage-track" aria-label="Pipeline stages">
                {[...selectedPipeline.stages].sort((a, b) => a.order - b.order).map((stage, index) => (
                  <div className="stage" key={stage.id}>
                    <span>{index + 1}</span>
                    <div><strong>{stage.name}</strong><small>{stage.role}</small></div>
                  </div>
                ))}
              </div>

              <div className="form-panel">
                <div className="section-title">
                  <div><span className="eyebrow">RUN INPUT</span><h3>Configure task</h3></div>
                  <span>{selectedPipeline.execution ? 'Preview or isolated execution' : 'Read-only preview'}</span>
                </div>
                <div className="form-grid">
                  {Object.entries(selectedPipeline.inputSchema.properties).map(([name, property]) => (
                    <Field
                      key={name}
                      name={name}
                      property={property}
                      required={required.has(name)}
                      disabled={runBlocking}
                      value={inputs[name]}
                      onChange={(value) => setInputs((current) => ({ ...current, [name]: value }))}
                    />
                  ))}
                </div>

                {selectedRuntime && (
                  <div className={`runtime-configuration ${selectedRuntime.status}`}>
                    <div>
                      <strong>{selectedRuntime.name}</strong>
                      <small>{selectedRuntime.executablePath ?? selectedRuntime.configurationHint ?? 'No executable path configured.'}</small>
                      {selectedRuntime.executableSource && <span>{selectedRuntime.executableSource === 'configured' ? 'Manual executable' : 'Automatically discovered'}</span>}
                    </div>
                    {isConfigurableRuntime(selectedRuntime) && (
                      <div>
                        {selectedRuntime.executableSource === 'configured' && <button type="button" onClick={clearSelectedRuntime} disabled={catalogBusy || runBlocking}>Use automatic</button>}
                        <button type="button" onClick={configureSelectedRuntime} disabled={catalogBusy || runBlocking}>Choose executable</button>
                      </div>
                    )}
                  </div>
                )}
                {selectedRuntime && !runtimeSupported && (
                  <div className="runtime-hint">This pipeline does not declare support for {selectedRuntime.name}.</div>
                )}

                <div className="actions">
                  <button className="secondary" type="button" disabled={!project} onClick={() => project && window.agentPipeline.openPath(project.path)}>Open project</button>
                  {canCancel && runMode === 'preview' && <button className="danger" type="button" onClick={cancelCurrentRun}>Cancel preview</button>}
                  <button className="secondary" type="button" disabled={!canPreview} onClick={startPreview}>{busy && runMode === 'preview' ? 'Starting…' : 'Run read-only preview'}</button>
                  {selectedPipeline.execution && (
                    <button className="primary" type="button" disabled={!canPrepareExecution} onClick={prepareExecution}>{busy && runMode === 'execution' ? 'Preparing…' : 'Prepare isolated execution'}</button>
                  )}
                </div>
              </div>

              {executionRun?.status === 'awaiting_approval' && (
                <section className="approval-panel" aria-labelledby="execution-approval-title">
                  <div className="approval-heading">
                    <div>
                      <span className="eyebrow">EXPLICIT APPROVAL REQUIRED</span>
                      <h3 id="execution-approval-title">Review the isolated execution boundary</h3>
                    </div>
                    <span className="approval-status">Not started</span>
                  </div>

                  <dl className="execution-details">
                    <div><dt>Branch</dt><dd>{executionRun.branchName}</dd></div>
                    <div><dt>Base revision</dt><dd><code>{executionRun.baseRevision.slice(0, 12)}</code></dd></div>
                    <div><dt>Worktree</dt><dd>{executionRun.worktreePath}</dd></div>
                    <div><dt>Working directory</dt><dd>{executionRun.workingDirectory}</dd></div>
                    <div><dt>Maximum turns</dt><dd>{executionRun.runtimePolicy.maxTurns}</dd></div>
                  </dl>

                  <div className="policy-grid">
                    <div><strong>File writes</strong><span>Isolated worktree only</span></div>
                    <div><strong>Model shell</strong><span>Denied</span></div>
                    <div><strong>Model network</strong><span>Denied</span></div>
                    <div><strong>Publication</strong><span>No commit, push, merge or deploy</span></div>
                  </div>

                  <div className="validation-list">
                    <h4>Controller-owned validation commands</h4>
                    {executionRun.runtimePolicy.validationCommands.length === 0 ? (
                      <p>No post-run validation commands are declared.</p>
                    ) : executionRun.runtimePolicy.validationCommands.map((command) => {
                      const executable = system?.platform === 'win32' && command.windowsExecutable
                        ? command.windowsExecutable
                        : command.executable;
                      return (
                        <div key={command.id}>
                          <span>{command.required ? 'Required' : 'Optional'}</span>
                          <strong>{command.name}</strong>
                          <code>{[executable, ...command.args].join(' ')}</code>
                          <small>cwd: {command.cwd ?? '.'} · timeout: {command.timeoutSeconds}s</small>
                        </div>
                      );
                    })}
                  </div>

                  <label className="approval-check">
                    <input type="checkbox" checked={approvalAcknowledged} onChange={(event) => setApprovalAcknowledged(event.target.checked)} />
                    <span>I understand that the selected AI runtime may edit files only in this worktree and that the listed commands will run locally after its session.</span>
                  </label>

                  <div className="approval-actions">
                    <button className="secondary" type="button" onClick={() => window.agentPipeline.openPath(executionRun.worktreePath)}>Open worktree</button>
                    <button className="danger" type="button" onClick={cancelCurrentRun}>Discard prepared execution</button>
                    <button className="primary" type="button" disabled={!approvalAcknowledged || busy} onClick={approveExecution}>{busy ? 'Starting…' : 'Approve and start'}</button>
                  </div>
                </section>
              )}

              {executionRun && executionRun.status !== 'awaiting_approval' && (
                <div className={`execution-summary ${executionRun.status}`}>
                  <div>
                    <span className={`run-state ${executionRun.status.replaceAll('_', '-')}`} />
                    <strong>Isolated execution: {executionRun.status.replaceAll('_', ' ')}</strong>
                  </div>
                  <span>{executionRun.branchName}</span>
                  <div className="execution-summary-actions">
                    <button type="button" onClick={() => window.agentPipeline.openPath(executionRun.worktreePath)}>Open worktree</button>
                    {(executionRun.status === 'running' || executionRun.status === 'validating') && <button className="danger-link" type="button" onClick={cancelCurrentRun}>Cancel</button>}
                  </div>
                </div>
              )}

              {activeRunId && (
                <div className="run-console">
                  <div className="console-heading">
                    <div><span className={`run-state ${(activeStatus ?? 'starting').replaceAll('_', '-')}`} /><strong>{(activeStatus ?? 'starting').replaceAll('_', ' ')}</strong></div>
                    <code>{activeRunId}</code>
                  </div>
                  <div className="console-output" aria-live="polite">
                    {visibleEvents.length === 0 ? <span>Waiting for runtime output…</span> : visibleEvents.map((event) => (
                      <div className={`console-line ${event.type.replaceAll('.', '-')}`} key={`${event.runId}-${event.sequence}`}>
                        <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                        <span>{event.message}</span>
                      </div>
                    ))}
                  </div>
                  <div className="console-actions">
                    {executionRun && runMode === 'execution' && <button type="button" onClick={() => window.agentPipeline.openPath(executionRun.worktreePath)}>Open worktree</button>}
                    {(executionRun || previewRun) && <button type="button" onClick={() => window.agentPipeline.openPath((executionRun ?? previewRun)!.storagePath)}>Open run folder</button>}
                  </div>
                </div>
              )}
            </>
          ) : <div className="empty">No pipeline packs found.</div>}
        </section>
      </main>
    </div>
  );
}
