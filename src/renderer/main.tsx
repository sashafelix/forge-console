import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskWorkbench } from './TaskWorkbench';
import { WorkspaceShell } from './WorkspaceShell';
import { initializeConsoleTheme } from './useConsoleTheme';
import './styles.css';
import './repository.css';
import './task-workbench.css';
import './state-navigation.css';
import './advanced-workbench.css';
import './interactive-runs.css';

initializeConsoleTheme();
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <WorkspaceShell><TaskWorkbench /></WorkspaceShell>
  </StrictMode>
);
