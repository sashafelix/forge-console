import { useEffect, useState } from 'react';
import { buildProjectProfile, emptyProjectProfileDraft, PROFILE_FIELDS, validateProjectProfileDraft } from '../shared/project-profile';
import type { ProjectProfileDraft } from '../shared/project-profile';
import { EXAMPLE_PROJECT_PROFILE, PROJECT_PROFILE_GUIDANCE } from './project-profile-guidance';
import './pipeline-configuration.css';

const MULTILINE = new Set(['stack', 'frameworks', 'build', 'test', 'lint', 'environment', 'constraints', 'modules', 'decisions']);
const DRAFT_KEY = 'forge-console.project-facts-draft.v1';
export function restoreProjectDraft(): ProjectProfileDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw || raw.length > 160000) return emptyProjectProfileDraft();
    const value = { ...emptyProjectProfileDraft(), ...JSON.parse(raw) };
    if (Object.keys(value).some((key) => !Object.hasOwn(PROFILE_FIELDS, key))) return emptyProjectProfileDraft();
    if (Object.keys(PROFILE_FIELDS).some((key) => typeof value[key] !== 'string' || value[key].length > 8000 || /\0/.test(value[key]))) return emptyProjectProfileDraft();
    return value;
  } catch { return emptyProjectProfileDraft(); }
}

export function PipelineConfiguration({ onBack, embedded = false }: { onBack: () => void; embedded?: boolean }) {
  const [draft, setDraft] = useState(restoreProjectDraft);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState<ProjectProfileDraft | null>(null);
  const [previewTime] = useState(() => new Date().toISOString());
  const errors = validateProjectProfileDraft(draft);
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
    catch { setError('Draft could not be saved locally. Export your profile before closing.'); }
  }, [draft]);
  function update(key: keyof ProjectProfileDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setReviewed(false);
    setMessage('');
    setError('');
  }
  async function exportProfile() {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await window.agentPipeline.exportProjectProfile(draft);
      if (saved) setMessage(`Saved ${saved}. Review and supply this file to the pipeline when starting your run.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }
  async function importProfile() {
    setBusy(true); setError('');
    try {
      const imported = await window.agentPipeline.selectProjectProfile();
      if (imported) { setDraft(imported); setBaseline(imported); setReviewed(false); setMessage('Imported all project facts, modules and decisions. Review Prepared by before reissuing an operator profile.'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="task-shell pipeline-configuration">
    <header className="task-header">
      <div><span className="task-kicker">FORGE · CONFIGURATION</span>
        <h1>Prepare your project profile</h1>
        <p>Give Forge reusable context about the repository you want it to work on: its stack, commands, structure and established constraints.</p>
      </div>
      <div><button type="button" disabled={busy} onClick={importProfile}>Import project profile</button>{!embedded && <button type="button" disabled={busy} onClick={onBack}>Back to workbench</button>}</div>
    </header>
    <main>
      <section className="configuration-facts-help" aria-labelledby="project-facts-help-title">
        <h2 id="project-facts-help-title">What should I enter?</h2>
        <p>This profile is optional. Start with the target repository's README, package or build files, CI configuration and architecture notes. Enter facts you can verify; add the current task when you start a run.</p>
        <p>To export a minimal profile, fill in <strong>Project ID</strong>, <strong>Prepared by</strong> and <strong>Languages / stack</strong>, then check the default <strong>Profile version</strong> and <strong>Project root</strong>.</p>
        <details className="configuration-example"><summary>See a complete example profile</summary>
          <p>This fictional TypeScript web app shows the expected format. Use your own project's values. Viewing examples leaves your draft unchanged.</p>
          <pre><code>{JSON.stringify(EXAMPLE_PROJECT_PROFILE, null, 2)}</code></pre>
        </details>
      </section>
      <p className="configuration-boundary">Execution, stage transitions, risk selection and approvals stay with Forge. Exporting a profile saves project facts only. Your draft is saved on this device.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!errors.length && reviewed && !busy) void exportProfile(); }}>
        <fieldset disabled={busy}><legend>Project facts</legend>
          <p>Use one entry per line where indicated. Leave unknown optional text blank; keep <code>[]</code> for modules and <code>{'{}'}</code> for decisions. Commands are saved as text. Keep credentials out of this file.</p>
          <div className="configuration-fields">{Object.entries(PROFILE_FIELDS).map(([name, label]) => {
            const key = name as keyof ProjectProfileDraft;
            const required = ['projectId', 'profileVersion', 'issuedBy', 'root', 'stack'].includes(key);
            const guidance = PROJECT_PROFILE_GUIDANCE[key];
            return <div key={key} className="configuration-field">
              <label htmlFor={`profile-${key}`}>{label}{required ? ' *' : ''}</label>
              {MULTILINE.has(key)
                ? <textarea id={`profile-${key}`} aria-describedby={`profile-${key}-help`} placeholder={guidance.example} rows={3} maxLength={8000} required={required} value={draft[key]} onChange={(event) => update(key, event.target.value)} />
                : <input id={`profile-${key}`} aria-describedby={`profile-${key}-help`} placeholder={guidance.example} maxLength={8000} required={required} value={draft[key]} onChange={(event) => update(key, event.target.value)} />}
              <small id={`profile-${key}-help`}>{guidance.help}</small>
              {(key === 'modules' || key === 'decisions') && <details className="configuration-example"><summary>{key === 'modules' ? 'Show module example' : 'Show decisions example'}</summary><pre><code>{guidance.example}</code></pre></details>}
            </div>;
          })}</div>
        </fieldset>
        <section className="configuration-review" aria-labelledby="profile-review-title">
          <h2 id="profile-review-title">Review and export</h2>
          {errors.length > 0 ? <ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul> : <>
            <p>Profile format 1.0, compatible with Local RGR 2.3. Export reissues operator provenance with the current issue time and preserves the source reference, modules and decisions.</p>
            {baseline && <p role="status">Changed since import: {Object.keys(PROFILE_FIELDS).filter((key) => draft[key as keyof ProjectProfileDraft] !== baseline[key as keyof ProjectProfileDraft]).map((key) => PROFILE_FIELDS[key as keyof ProjectProfileDraft]).join(', ') || 'No project facts changed.'}</p>}
            <details><summary>Preview project-profile.json</summary><pre>{JSON.stringify(buildProjectProfile(draft, previewTime), null, 2)}</pre></details>
          </>}
          <label className="configuration-confirm"><input type="checkbox" disabled={busy || errors.length > 0} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I have reviewed these project facts for use by the pipeline.</label>
          <button className="primary" type="submit" disabled={busy || !reviewed || errors.length > 0}>{busy ? 'Saving…' : 'Export new project profile'}</button>
          <p>Choose a new filename; existing files are preserved. Export does not bind this profile to any run.</p>
          {error && <p role="alert" className="task-alert error">{error}</p>}
          {message && <p role="status" className="task-alert info">{message}</p>}
        </section>
      </form>
      <section className="configuration-review"><h2>Use it with the pipeline</h2>
        <p>From your Forge checkout, validate the exported file:</p>
        <pre>python3 scripts/validate-project-profile.py /path/to/project-profile.json</pre>
        <p>Then explicitly supply the reviewed file to the pipeline orchestrator. A provenance label in a file alone does not establish trust. The pipeline checks it against repository evidence and retains its own governance.</p>
      </section>
    </main>
  </div>;
}
