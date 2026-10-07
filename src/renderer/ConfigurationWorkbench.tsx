import { useEffect, useState } from 'react';
import type { ProcessRuntimeId, RuntimeAdapterDescriptor, RuntimeConnectionTestResult } from '../shared/contracts';
import { ModelConfiguration } from './ModelConfiguration';
import { PipelineConfiguration } from './PipelineConfiguration';
import './forge-cockpit.css';
import './configuration-workbench.css';

export type ConfigurationSection = 'overview' | 'models' | 'runtimes' | 'project' | 'guides';
const SECTIONS: [ConfigurationSection, string, string][] = [
  ['overview', 'Get started', 'Choose your setup'], ['runtimes', 'CLI runtimes', 'Copilot & Claude Code'],
  ['models', 'Models & providers', 'Governed role routing'], ['project', 'Project facts', 'Context for your team'],
  ['guides', 'Quickstart guides', 'From setup to first result']
];
const RUNTIMES: { id: ProcessRuntimeId; name: string; mark: string; login: string }[] = [
  { id: 'github-copilot', name: 'GitHub Copilot', mark: 'GH', login: 'copilot login' },
  { id: 'claude-code', name: 'Claude Code', mark: 'CC', login: 'claude' }
];

type Props = { onBack: () => void; onOpenCockpit?: () => void; onUseRuntime?: (runtime: ProcessRuntimeId) => void;
  onOpenConnections?: () => void; initialSection?: ConfigurationSection };

function RuntimeSetup({ onUseRuntime, onOpenConnections }: Pick<Props, 'onUseRuntime' | 'onOpenConnections'>) {
  const [runtimes, setRuntimes] = useState<RuntimeAdapterDescriptor[]>([]);
  const [checks, setChecks] = useState<Partial<Record<ProcessRuntimeId, RuntimeConnectionTestResult>>>({});
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  useEffect(() => { let alive = true;
    void window.agentPipeline.listRuntimes().then((next) => { if (alive) { setRuntimes(next); setLoaded(true); } })
      .catch((reason) => alive && setError(String(reason)));
    return () => { alive = false; };
  }, []);
  return <div className="configuration-page">
    <div className="forge-page-title"><div><span className="forge-eyebrow">STANDALONE WORKFLOWS</span><h1>Connect your coding assistant</h1><p>Use the CLI and account you already have, with your team's agent library.</p></div>
      <button disabled={busy} onClick={() => void act(async () => { setRuntimes(await window.agentPipeline.listRuntimes()); setChecks({}); setLoaded(true); })}>Refresh runtimes</button></div>
    <p className="configuration-note">Copilot and Claude Code run standalone agents. The governed Forge host currently uses HTTP model providers; CLI subscriptions cannot be assigned to its stage routes.</p>
    {error && <p className="configuration-error" role="alert">{error}</p>}
    <div className="configuration-cards">{RUNTIMES.map(({ id, name, mark, login }) => {
      const runtime = runtimes.find((item) => item.id === id); const check = checks[id]; const available = runtime?.status === 'available';
      return <section className="configuration-card runtime-card" key={id} aria-label={name}>
        <div className="configuration-card-top"><span className="configuration-icon">{mark}</span><span className={`configuration-status ${available ? 'ready' : ''}`}>{!loaded ? 'Checking installation' : available ? 'Installed' : 'Setup needed'}</span></div>
        <h2>{name}</h2><p>Authenticate in your terminal, then check that Console can reach your provider.</p>
        <ol><li>Install the {name} CLI on this computer.</li><li>Open a terminal and run <code>{login}</code> to sign in.</li><li>Restart Console, refresh and test the connection.</li></ol>
        <div className="runtime-location"><small>Executable</small><code>{runtime?.executablePath ?? 'Not found on PATH'}</code><small>{runtime?.version ?? runtime?.configurationHint ?? 'Choose the installed executable if automatic discovery misses it.'}</small></div>
        <div className="configuration-actions"><button disabled={busy} onClick={() => void act(async () => { setRuntimes(await window.agentPipeline.configureRuntimeExecutable(id)); setChecks({}); setLoaded(true); })}>Choose {name} executable</button>
          {runtime?.executableSource === 'configured' && <button disabled={busy} onClick={() => void act(async () => { setRuntimes(await window.agentPipeline.clearRuntimeExecutable(id)); setChecks({}); })}>Use PATH</button>}
          <button disabled={busy || !available} onClick={() => void act(async () => { const result = await window.agentPipeline.testRuntimeConnection(id); setChecks((current) => ({ ...current, [id]: result })); })}>Test {name} connection</button></div>
        <small>A connection test sends a small provider request and may use your plan allowance. Installed does not mean signed in.</small>
        {check && <p role={check.ok ? 'status' : 'alert'} className={check.ok ? 'configuration-success' : 'configuration-error'}>{check.message}</p>}
        {onUseRuntime && <button className="forge-primary" disabled={busy || !available} onClick={() => onUseRuntime(id)}>Use {name} for a workflow</button>}
      </section>;
    })}</div>
    <section className="configuration-help"><div><h2>Behind a company proxy or VPN?</h2><p>Set proxy and certificate options in Connections, then repeat the connection test.</p></div>{onOpenConnections && <button onClick={onOpenConnections}>Open Connections</button>}</section>
  </div>;
}

