import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionsWorkbench } from './ConnectionsWorkbench';
import './styles.css';
import './connections.css';
import './connections-light.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ConnectionsWorkbench />
  </StrictMode>
);
