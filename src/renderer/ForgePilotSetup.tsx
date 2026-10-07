import { useState } from 'react';
import type { ForgePilot } from '../shared/forge';

export function ForgePilotSetup({ enabled, busy, onCreate, pilot }: {
  enabled: boolean; busy: boolean; onCreate: (image: string) => Promise<void>; pilot: ForgePilot | null;
}) {
  const [image, setImage] = useState('');
  const valid = /^(?:[A-Za-z0-9._:/-]+@)?sha256:[a-f0-9]{64}$/.test(image) && !image.endsWith('sha256:' + '0'.repeat(64));
  return <details className="forge-pilot-setup">
    <summary>First run? Create a disposable pilot</summary>
    <p>Start with a tiny greeting function and a passing test. Forge creates a separate Git repository, a task, all four operator files and a capability review worksheet.</p>
    <ol>
      <li>Export a reviewed profile from <strong>Models &amp; providers</strong>. It can use any compatible model; no default model is imposed.</li>
      <li>Install and review a Python 3.12 Linux image through your approved process. Record its immutable ID with <code>docker image inspect YOUR_IMAGE --format {'\'{{.Id}}\''}</code>.</li>
      <li>Enter that ID, then choose the exported configuration and a new pilot folder. Existing folders are never overwritten.</li>
    </ol>
    <label><span>Immutable Docker image ID</span><input value={image} disabled={busy} onChange={(event) => setImage(event.target.value.trim())}
      placeholder="sha256: followed by your image's 64 hexadecimal characters" spellCheck={false} /></label>
    <button type="button" className="forge-primary" disabled={!enabled || busy || !valid} onClick={() => void onCreate(image)}>Create pilot files</button>
    {!enabled && <p className="forge-muted">Select the trusted host above first. Pilot creation is available on macOS and Linux; use the Forge CLI inside WSL on Windows.</p>}
    <p className="forge-muted">No model requests or approvals happen here. Registrations start unavailable until you independently establish the required capabilities.</p>
    {pilot && <div role="status" className="forge-pilot-result">
      <h3>Pilot created — review before running</h3>
      <p>Open <code>{pilot.root}/SETUP.md</code> for the checklist.</p>
      <dl><div><dt>Target repository</dt><dd><code>{pilot.target_repo}</code></dd></div>
        <div><dt>Task to paste below</dt><dd><code>{pilot.task_file}</code></dd></div>
        <div><dt>Capability review</dt><dd><code>{pilot.review_file}</code></dd></div></dl>
      <ol><li>Review the configuration, policy and facts in the pilot's <code>inputs</code> folder.</li>
        <li>Record evidence for each qualified binding in the review worksheet. Add only established capabilities to <code>runtime-inventory.json</code> and mark those bindings ready.</li>
        <li>Use <strong>Select operator inputs</strong> above to select <code>runtime-configuration.json</code>, <code>execution-policy.json</code>, <code>runtime-inventory.json</code> and <code>facts.json</code>, in that order. Then check host readiness.</li>
        <li>Select the generated target, paste the task and review the run checkpoint. Advance each stage and inspect the final diff and test evidence.</li></ol>
      <p>These drafts have not replaced your selected inputs. Record human corrections and actual versions in <code>{pilot.notes_file}</code>, including failed attempts.</p>
    </div>}
  </details>;
}