function QuickstartGuides({ navigate, onBack, onOpenCockpit }: { navigate: (section: ConfigurationSection) => void } & Pick<Props, 'onBack' | 'onOpenCockpit'>) {
  return <div className="configuration-page"><div className="forge-page-title"><div><span className="forge-eyebrow">YOUR FIRST RESULT</span><h1>Quickstart guides</h1><p>Pick the outcome you need. Each path has its own setup and review steps.</p></div></div>
    <section className="configuration-guide"><span className="configuration-step">01</span><div><span className="forge-eyebrow">COPILOT OR CLAUDE CODE</span><h2>Run your first standalone agent</h2><p>A good first task is a read-only review of a small Git repository.</p>
      <ol><li>Open <strong>CLI runtimes</strong>, install and sign in to your assistant, then test its connection.</li><li>In Workflows, choose your team's library folder. For a starter, use <code>forge-console/examples</code> and select <strong>Readme Review</strong>.</li><li>Select the target Git repository and enter: <em>Review the README setup instructions and list missing steps. Do not edit files.</em></li><li>Select Copilot or Claude Code. Prepare the run, inspect its permissions and approve when ready.</li><li>Review the final answer and changes in the isolated worktree. Apply, commit or publish only after your review.</li></ol>
      <p className="configuration-note">Forge's nine-stage agents run through the cockpit. Choose an ordinary standalone agent for this guide.</p><div className="configuration-actions"><button className="forge-primary" onClick={() => navigate('runtimes')}>Set up a CLI runtime</button><button onClick={onBack}>Open workflows</button></div></div></section>
    <section className="configuration-guide"><span className="configuration-step">02</span><div><span className="forge-eyebrow">GOVERNED DELIVERY</span><h2>Prepare a Forge run</h2>
      <ol><li>Install Forge, Python 3.11+ and Linux Docker. Prepare a reviewed immutable test image.</li><li>In <strong>Models & providers</strong>, save a provider, add a model to a profile, set a default for all roles and review fallbacks. Save, test and export the reviewed configuration.</li><li>Prepare the other host inputs: execution policy, trusted capability inventory and story risk facts. Model probes do not create trusted capability registrations.</li><li>In the cockpit, choose <strong>New governed run</strong>. Select Forge, Python and all four input files, then check readiness.</li><li>Select a clean target repository and task. Review the start checkpoint, approve and follow the stage evidence. Review the final patch before applying it.</li></ol>
      <p className="configuration-note">The native bridge supports macOS/Linux with Linux Docker. On Windows, run the host in WSL and inspect its evidence in Console.</p><div className="configuration-actions"><button className="forge-primary" onClick={() => navigate('models')}>Configure models</button>{onOpenCockpit && <button onClick={onOpenCockpit}>Open Forge cockpit</button>}</div></div></section>
    <section className="configuration-guide"><span className="configuration-step">03</span><div><span className="forge-eyebrow">NO MODEL SETUP NEEDED</span><h2>Review an existing run</h2>
      <ol><li>Open the cockpit and choose <strong>Inspect evidence bundle</strong>. Select the run's <code>bundle</code> directory.</li><li>Check Overview for completion and the evidence level. Open Evidence to follow acceptance criteria to test results and command logs.</li><li>Use Diff for an available local patch and Events for failures or retries. An imported bundle stays read-only.</li></ol>
      {onOpenCockpit && <button className="forge-primary" onClick={onOpenCockpit}>Inspect run evidence</button>}</div></section>
    <section className="configuration-help"><div><h2>Project facts are optional context</h2><p>Save stack, commands and team decisions in a reviewed project profile. Supply it to your orchestrator; it is separate from the four governed host inputs.</p></div><button onClick={() => navigate('project')}>Prepare project facts</button></section>
  </div>;
}

