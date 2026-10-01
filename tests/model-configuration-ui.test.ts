import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, afterEach, test } from 'node:test';
import { createElement } from 'react';
import type { DesktopApi } from '../src/shared/contracts';
import { exportConfiguration, newModel, newProfile, newProvider } from '../src/shared/providers';
import type { ProviderLibraryView } from '../src/shared/providers';

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => undefined;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://workbench.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'localStorage']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react') as typeof import('@testing-library/react');
const { ModelConfiguration } = require('../src/renderer/ModelConfiguration') as typeof import('../src/renderer/ModelConfiguration');
afterEach(() => { cleanup(); localStorage.clear(); });
after(() => dom.window.close());

function setup(withProfile = false) {
  const provider = newProvider('local-provider', 'ollama');
  const profile = newProfile('local-profile', 'Local coding');
  profile.models = [{ ...newModel('local-model', provider.id), name: 'Local model', model: 'coder-v1' }];
  profile.routes.forEach((route) => { route.models = ['local-model']; });
  let library: ProviderLibraryView = { schemaVersion: '1.0', revision: 1, providers: withProfile ? [provider] : [], profiles: withProfile ? [profile] : [], diagnostics: [], credentials: {} };
  let imports = 0;
  const exported: unknown[] = [];
  const api = {
    listModelConfiguration: async () => structuredClone(library),
    saveModelProvider: async (request: Parameters<DesktopApi['saveModelProvider']>[0]) => {
      library = { ...library, revision: library.revision + 1, providers: [request.provider] }; return structuredClone(library);
    },
    saveModelProfile: async (request: Parameters<DesktopApi['saveModelProfile']>[0]) => {
      library = { ...library, revision: library.revision + 1, profiles: [request.profile] }; return structuredClone(library);
    },
    discoverProviderModels: async () => ({ models: ['discovered-coder'], truncated: false, message: 'Synthetic discovery.' }),
    exportModelConfiguration: async (request: Parameters<DesktopApi['exportModelConfiguration']>[0]) => {
      assert.equal(request.expectedRevision, library.revision);
      exported.push(exportConfiguration(library.profiles.find((p) => p.id === request.profileId)!, library.providers)); return '/chosen/runtime-configuration.json';
    },
    selectModelConfiguration: async () => exportConfiguration(profile, [provider]),
    importModelConfiguration: async () => { imports += 1; return structuredClone(library); }
  };
  // No execution API is supplied: any attempt to launch a run fails this flow.
  window.agentPipeline = api as unknown as DesktopApi;
  render(createElement(ModelConfiguration, { onBack: () => undefined }));
  return { exported, get imports() { return imports; } };
}
async function ready() { await waitFor(() => assert.ok(!screen.queryByText('Loading saved configuration…'))); }

test('provider discovery creates an editable profile and export requires a saved, reviewed configuration', async () => {
  const state = setup(); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Ollama' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Discover models' }) as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole('button', { name: 'Discover models' }));
  fireEvent.click(await screen.findByRole('button', { name: 'discovered-coder +' }));
  const exportButton = screen.getByRole('button', { name: 'Export reviewed profile' }) as HTMLButtonElement;
  assert.equal(exportButton.disabled, true);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My local workflow' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  const review = screen.getByLabelText('I reviewed the models, locality and fallback order.') as HTMLInputElement;
  await waitFor(() => assert.equal(review.disabled, false));
  assert.equal(exportButton.disabled, true);
  fireEvent.click(review); fireEvent.click(exportButton);
  await screen.findByText(/Exported \/chosen/);
  assert.equal(state.exported.length, 1);
  assert.equal((state.exported[0] as any).profile.routes.length, 15);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved update' } });
  assert.equal(exportButton.disabled, true);
});

test('drafts survive remount while entered secrets never enter local storage', async () => {
  setup(); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft provider' } });
  fireEvent.change(screen.getByLabelText('API key / token', { exact: false }), { target: { value: 'secret-never-persist-in-renderer' } });
  const saved = localStorage.getItem('agent-pipeline-ui.model-configuration-draft.v1')!;
  assert.match(saved, /Draft provider/); assert.doesNotMatch(saved, /secret-never/);
  cleanup(); setup(); await ready();
  assert.equal((screen.getByLabelText('Name') as HTMLInputElement).value, 'Draft provider');
  assert.equal((screen.getByLabelText('API key / token', { exact: false }) as HTMLInputElement).value, '');
});

test('import displays a review and does not modify stored configuration before confirmation', async () => {
  const state = setup(true); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Import profile' }));
  await screen.findByRole('dialog', { name: 'Review imported configuration' });
  assert.equal(state.imports, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(screen.queryByRole('dialog'), null); assert.equal(state.imports, 0);
});

test('a corrupt persisted draft is discarded without breaking the configuration screen', async () => {
  localStorage.setItem('agent-pipeline-ui.model-configuration-draft.v1', JSON.stringify({ profile: { name: 'Bad draft', models: [null], routes: [] } }));
  setup(); await ready();
  fireEvent.click(screen.getByRole('tab', { name: '2 · Profiles & routing' }));
  assert.ok(screen.getByRole('heading', { name: 'Create a model profile' }));
});
