import { AgentWorkbench } from './AgentWorkbench';

export function RepositoryWorkbench() {
  return (
    <div className="repository-workbench-shell">
      <nav className="repository-workbench-nav" aria-label="Workbench navigation">
        <div>
          <strong>Repository workflows</strong>
          <span>Agents are discovered only after selecting their repository.</span>
        </div>
        <button type="button" onClick={() => { void window.agentPipeline.openConnections(); }}>
          Connections
        </button>
      </nav>
      <AgentWorkbench />
    </div>
  );
}