export function ConfigurationWorkbench({ onBack, onOpenCockpit, onUseRuntime, onOpenConnections, initialSection = 'overview' }: Props) {
  const [section, setSection] = useState<ConfigurationSection>(initialSection);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('forge-console.cockpit-theme') ?? 'system'; } catch { return 'system'; } });
  useEffect(() => { try { localStorage.setItem('forge-console.cockpit-theme', theme); } catch { /* Usable in memory. */ } }, [theme]);
  return <div className="forge-cockpit configuration-workbench" data-theme={theme}>
    <header className="forge-header"><div className="forge-brand"><span>F</span><div><strong>Forge Console</strong><small>Configure your workspace</small></div></div><div className="forge-header-actions">
      <label className="forge-theme"><span className="forge-sr">Colour theme</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="system">System theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      {onOpenCockpit && <button onClick={onOpenCockpit}>Forge cockpit</button>}<button onClick={onBack}>Back to workflows</button></div></header>
    <div className="configuration-layout"><aside className="configuration-navigation"><span className="forge-eyebrow">PIPELINE CONFIGURATION</span><nav aria-label="Configuration pages">{SECTIONS.map(([id, name, hint]) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><strong>{name}</strong><small>{hint}</small></button>)}</nav><p>One agent library.<br />Choose the runtime that fits the task.</p></aside>
      <div className="configuration-content">
        {section === 'overview' && <div className="configuration-page"><div className="forge-page-title"><div><span className="forge-eyebrow">GET STARTED</span><h1>Your tools. Your workflow.</h1><p>Connect a coding assistant or prepare a governed Forge pipeline.</p></div></div>
          <div className="configuration-cards"><section className="configuration-card"><div className="configuration-card-top"><span className="configuration-icon">CLI</span><span className="configuration-status">Standalone agents</span></div><h2>Use Copilot or Claude Code</h2><p>Run repository agents with your installed coding assistant and existing sign-in.</p><ul><li>GitHub Copilot and Claude Code</li><li>One canonical agent and skill library</li><li>Review permissions before each run</li></ul><button className="forge-primary" onClick={() => setSection('runtimes')}>Set up Copilot or Claude</button></section>
          <section className="configuration-card"><div className="configuration-card-top"><span className="configuration-icon">F</span><span className="configuration-status">Nine governed stages</span></div><h2>Configure a Forge pipeline</h2><p>Choose API or local models for each role, with explicit routing and fallbacks.</p><ul><li>Cloud providers and local gateways</li><li>Reusable model profiles</li><li>Host checkpoints and verification</li></ul><button className="forge-primary" onClick={() => setSection('models')}>Set up model routing</button></section></div>
          <section className="configuration-help"><div><span className="forge-eyebrow">NEW TO CONSOLE?</span><h2>Start with a small, reviewable task.</h2><p>Follow a quickstart for your first agent, governed run or evidence review.</p></div><button onClick={() => setSection('guides')}>Read the quickstart guides</button></section>
          <div className="configuration-next"><button onClick={() => setSection('project')}><strong>Project facts</strong><span>Capture stack, commands and team decisions →</span></button>{onOpenCockpit && <button onClick={onOpenCockpit}><strong>Already have run evidence?</strong><span>Open the cockpit and inspect a bundle →</span></button>}</div>
        </div>}
        {section === 'runtimes' && <RuntimeSetup onUseRuntime={onUseRuntime} onOpenConnections={onOpenConnections} />}
        {section === 'models' && <ModelConfiguration embedded onBack={onBack} onOpenRuntimes={() => setSection('runtimes')} />}
        {section === 'project' && <PipelineConfiguration embedded onBack={onBack} />}
        {section === 'guides' && <QuickstartGuides navigate={setSection} onBack={onBack} onOpenCockpit={onOpenCockpit} />}
      </div></div>
  </div>;
}
