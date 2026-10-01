import { useState } from 'react';
import { buildProjectProfile, emptyProjectProfileDraft, PROFILE_FIELDS, validateProjectProfileDraft } from '../shared/project-profile';
import type { ProjectProfileDraft } from '../shared/project-profile';
import './pipeline-configuration.css';

const MULTILINE = new Set(['stack', 'frameworks', 'build', 'test', 'lint', 'environment', 'constraints']);

export function PipelineConfiguration({ onBack }: { onBack: () => void }) {
  const [draft, setDraft] = useState(emptyProjectProfileDraft);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previewTime] = useState(() => new Date().toISOString());
  const errors = validateProjectProfileDraft(draft);
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
  return <div className="task-shell pipeline-configuration">
    <header className="task-header">
      <div><span className="task-kicker">AI DEV PIPELINE · CONFIGURATION</span>
        <h1>Prepare your project profile</h1>
        <p>Describe your project, review the file, then supply it to the pipeline in your usual coding environment.</p>
      </div>
      <button type="button" disabled={busy} onClick={onBack}>Back to workbench</button>
    </header>
    <main>
      <p className="configuration-boundary">Execution, stage transitions, risk selection and approvals stay with ai-dev-pipeline. Exporting a profile saves project facts only.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!errors.length && reviewed && !busy) void exportProfile(); }}>
        <fieldset disabled={busy}><legend>Project facts</legend>
          <p>Use one entry per line where indicated. Leave optional unknowns blank. Commands are saved as text. Keep credentials out of this file.</p>
          <div className="configuration-fields">{Object.entries(PROFILE_FIELDS).map(([name, label]) => {
            const key = name as keyof ProjectProfileDraft;
            const required = ['projectId', 'profileVersion', 'issuedBy', 'root', 'stack'].includes(key);
            return <label key={key} htmlFor={`profile-${key}`}><span>{label}{required ? ' *' : ''}</span>
              {MULTILINE.has(key)
                ? <textarea id={`profile-${key}`} rows={3} maxLength={8000} required={required} value={draft[key]} onChange={(event) => update(key, event.target.value)} />
                : <input id={`profile-${key}`} maxLength={8000} required={required} value={draft[key]} onChange={(event) => update(key, event.target.value)} />}
            </label>;
          })}</div>
        </fieldset>
        <section className="configuration-review" aria-labelledby="profile-review-title">
          <h2 id="profile-review-title">Review and export</h2>
          {errors.length > 0 ? <ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul> : <>
            <p>Profile format 1.0, compatible with Local RGR 2.3. The issue time is refreshed on export. Empty decisions and modules can be completed in the JSON file before validation.</p>
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
        <p>From your agent-dev-pipeline checkout, validate the exported file:</p>
        <pre>python3 scripts/validate-project-profile.py /path/to/project-profile.json</pre>
        <p>Then explicitly supply the reviewed file to the pipeline orchestrator. A provenance label in a file alone does not establish trust. The pipeline checks it against repository evidence and retains its own governance.</p>
      </section>
    </main>
  </div>;
}
