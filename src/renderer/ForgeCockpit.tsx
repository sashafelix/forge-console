import { useEffect, useRef, useState } from 'react';
import type { ForgeAction, ForgeDoctor, ForgeEvent, ForgeRunSnapshot, ForgeSetup, ForgeStage, HostView } from '../shared/forge';
import { FORGE_STAGES } from '../shared/forge';
import type { ProjectSelection } from '../shared/contracts';
import { AccessibleDialog } from './AccessibleDialog';
import { useConsoleTheme } from './useConsoleTheme';
import { DiffViewer } from './DiffViewer';
import './forge-cockpit.css';

const TABS = ['overview','evidence','diff','events','compare'] as const;
type Tab = typeof TABS[number];
const pretty = (value: string) => value.replaceAll('_',' ').replace(/\b\w/g,(v) => v.toUpperCase());
const evidenceLabel = { imported_claims: 'Unverified evidence', files_checked: 'Evidence files checked', host_verified: 'Local host receipts verified' };
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function HostPermissions({ host }: { host: HostView }) {
  return <div className="forge-permissions">
    <dl>
      <div><dt>Base revision</dt><dd><code>{host.base_revision}</code></dd></div>
      <div><dt>Source write scope</dt><dd>{host.permissions.source_paths.join(', ')}</dd></div>
      <div><dt>RED test scope</dt><dd>{host.permissions.test_paths.join(', ')}</dd></div>
      <div><dt>Command network</dt><dd>None · Docker containers</dd></div>
      <div><dt>Publication</dt><dd>Manual review and publication</dd></div>
      <div><dt>Limits</dt><dd>{host.permissions.max_turns ?? '—'} turns per role · {host.permissions.command_timeout ?? '—'}s per command · {host.permissions.max_tokens ?? '—'} estimated tokens</dd></div>
    </dl>
    <details><summary>Registered commands and immutable image</summary>
      <code>{host.permissions.image}</code>
      {Object.entries(host.permissions.commands).map(([id, argv]) => <p key={id}><strong>{id}</strong><code>{argv.join(' ')}</code></p>)}
    </details>
    <details><summary>Model endpoints and credential references</summary>
      <p>Provider locality is operator declared. Credentials stay in the host and are excluded from command containers.</p>
      {host.permissions.providers?.map((provider) => <p key={provider.name}><strong>{provider.name} · {provider.locality}</strong>
        <code>{provider.base_url}</code><span>{provider.credential_ref ?? 'No credential'}</span></p>)}
    </details>
  </div>;
}

