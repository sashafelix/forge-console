import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RepositoryWorkbench } from './RepositoryWorkbench';
import './styles.css';
import './repository.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <RepositoryWorkbench />
  </StrictMode>
);
