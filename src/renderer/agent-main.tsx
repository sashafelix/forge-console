import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentWorkbench } from './AgentWorkbench';
import { initializeConsoleTheme } from './useConsoleTheme';
import './styles.css';

initializeConsoleTheme();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgentWorkbench />
  </React.StrictMode>
);
