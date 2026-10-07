import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskWorkbench } from './TaskWorkbench';
import { WorkspaceShell } from './WorkspaceShell';
import './styles.css';
import './repository.css';
import './task-light.css';
import './state-navigation.css';
import './advanced-light.css';
import './interactive-runs.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <WorkspaceShell><TaskWorkbench /></WorkspaceShell>
  </StrictMode>
);
