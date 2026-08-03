import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskWorkbench } from './TaskWorkbench';
import './styles.css';
import './repository.css';
import './task-light.css';
import './state-navigation.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <TaskWorkbench />
  </StrictMode>
);
