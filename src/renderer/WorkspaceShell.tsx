import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkspacePage } from '../shared/contracts';
import { ConnectionsWorkbench } from './ConnectionsWorkbench';

/** Keep the current workflow, drafts and run subscriptions alive while visiting Connections. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<WorkspacePage>('workbench');
  const currentPage = useRef<WorkspacePage>('workbench');
  const returnTo = useRef<{ element: HTMLElement | null; scroll: number } | null>(null);
  const connections = useRef<HTMLDivElement>(null);
  const navigate = useCallback((next: WorkspacePage) => {
    if (next === currentPage.current) return;
    if (next === 'connections') returnTo.current = { element: document.activeElement as HTMLElement | null, scroll: window.scrollY };
    currentPage.current = next;
    setPage(next);
  }, []);

  useEffect(() => window.agentPipeline.onWorkspaceNavigate(navigate), [navigate]);
  useLayoutEffect(() => {
    if (page === 'connections') {
      connections.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } else if (returnTo.current) {
      const { element, scroll } = returnTo.current;
      if (element?.isConnected) element.focus({ preventScroll: true });
      window.scrollTo(0, scroll);
      returnTo.current = null;
    }
  }, [page]);

  return <>
    <div hidden={page !== 'workbench'} inert={page !== 'workbench'}>{children}</div>
    {page === 'connections' && <div ref={connections}><ConnectionsWorkbench onBack={() => navigate('workbench')} /></div>}
  </>;
}
