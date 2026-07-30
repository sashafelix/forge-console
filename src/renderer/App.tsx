import { useEffect, useMemo, useState } from 'react';
import type {
  PipelineInputProperty,
  PipelineManifest,
  ProjectSelection,
  RunDraft,
  RuntimeAdapterDescriptor,
  SystemInfo
} from '../shared/contracts';

function statusLabel(status: RuntimeAdapterDescriptor['status']): string {
  return status === 'available' ? 'Ready' : status === 'unavailable' ? 'Unavailable' : 'Configure';
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
  const [pipelineId, setPipelineId] = useState('');
  const [runtimeId, setRuntimeId] = useState('');
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [createdRun, setCreatedRun] = useState<RunDraft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      window.agentPipeline.listPipelines(),
      window.agentPipeline.listRuntimes(),
      window.agentPipeline.getSystemInfo()
    ]).then(([pipelineList, runtimeList, info]) => {
      setPipelines(pipelineList);
      setRuntimes(runtimeList);
      setSystem(info);
      setPipelineId(pipelineList[0]?.id ?? '');
      setRuntimeId(runtimeList[0]?.id ?? '');
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null,
    [pipelineId, pipelines]
  );

  useEffect(() => {
    if (!selectedPipeline) return;
    const defaults: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(selectedPipeline.inputSchema.properties)) {
      if (property.default !== undefined) defaults[name] = property.default;
    }
    setInputs(defaults);
    setCreatedRun(null);
  }, [selectedPipeline]);

  async function chooseProject(): Promise<void> {
    const selection = await window.agentPipeline.selectProjectDirectory();
    if (selection) setProject(selection);
  }

  async function createRun(): Promise<void> {
    if (!project || !selectedPipeline || !runtimeId) return;
    setBusy(true);
    setError('');
    try {
      const run = await window.agentPipeline.createRunDraft({
        project,
        pipelineId: selectedPipeline.id,
        pipelineVersion: selectedPipeline.version,
        runtimeId,
        inputs
      });
      setCreatedRun(run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const required = new Set(selectedPipeline?.inputSchema.required ?? []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL AGENT WORKBENCH</span>
          <h1>Agent Pipeline UI</h1>
          <p>Choose a project, pipeline and AI runtime without coupling the desktop app to any one workflow.</p>
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
            <h2>Pipeline</h2>
            <div className="option-list">
              {pipelines.map((pipeline) => (
                <button
                  className={pipeline.id === pipelineId ? 'option active' : 'option'}
                  key={pipeline.id}
                  type="button"
                  onClick={() => setPipelineId(pipeline.id)}
                >
                  <strong>{pipeline.name}</strong>
                  <small>v{pipeline.version} · {pipeline.stages.length} stages</small>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>Runtime</h2>
            <div className="option-list">
              {runtimes.map((runtime) => (
                <button
                  className={runtime.id === runtimeId ? 'option active' : 'option'}
                  key={runtime.id}
                  type="button"
                  onClick={() => setRuntimeId(runtime.id)}
                >
                  <span className="option-row"><strong>{runtime.name}</strong><em>{statusLabel(runtime.status)}</em></span>
                  <small>{runtime.kind} adapter</small>
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
                {selectedPipeline.stages.sort((a, b) => a.order - b.order).map((stage, index) => (
                  <div className="stage" key={stage.id}>
                    <span>{index + 1}</span>
                    <div><strong>{stage.name}</strong><small>{stage.role}</small></div>
                  </div>
                ))}
              </div>

              <div className="form-panel">
                <div className="section-title">
                  <div><span className="eyebrow">RUN INPUT</span><h3>Configure task</h3></div>
                  <span>{Object.keys(selectedPipeline.inputSchema.properties).length} fields</span>
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
                <div className="actions">
                  <button className="secondary" type="button" disabled={!project} onClick={() => project && window.agentPipeline.openPath(project.path)}>Open project</button>
                  <button className="primary" type="button" disabled={!project || !runtimeId || busy} onClick={createRun}>{busy ? 'Creating…' : 'Create local run'}</button>
                </div>
              </div>

              {createdRun && (
                <div className="run-created">
                  <div><span className="status-dot" /><strong>Run draft created</strong></div>
                  <code>{createdRun.id}</code>
                  <p>Stored locally at {createdRun.storagePath}. Runtime execution will attach to this generic run record in the next milestone.</p>
                </div>
              )}
            </>
          ) : <div className="empty">No pipeline packs found.</div>}
        </section>
      </main>
    </div>
  );
}
