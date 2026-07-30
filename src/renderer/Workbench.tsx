import { useState } from 'react';
import { AgentApp } from './AgentApp';
import { App } from './App';

type Mode = 'agents' | 'pipelines';

export function Workbench() {
  const [mode, setMode] = useState<Mode>('agents');
  return (
    <>
      <nav className="workbench-tabs" aria-label="Workbench mode">
        <button type="button" className={mode === 'agents' ? 'active' : ''} onClick={() => setMode('agents')}>Agents</button>
        <button type="button" className={mode === 'pipelines' ? 'active' : ''} onClick={() => setMode('pipelines')}>Pipelines</button>
      </nav>
      {mode === 'agents' ? <AgentApp /> : <App />}
    </>
  );
}
