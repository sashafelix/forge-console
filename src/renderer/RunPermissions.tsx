import type { AgentExecutionRun } from '../shared/contracts';

/** The same evaluated policy is disclosed in Guided and Advanced. */
export function RunPermissions({ run }: { run: AgentExecutionRun }) {
  const policy = run.runtimePolicy;
  return <section className="run-permissions" aria-label="Requested permissions">
    <h3>Review access before starting</h3>
    <dl className="permission-grid">
      <div><dt>File writes</dt><dd>{policy.fileWrites === 'worktree-only' ? 'Requested in the target worktree' : 'Denied'}</dd></div>
      <div><dt>Model shell</dt><dd>{policy.shell === 'allowed-to-model' ? 'Allowed for trusted agent' : 'Denied'}</dd></div>
      <div><dt>Network</dt><dd>{policy.network === 'allowed-through-approved-tools' ? 'Allowed through agent tools' : 'Denied'}</dd></div>
      <div><dt>Tools</dt><dd>{policy.requestedTools.join(', ') || 'None declared'}</dd></div>
      <div><dt>Write scope</dt><dd>{policy.declaredWrites.join(', ') || (policy.fileWrites === 'worktree-only' ? 'Paths not declared' : 'None')}</dd></div>
      <div><dt>Turn budget</dt><dd>{policy.maxTurns}</dd></div>
      <div><dt>Credentials / service variables</dt><dd>{policy.requiredEnvironment.length ? policy.requiredEnvironment.map((name) => <span key={name}>{name}{policy.missingEnvironment.includes(name) ? ' — missing' : ' — available'}<br/></span>) : 'None declared'}</dd></div>
      <div><dt>Target revision</dt><dd><code>{run.baseRevision || 'Not recorded'}</code></dd></div>
    </dl>
    {policy.shell === 'allowed-to-model' && <p className="trust-warning"><strong>Trusted-agent warning.</strong> Shell access is not an operating-system sandbox. Commands can access files and networks available to your user account. Approve only a definition you trust.</p>}
    <p>Changes stay in a separate Git worktree. Requested write scope is checked after execution; a worktree itself does not enforce filesystem isolation. Review results before publishing.</p>
  </section>;
}
