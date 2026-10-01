import { useState } from 'react';
import { ModelConfiguration } from './ModelConfiguration';
import { PipelineConfiguration } from './PipelineConfiguration';

export function ConfigurationWorkbench({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<'models' | 'project'>('models');
  return <><nav className="configuration-section-tabs" aria-label="Configuration pages">
    <button aria-current={section === 'models' ? 'page' : undefined} onClick={() => setSection('models')}>Models & providers</button>
    <button aria-current={section === 'project' ? 'page' : undefined} onClick={() => setSection('project')}>Project facts</button>
  </nav>{section === 'models' ? <ModelConfiguration onBack={onBack} /> : <PipelineConfiguration onBack={onBack} />}</>;
}