export function ForgeCockpit({ onBack, onConfigure }: { onBack: () => void; onConfigure?: () => void }) {
  const [setup, setSetup] = useState<ForgeSetup>({ host: null, inputs: null });
  const [runs, setRuns] = useState<ForgeRunSnapshot[]>([]);
  const [run, setRun] = useState<ForgeRunSnapshot | null>(null);
  const [mode, setMode] = useState<'review'|'prepare'>('review');
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const actionCount = useRef(0);
  const [doctor, setDoctor] = useState<ForgeDoctor | null>(null);
  const [project, setProject] = useState<ProjectSelection | null>(null);
  const [task, setTask] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [events, setEvents] = useState<ForgeEvent[]>([]);
  const [eventQuery, setEventQuery] = useState('');
  const [eventStage, setEventStage] = useState('all');
  const [cursor, setCursor] = useState(0);
  const [eventError, setEventError] = useState('');
  const [artifactPath, setArtifactPath] = useState('');
  const [artifact, setArtifact] = useState<{ path: string; text: string; redactions: number; truncated: boolean } | null>(null);
  const [artifactError, setArtifactError] = useState('');
  const [compareId, setCompareId] = useState('');
  const [comparison, setComparison] = useState<ForgeRunSnapshot | null>(null);
  const [retryStage, setRetryStage] = useState<ForgeStage>('quality_gate');
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useConsoleTheme();
  const root = useRef<HTMLDivElement>(null);
  const selectedId = useRef('');
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const cursorRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.agentPipeline.getForgeSetup(), window.agentPipeline.listForgeRuns()]).then(([nextSetup, history]) => {
      if (!alive) return;
      setSetup(nextSetup); setRuns(history);
      const previous = localStorage.getItem('forge-console.last-run');
      const initial = history.find((r) => r.id === previous) ?? history[0];
      if (initial) void selectRun(initial.id);
    }).catch((reason) => alive && setError(errorText(reason)));
    const handler = (event: KeyboardEvent) => {
      if (root.current?.closest('[hidden]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette((value) => !value); }
    };
    document.addEventListener('keydown',handler);
    return () => { alive = false; document.removeEventListener('keydown',handler); selectedId.current = ''; };
  }, []);

  function installSnapshot(next: ForgeRunSnapshot) {
    if (selectedId.current !== next.id) return;
    setRun(next);
    setRuns((current) => [next,...current.filter((r) => r.id !== next.id)]);
  }
  async function eventPage(id: string, after: number, replace = false) {
    try {
      const page = await window.agentPipeline.getForgeEvents({ id, after, limit: 200 });
      if (selectedId.current !== id) return;
      cursorRef.current = Math.max(cursorRef.current, page.nextCursor); setCursor(cursorRef.current);
      setEvents((current) => [...new Map([...(replace ? [] : current),...page.events].map((e) => [e.sequence,e])).values()].sort((a,b) => a.sequence-b.sequence).slice(-1000));
      setEventError('');
    } catch (reason) { if (selectedId.current === id) setEventError(errorText(reason)); }
  }
  async function selectRun(id: string) {
    selectedId.current = id; setRun(null); setMode('review'); setArtifact(null); setArtifactPath(''); setEvents([]); setComparison(null); setCompareId('');
    cursorRef.current = 0; setCursor(0); setError('');
    try {
      const snapshot = await window.agentPipeline.getForgeRun(id);
      installSnapshot(snapshot);
      if (selectedId.current !== id) return;
      try { localStorage.setItem('forge-console.last-run',id); } catch { /* History is native-owned. */ }
      setRetryStage(snapshot.host?.stage === 'close' ? 'quality_gate' : snapshot.host?.stage ?? 'quality_gate');
      void eventPage(id,0,true);
    } catch (reason) { if (selectedId.current === id) setError(errorText(reason)); }
  }
  useEffect(() => {
    if (!run?.host || !['running','ready','awaiting_approval'].includes(run.host.status)) return;
    let alive = true, pending = false;
    const id = run.id;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void window.agentPipeline.getForgeRun(id).then((next) => { if (alive) installSnapshot(next); })
        .then(() => { if (alive) return eventPage(id,cursorRef.current); })
        .catch((reason) => alive && setError(errorText(reason))).finally(() => { pending = false; });
    },1500);
    return () => { alive = false; clearInterval(timer); };
  },[run?.id, run?.host?.status]);
  useEffect(() => {
    if (!run || !['evidence','diff'].includes(tab)) return;
    const reference = tab === 'diff' ? 'changes.patch' : artifactPath;
    setArtifact(null); setArtifactError('');
    if (!reference) return;
    let alive = true;
    void window.agentPipeline.getForgeArtifact({ id: run.id, path: reference })
      .then((value) => alive && setArtifact(value)).catch((reason) => alive && setArtifactError(errorText(reason)));
    return () => { alive = false; };
  },[run?.id, tab, artifactPath, run?.updatedAt]);
  useEffect(() => {
    setComparison(null);
    if (!compareId) return;
    let alive = true;
    void window.agentPipeline.getForgeRun(compareId).then((value) => alive && setComparison(value))
      .catch((reason) => alive && setError(errorText(reason)));
    return () => { alive = false; };
  },[compareId]);

  async function configure(action: 'host'|'inputs'|'doctor') {
    setBusy(true); setError(''); setReviewed(false);
    try {
      if (action === 'doctor') setDoctor(await window.agentPipeline.doctorForgeHost());
      else { setSetup(await (action === 'host' ? window.agentPipeline.configureForgeHost() : window.agentPipeline.selectForgeInputs())); setDoctor(null); }
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function importRun() {
    setBusy(true); setError('');
    try {
      const snapshot = await window.agentPipeline.importForgeBundle();
      if (snapshot) { setRuns((current) => [snapshot,...current]); selectedId.current = snapshot.id; installSnapshot(snapshot); setMode('review'); void eventPage(snapshot.id,0,true); }
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); setPalette(false); }
  }
  async function prepare() {
    if (!project) return;
    setBusy(true); setError('');
    try {
      const snapshot = await window.agentPipeline.prepareForgeRun({ project, task });
      selectedId.current = snapshot.id; installSnapshot(snapshot); setMode('review'); setTab('overview');
      void eventPage(snapshot.id,0,true);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function act(action: ForgeAction) {
    if (!run?.host) return;
    const id = run.id, approval = run.host.approval;
    actionCount.current += 1; setBusy(true); setError('');
    try {
      const next = await window.agentPipeline.forgeAction({ id, action, approvalId: approval?.id, binding: approval?.binding_sha256,
        stage: action === 'retry' ? retryStage : undefined });
      installSnapshot(next);
      if (action === 'approve' && next.host?.available_actions.includes('advance')) {
        installSnapshot(await window.agentPipeline.forgeAction({ id, action: 'advance' }));
      }
      void eventPage(id,cursorRef.current);
    } catch (reason) {
      try {
        const next = await window.agentPipeline.getForgeRun(id); installSnapshot(next);
        if (next.status !== 'cancelled') setError(errorText(reason));
      } catch { setError(errorText(reason)); }
    } finally { actionCount.current -= 1; setBusy(actionCount.current > 0); }
  }
  function showArtifact(reference: string) { setArtifactPath(reference); setTab('evidence'); }
  async function openFolder(folder: string) {
    try { const result = await window.agentPipeline.openPath(folder); if (result) setError(result); }
    catch (reason) { setError(errorText(reason)); }
  }
  const filtered = runs.filter((r) => (statusFilter === 'all' || (statusFilter === 'managed' ? r.source === 'managed' : r.status.includes(statusFilter)))
    && (r.storyId + ' ' + r.profile + ' ' + r.baseRevision).toLowerCase().includes(query.toLowerCase()));
  const visibleEvents = events.filter((e) => (eventStage === 'all' || e.stage === eventStage)
    && (e.event_type + ' ' + e.actor_role + ' ' + (e.safe_summary ?? '')).toLowerCase().includes(eventQuery.toLowerCase()));
  const live = run?.host && ['running','ready'].includes(run.host.status);
  const activeTheme = theme === 'system' ? undefined : theme;
  const verificationDone = run?.host?.completed_stages.includes('quality_gate') ?? run?.stages.includes('quality_gate');
  const verdict = run?.source === 'managed' && !verificationDone
    ? run.host?.status === 'failed' && run.host.stage === 'quality_gate' ? 'Blocked' : 'Pending'
    : run?.verdict;

  return <div ref={root} className="forge-cockpit" data-theme={activeTheme}>
    <header className="forge-header">
      <div className="forge-brand"><span aria-hidden="true">F</span><div><strong>Forge Console</strong><small>Run and review Forge</small></div></div>
      <div className="forge-header-actions">
        <label className="forge-theme"><span className="forge-sr">Colour theme</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="system">System theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <button type="button" onClick={() => setPalette(true)}>Commands <kbd>⌘/Ctrl K</kbd></button>
        {onConfigure && <button type="button" disabled={busy} onClick={onConfigure}>Setup & guides</button>}
        <button type="button" onClick={onBack}>Back to workflows</button>
      </div>
    </header>
    <div className="forge-workspace">
      <aside className="forge-sidebar">
        <div className="forge-section-heading"><h2>Runs</h2><span>{runs.length}</span></div>
        <button className="forge-primary" type="button" disabled={busy} onClick={() => { setMode('prepare'); setPalette(false); }}>New governed run</button>
        <button type="button" disabled={busy} onClick={importRun}>Inspect evidence bundle</button>
        <label><span>Find a run</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Story, profile or revision" /></label>
        <label><span className="forge-sr">Filter runs</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All runs</option><option value="managed">Managed runs</option><option value="failed">Failed</option><option value="completed">Completed</option></select></label>
        <nav aria-label="Run history" className="forge-history">{filtered.map((entry) =>
          <button key={entry.id} type="button" className={run?.id === entry.id ? 'selected' : ''} disabled={busy} onClick={() => selectRun(entry.id)}>
            <strong>{entry.storyId}</strong><span>{entry.status} · {entry.profile}</span><small>{entry.source === 'managed' ? 'Governed host' : 'Imported evidence'} · {entry.baseRevision.slice(0,8) || 'No revision'}</small>
          </button>)}</nav>
        {!filtered.length && <p className="forge-muted">No matching runs. Import evidence or prepare a governed run.</p>}
        <div className="forge-sidebar-note"><span className="forge-dot" />Local workspace<p>Host approvals and receipts stay local. Publication is a separate decision.</p></div>
      </aside>
      <main className="forge-content">
        {error && <p className="forge-alert error" role="alert">{error}</p>}
        {mode === 'prepare' ? <>
          <div className="forge-page-title"><div><span className="forge-eyebrow">GOVERNED EXECUTION</span><h1>Prepare a Forge run</h1><p>Choose a trusted host, review its policy, then approve the exact run checkpoint.</p></div></div>
          <section className="forge-panel">
            <div className="forge-section-heading"><h2>Host and operator inputs</h2><span className="forge-badge">{doctor?.ready ? 'Preflight ready' : 'Preflight required'}</span></div>
            <p>Select a Forge checkout with the governed host and Python 3.11+. Commands require an installed Linux Docker engine and an immutable image.</p>
            <div className="forge-setup-grid"><div><strong>Trusted host</strong><code>{setup.host?.root ?? 'No host registered'}</code><small>{setup.host?.python}</small><button type="button" disabled={busy} onClick={() => configure('host')}>Select trusted host</button></div>
              <div><strong>Reviewed operator files</strong><code>{setup.inputs?.configuration ?? 'No inputs selected'}</code><small>Runtime configuration, execution policy, adapter registrations and task risk facts.</small><button type="button" disabled={busy || !setup.host} onClick={() => configure('inputs')}>Select operator inputs</button></div></div>
            <button type="button" disabled={busy || !setup.host || !setup.inputs} onClick={() => configure('doctor')}>{busy ? 'Checking…' : 'Check host readiness'}</button>
            {doctor && <div role="status" className={'forge-alert ' + (doctor.ready ? 'success' : 'warning')}><strong>{doctor.ready ? 'Host preflight passed' : 'Host is blocked'}</strong><span>{doctor.sandbox.reason ?? 'Docker is available. Provider registration remains operator reviewed.'}</span></div>}
            {doctor?.routes.length ? <details><summary>Resolved role routes · {doctor.profile ?? 'task profile'}</summary><table><thead><tr><th>Stage</th><th>Model binding</th><th>Protocol</th></tr></thead><tbody>{doctor.routes.map((route,i) => <tr key={i}><td>{pretty(route.stage)}</td><td>{route.model_id}{route.fallback ? ' · fallback' : ''}</td><td>{route.protocol}</td></tr>)}</tbody></table></details> : null}
            {setup.inputs && <details><summary>Review selected execution boundaries</summary>
              <p>Source scope: <code>{setup.inputs.permissions.source_paths.join(', ')}</code></p><p>Test scope: <code>{setup.inputs.permissions.test_paths.join(', ')}</code></p>
              <p>Command network is disabled. Model requests use the configured providers.</p>
              {setup.inputs.providers.map((provider,i) => <p key={i}>{provider.name} · {provider.model} · {provider.locality}</p>)}
              <p>Credential names: {setup.inputs.credentialNames.join(', ') || 'none'}. Values are supplied by the exact matching vault binding or the application environment.</p>
              <pre>{JSON.stringify(setup.inputs.permissions.commands,null,2)}</pre>
            </details>}
          </section>
          <section className="forge-panel">
            <h2>Target and task</h2>
            <button type="button" disabled={busy} onClick={async () => { try { const selected = await window.agentPipeline.selectProjectDirectory(); if (selected) { setProject(selected); setReviewed(false); } } catch (reason) { setError(errorText(reason)); } }}>Choose target repository</button>
            <p><code>{project?.path ?? 'No target selected'}</code></p>
            <label><span>Task</span><textarea rows={6} maxLength={20000} value={task} disabled={busy} placeholder="Describe the change and observable acceptance criteria." onChange={(event) => { setTask(event.target.value); setReviewed(false); }} /></label>
            <label className="forge-checkbox"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the target, provider bindings and operator policy. Prepare a disposable snapshot for approval.</span></label>
            <button className="forge-primary" type="button" disabled={busy || !reviewed || !doctor?.ready || !project?.isGitRepository || !task.trim()} onClick={prepare}>Prepare run checkpoint</button>
          </section>
        </> : !run ? <section className="forge-empty"><div className="forge-mark">F</div><span className="forge-eyebrow">FORGE COCKPIT</span><h1>Every change has a trace.</h1><p>Follow the nine stages, inspect the tests and review the exact patch before publication.</p>
          {onConfigure && <p>New to Console? <button type="button" disabled={busy} onClick={onConfigure}>Choose your setup</button> for Copilot, Claude Code or a governed Forge run.</p>}
          <div><button className="forge-primary" type="button" disabled={busy} onClick={() => setMode('prepare')}>Prepare a governed run</button><button type="button" disabled={busy} onClick={importRun}>Inspect existing evidence</button></div></section> : <>
          <div className="forge-page-title"><div><span className="forge-eyebrow">{run.source === 'managed' ? 'GOVERNED HOST' : 'IMPORTED EVIDENCE'}</span><h1>{run.storyId}</h1><p>{run.profile} · attempt {run.attempt} · <code>{run.baseRevision.slice(0,12) || 'Revision unknown'}</code></p></div>
            <div className="forge-run-status"><span className={'forge-dot ' + (run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : '')} /><strong>{pretty(run.status)}</strong><small aria-live="polite">{evidenceLabel[run.evidenceLevel]}</small></div></div>
          <div className={'forge-evidence-banner ' + (run.evidenceLevel === 'host_verified' ? 'verified' : '')}>
            <strong>{evidenceLabel[run.evidenceLevel]}</strong>
            <span>{run.evidenceLevel === 'host_verified' ? 'Receipts reconcile with this separately registered local host and the independently tested patch.' : run.source === 'imported' ? 'Imported labels, approvals and signatures are evidence claims. This view checks referenced files and consistency.' : 'Execution evidence is being collected. Final receipt verification happens at closure.'}</span>
          </div>
          <nav className="forge-tabs" role="tablist" aria-label="Run views">{TABS.map((name,index) => <button key={name} ref={(element) => { tabButtons.current[index] = element; }} type="button" role="tab"
            id={'forge-tab-' + name} aria-selected={tab === name} aria-controls={'forge-panel-' + name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => {
              let target = index;
              if (event.key === 'ArrowRight') target = (index+1)%TABS.length;
              else if (event.key === 'ArrowLeft') target = (index+TABS.length-1)%TABS.length;
              else if (event.key === 'Home') target = 0; else if (event.key === 'End') target = TABS.length-1; else return;
              event.preventDefault(); setTab(TABS[target]); tabButtons.current[target]?.focus();
            }}>{pretty(name)}</button>)}</nav>
          <section id={'forge-panel-' + tab} role="tabpanel" aria-labelledby={'forge-tab-' + tab} className="forge-tab-panel">
            {tab === 'overview' && <>
              <div className="forge-metrics"><div><span>Stages</span><strong>{run.stages.length}<small>/ 9</small></strong></div><div><span>Criteria</span><strong>{run.criteria.length}</strong></div><div><span>Commands</span><strong>{run.commands.length}</strong></div><div><span>Verification verdict {run.source === 'imported' ? '(reported)' : ''}</span><strong>{verdict}</strong></div></div>
              <section className="forge-panel"><div className="forge-section-heading"><h2>Stage progress</h2><span>{run.host?.stage ? pretty(run.host.stage) : 'Evidence history'}</span></div>
                <ol className="forge-stage-grid">{FORGE_STAGES.map((stage,index) => <li key={stage} className={run.stages.includes(stage) ? 'complete' : run.host?.stage === stage ? 'current' : ''}>
                  <span>{run.stages.includes(stage) ? '✓' : index+1}</span><div><strong>{pretty(stage)}</strong><small>{run.stages.includes(stage) ? 'Completed' : run.host?.stage === stage ? run.host.status === 'failed' ? 'Blocked' : 'Current stage' : 'Pending'}</small></div>
                </li>)}</ol></section>
              {run.host && <section className="forge-panel"><h2>Review workspace and handoff</h2>
                <p>Inspect the disposable source snapshot and evidence before applying or publishing a change.</p>
                <code>{run.host.workspace_path}</code><div className="forge-actions">
                  <button type="button" onClick={() => openFolder(run.host!.workspace_path)}>Open workspace folder</button>
                  <button type="button" onClick={() => openFolder(run.host!.bundle_path)}>Open evidence folder</button>
                </div>
              </section>}
              {run.host?.approval && <section className="forge-panel forge-checkpoint" aria-labelledby="forge-checkpoint-title"><span className="forge-eyebrow">OPERATOR CHECKPOINT</span><h2 id="forge-checkpoint-title">{pretty(run.host.approval.reason)}</h2>
                <HostPermissions host={run.host} /><p>Approval binds this attempt, base revision, policy, model configuration, artifacts and workspace.</p><code className="forge-binding">{run.host.approval.binding_sha256}</code>
                <div className="forge-actions"><button className="forge-primary" type="button" disabled={busy} onClick={() => act('approve')}>Approve and continue</button><button type="button" onClick={() => act('cancel')}>Cancel run</button></div>
              </section>}
              {run.host && !run.host.approval && <section className="forge-panel"><div className="forge-section-heading"><h2>{live ? 'Pipeline execution' : 'Host controls'}</h2><span aria-live="polite">{busy ? 'Working…' : pretty(run.host.status)}</span></div>
                {run.host.error && <p role="alert" className="forge-alert error">{run.host.error}</p>}
                <p>Continue runs to the next checkpoint or terminal state. Recovery restores the stage snapshot and requests a fresh bound approval.</p>
                <div className="forge-actions">
                  {run.host.available_actions.includes('advance') && <button className="forge-primary" type="button" disabled={busy} onClick={() => act('advance')}>Continue pipeline</button>}
                  {run.host.available_actions.includes('resume') && <button type="button" disabled={busy} onClick={() => act('resume')}>Resume interrupted stage</button>}
                  {run.host.available_actions.includes('retry') && <><label><span className="forge-sr">Earliest invalid stage</span><select value={retryStage} onChange={(event) => setRetryStage(event.target.value as ForgeStage)}>{FORGE_STAGES.filter((stage) => FORGE_STAGES.indexOf(stage) <= (run.host!.stage === 'close' ? 8 : FORGE_STAGES.indexOf(run.host!.stage))).map((stage) => <option key={stage} value={stage}>{pretty(stage)}</option>)}</select></label><button type="button" disabled={busy} onClick={() => act('retry')}>Start remediation attempt</button></>}
                  {run.host.available_actions.includes('cancel') && <button className="forge-danger" type="button" onClick={() => act('cancel')}>Cancel run</button>}
                  <button type="button" onClick={() => selectRun(run.id)}>Refresh evidence</button>
                </div><details><summary>Approved execution boundary</summary><HostPermissions host={run.host} /></details>
              </section>}
              {(run.source === 'imported' || ['completed','failed'].includes(run.status)) && run.issues.length > 0 && <section className="forge-panel"><h2>Evidence issues</h2><ul>{run.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}
            </>}
            {tab === 'evidence' && <div className="forge-evidence-layout"><div>
              <section className="forge-panel"><h2>Criterion trace</h2>{run.criteria.map((criterion) => <article className="forge-criterion" key={criterion.id}>
                <div className="forge-section-heading"><strong>{criterion.id}</strong><span className="forge-badge">{criterion.status}</span></div><p>{criterion.statement}</p><small>Planned test IDs</small><ul>{criterion.tests.map((test) => <li key={test}><code>{test}</code></li>)}</ul>
                <div>{criterion.evidence.map((ref) => <button type="button" key={ref} onClick={() => showArtifact(ref)}>{ref}</button>)}</div></article>)}</section>
              <section className="forge-panel"><h2>Command evidence</h2><div className="forge-table-wrap"><table><thead><tr><th>Stage / role</th><th>Command</th><th>Exit</th><th>Tests</th><th>Output</th></tr></thead><tbody>{run.commands.map((command) => <tr key={command.id}><td>{pretty(command.stage)}<small>{command.role}</small></td><td><code>{command.command}</code></td><td><span className={'forge-badge ' + (command.exitCode === 0 ? 'success' : 'warning')}>{command.exitCode}</span></td><td>{command.collected ?? '—'} collected<br />{command.passed ?? '—'} passed</td><td><button type="button" onClick={() => showArtifact(command.outputRef)}>Read log</button></td></tr>)}</tbody></table></div></section>
              <details className="forge-panel"><summary>Artifact inventory · {run.artifacts.length} files</summary>{run.artifacts.map((entry) => <button className="forge-artifact-link" type="button" key={entry.path} onClick={() => showArtifact(entry.path)}>{entry.path}<small>{entry.bytes.toLocaleString()} bytes</small></button>)}</details>
            </div><section className="forge-panel forge-artifact-panel"><h2>{artifactPath || 'Inspect an artifact'}</h2><p className="forge-muted">Choose criterion evidence, a command log or a canonical artifact. Content is displayed as text.</p>
              {artifactError && <p role="alert" className="forge-alert error">{artifactError}</p>}
              {artifact && <><p role="status" className="forge-redaction">{artifact.redactions} detected secrets hidden · {artifact.truncated ? 'bounded preview' : 'full text preview'}</p><pre>{artifact.text}</pre></>}
            </section></div>}
            {tab === 'diff' && <section className="forge-panel"><div className="forge-section-heading"><h2>Patch review</h2><span>Read only</span></div><p>The local host diff contains source and stays outside source-free exports.</p>
              {artifactError && <p role="status" className="forge-alert warning">{artifactError}</p>}{artifact ? <><p className="forge-redaction">{artifact.redactions} detected secrets hidden</p><DiffViewer text={artifact.text} truncated={artifact.truncated} /></> : !artifactError && <p>Loading diff…</p>}
            </section>}
            {tab === 'events' && <section className="forge-panel"><div className="forge-section-heading"><h2>Event timeline</h2><span>{events.length} visible · cursor {cursor}</span></div>
              <div className="forge-event-filters"><label><span>Search events</span><input type="search" value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Command, role or event" /></label><label><span>Stage</span><select value={eventStage} onChange={(event) => setEventStage(event.target.value)}><option value="all">All stages</option>{FORGE_STAGES.map((stage) => <option key={stage} value={stage}>{pretty(stage)}</option>)}</select></label></div>
              {eventError && <p role="alert" className="forge-alert error">{eventError}</p>}
              <ol className="forge-events">{visibleEvents.map((event) => <li key={event.sequence}><span className="forge-event-sequence">{event.sequence}</span><div><strong>{event.event_type}</strong><p>{event.safe_summary ?? pretty(event.stage)}</p><small>{event.actor_role} · attempt {event.attempt} · {new Date(event.timestamp).toLocaleTimeString()}</small>
                <div>{event.artifact_refs.map((ref) => <button key={ref} type="button" onClick={() => showArtifact(ref)}>{ref}</button>)}</div></div></li>)}</ol>
              <button type="button" onClick={() => eventPage(run.id,cursor)}>Load next event page</button><button type="button" onClick={() => eventPage(run.id,0,true)}>Back to first page</button><p className="forge-muted">At most 1,000 events remain in the view. The native event history is preserved.</p>
            </section>}
            {tab === 'compare' && <section className="forge-panel"><h2>Compare runs</h2><label><span>Comparison run</span><select value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">Choose another run</option>{runs.filter((r) => r.id !== run.id).map((r) => <option key={r.id} value={r.id}>{r.storyId} · {r.profile} · {r.id.slice(0,8)}</option>)}</select></label>
              {comparison && <><p className="forge-alert info">{run.baseRevision === comparison.baseRevision ? 'Both runs report the same base revision.' : 'The base revisions differ; these outcomes are not a paired evaluation.'}</p>
                <table><thead><tr><th>Evidence</th><th>Current run</th><th>Comparison</th></tr></thead><tbody>
                  {[['Status',run.status,comparison.status],['Trust',evidenceLabel[run.evidenceLevel],evidenceLabel[comparison.evidenceLevel]],['Verdict',run.verdict,comparison.verdict],['Commands',String(run.commands.length),String(comparison.commands.length)],['Issues',String(run.issues.length),String(comparison.issues.length)]].map(([label,left,right]) => <tr key={label}><th>{label}</th><td>{left}</td><td>{right}</td></tr>)}
                  {[...new Set([...run.criteria,...comparison.criteria].map((c) => c.id))].map((id) => <tr key={id}><th>{id}</th><td>{run.criteria.find((c) => c.id === id)?.status ?? 'MISSING'}</td><td>{comparison.criteria.find((c) => c.id === id)?.status ?? 'MISSING'}</td></tr>)}
                </tbody></table><p className="forge-muted">For measured model comparisons, use Forge’s paired evaluation harness with pinned tasks, repeated independent runs and fresh negative controls.</p></>}
            </section>}
          </section>
        </>}
      </main>
    </div>
    {palette && <AccessibleDialog title="Console commands" onClose={() => setPalette(false)}>
      <div className="forge-palette"><button type="button" disabled={busy} onClick={() => { setMode('prepare'); setPalette(false); }}>New governed run</button><button type="button" disabled={busy} onClick={importRun}>Inspect evidence bundle</button>
        {runs.slice(0,8).map((entry) => <button type="button" key={entry.id} disabled={busy} onClick={() => { void selectRun(entry.id); setPalette(false); }}>Open {entry.storyId} · {entry.id.slice(0,8)}</button>)}
        <button type="button" onClick={() => { setPalette(false); onBack(); }}>Back to workflows</button></div>
    </AccessibleDialog>}
  </div>;
}
