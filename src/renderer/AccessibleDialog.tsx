import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export function AccessibleDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex="0"]')?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="forge-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} className="forge-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const elements = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="forge-section-heading"><h2>{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose}>×</button></div>
      {children}
    </div>
  </div>;
}
