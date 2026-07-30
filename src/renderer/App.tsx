import { useEffect, useMemo, useState } from 'react';
import type {
  PipelineInputProperty,
  PipelineManifest,
  PreviewRun,
  ProcessRuntimeId,
  ProjectSelection,
  RunEvent,
  RuntimeAdapterDescriptor,
  SystemInfo
} from '../shared/contracts';

function statusLabel(status: RuntimeAdapterDescriptor['status']): string {
  return status === 'available' ? 'Ready' : status === 'unavailable' ? 'Unavailable' : 'Configure';
}

function pipelineKey(pipeline: Pick<PipelineManifest, 'id' | 'version'>): string {
  return `${pipeline.id}@${pipeline.version}`;
}

function isConfigurableRuntime(runtime: RuntimeAdapterDescriptor | null): runtime is RuntimeAdapterDescriptor & { id: ProcessRuntimeId } {
  return runtime?.kind === 'process' && (runtime.id === 'claude-code' || runtime.id === 'github-copilot');
}

function runStatusFromEvent(event: RunEvent): PreviewRun['status'] | null {
  switch (event.type) {
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.cancelled': return 'cancelled';
    case 'run.started': return 'running';
    default: return null;
  }
}

function Field({
  name,
  property,
  value,
  required,
  onChange
}: {
  name: string;
  property: PipelineInputProperty;
  value: unknown;
  required: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = `input-${name}`;
  if (property.type === 'boolean') {
    return (
      <label className="checkbox-field" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
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
    setEvents((current) => [...current, event].slice(-500));
    const status = runStatusFromEvent(event);
    if (status) {
      setPreviewRun((current) => current?.id === event.runId ? { ...current, status, updatedAt: event.timestamp } : current);
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

  useEffect(() => {
    if (!selectedPipeline) return;
    const defaults: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(selectedPipeline.inputSchema.properties)) {
      if (property.default !== undefined) defaults[name] = property.default;
    }
    setInputs(defaults);
    setPreviewRun(null);
    setEvents([]);
  }, [selectedPipeline]);

  async function chooseProject(): Promise<void> {
    const selection = await window.agentPipeline.selectProjectDirectory();
    if (selection) {
      setProject(selection);
      setPreviewRun(null);
      setEvents([]);
    }
  }

  async function installPack(): Promise<void> {
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
    if (!isConfigurableRuntime(selectedRuntime)) return;
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
    if (!isConfigurableRuntime(selectedRuntime)) return;
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
    if (!project || !selectedPipeline || !runtimeId) return;
    setBusy(true);
    setError('');
    setEvents([]);
    try {
      const run = await window.agentPipeline.startPreviewRun({
        project,
        pipelineId: selectedPipeline.id,
        pipelineVersion: selectedPipeline.version,
        runtimeId,
        inputs
      });
      setPreviewRun(run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancelPreview(): Promise<void> {
    if (!previewRun) return;
    const cancelled = await window.agentPipeline.cancelPreviewRun(previewRun.id);
    if (!cancelled) setError('The preview process is no longer active.');
  }

  const required = new Set(selectedPipeline?.inputSchema.required ?? []);
  const requiredComplete = [...required].every((name) => {
    const value = inputs[name];
    return value !== undefined && value !== null && String(value).trim().length > 0;
  });
  const runtimeSupported = Boolean(selectedPipeline && selectedRuntime && selectedPipeline.supportedRuntimes.includes(selectedRuntime.id));
  const canPreview = Boolean(
    project?.isGitRepository && selectedPipeline && selectedRuntime?.status === 'available' && runtimeSupported && requiredComplete && !busy
  );
  const visibleEvents = previewRun ? events.filter((event) => event.runId === previewRun.id) : events;
  const runActive = previewRun?.status === 'starting' || previewRun?.status === 'running';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL AGENT WORKBENCH</span>
          <h1>Agent Pipeline UI</h1>
          <p>Choose a project, install a pipeline pack and use any compatible agent runtime from one local desktop application.</p>
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
            <button className="project-button" type="button" onClick={chooseProject}>
              <span className="project-icon">⌘</span>
              <span>
                <strong>{project?.name ?? 'Choose repository'}</strong>
                <small>{project?.path ?? 'Select a local folder'}</small>
              </span>
            </button>
            {project && <span className={`git-badge ${project.isGitRepository ? 'ok' : 'warn'}`}>{project.isGitRepository ? 'Git repository' : 'No .git detected'}</span>}
          </section>

          <section>
            <div className="sidebar-title"><h2>Pipeline</h2><button type="button" onClick={installPack} disabled={catalogBusy}>Install</button></div>
            <div className="option-list">
              {pipelines.map((pipeline) => {
                const key = pipelineKey(pipeline);
                return (
                  <button
                    className={key === selectedPipelineKey ? 'option active' : 'option'}
                    key={key}
                    type="button"
                    onClick={() => setSelectedPipelineKey(key)}
                  >
                    <strong>{pipeline.name}</strong>
                    <small>v{pipeline.version} · {pipeline.stages.length} stages</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <div className="sidebar-title"><h2>Runtime</h2><button type="button" onClick={refreshRuntimes} disabled={catalogBusy}>Refresh</button></div>
            <div className="option-list">
              {runtimes.map((runtime) => (
                <button
                  className={runtime.id === runtimeId ? 'option active' : 'option'}
                  key={runtime.id}
                  type="button"
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
                <span className="version-chip">{selectedPipeline.version}</span>
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
                  <div><span className="eyebrow">PREVIEW INPUT</span><h3>Configure task</h3></div>
                  <span>Read-only provider run</span>
                </div>
                <div className="form-grid">
                  {Object.entries(selectedPipeline.inputSchema.properties).map(([name, property]) => (
                    <Field
                      key={name}
                      name={name}
                      property={property}
                      required={required.has(name)}
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
                        {selectedRuntime.executableSource === 'configured' && <button type="button" onClick={clearSelectedRuntime} disabled={catalogBusy}>Use automatic</button>}
                        <button type="button" onClick={configureSelectedRuntime} disabled={catalogBusy}>Choose executable</button>
                      </div>
                    )}
                  </div>
                )}
                {selectedRuntime && !runtimeSupported && (
                  <div className="runtime-hint">This pipeline does not declare support for {selectedRuntime.name}.</div>
                )}

                <div className="actions">
                  <button className="secondary" type="button" disabled={!project} onClick={() => project && window.agentPipeline.openPath(project.path)}>Open project</button>
                  {runActive && <button className="danger" type="button" onClick={cancelPreview}>Cancel preview</button>}
                  <button className="primary" type="button" disabled={!canPreview || runActive} onClick={startPreview}>{busy ? 'Starting…' : 'Run read-only preview'}</button>
                </div>
              </div>

              {(previewRun || visibleEvents.length > 0) && (
                <div className="run-console">
                  <div className="console-heading">
                    <div><span className={`run-state ${previewRun?.status ?? 'starting'}`} /><strong>{previewRun?.status ?? 'starting'}</strong></div>
                    {previewRun && <code>{previewRun.id}</code>}
                  </div>
                  <div className="console-output" aria-live="polite">
                    {visibleEvents.length === 0 ? <span>Waiting for runtime output…</span> : visibleEvents.map((event) => (
                      <div className={`console-line ${event.type.replaceAll('.', '-')}`} key={`${event.runId}-${event.sequence}`}>
                        <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                        <span>{event.message}</span>
                      </div>
                    ))}
                  </div>
                  {previewRun && <div className="console-actions"><button type="button" onClick={() => window.agentPipeline.openPath(previewRun.storagePath)}>Open run folder</button></div>}
                </div>
              )}
            </>
          ) : <div className="empty">No pipeline packs found.</div>}
        </section>
      </main>
    </div>
  );
}
