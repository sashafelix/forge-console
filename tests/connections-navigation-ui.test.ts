import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, afterEach, test } from 'node:test';
import { createElement } from 'react';
import type { DesktopApi, RunEventListener, WorkspacePage } from '../src/shared/contracts';
import { defaultSettings } from '../src/shared/settings';

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => undefined;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://connections.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'localStorage']) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
window.scrollTo = () => undefined;
const { render, screen, fireEvent, waitFor, cleanup, within, act } = require('@testing-library/react') as typeof import('@testing-library/react');
const { WorkspaceShell } = require('../src/renderer/WorkspaceShell') as typeof import('../src/renderer/WorkspaceShell');
const { TaskWorkbench } = require('../src/renderer/TaskWorkbench') as typeof import('../src/renderer/TaskWorkbench');
afterEach(() => { cleanup(); localStorage.clear(); });
after(() => dom.window.close());

function setup() {
  let navigate!: (page: WorkspacePage) => void;
  const runListeners = new Set<RunEventListener>();
  let runSubscriptions = 0;
  const calls: string[] = [];
  const connections = [{ id: 'jira', name: 'Jira', serviceUrl: 'https://jira.example', authHeader: 'Authorization', authScheme: 'bearer', configured: false }];
  window.agentPipeline = {
    onWorkspaceNavigate: (listener: (page: WorkspacePage) => void) => { navigate = listener; return () => undefined; },
    openConnections: async () => { calls.push('open'); navigate('connections'); },
    getSystemInfo: async () => ({ platform: 'linux', arch: 'x64', appVersion: 'test' }),
    listConnections: async () => connections,
    getSettings: async () => defaultSettings(),
    listRuntimes: async () => [{ id: 'github-copilot', name: 'GitHub Copilot', kind: 'process', status: 'available', capabilities: [], description: 'Fixture' }],
    onRunEvent: (listener: RunEventListener) => { runSubscriptions++; runListeners.add(listener); return () => { runListeners.delete(listener); }; },
    getLatestAgentExecutionRun: async () => null,
    listModelConfiguration: async () => ({ schemaVersion: '1.0', revision: 0, providers: [], profiles: [], diagnostics: [], credentials: {} }),
    getForgeSetup: async () => ({ host: null, inputs: null }), listForgeRuns: async () => [],
    selectAgentLibrary: async () => ({ source: { name: 'Example library', path: '/fixture/library', isGitRepository: true },
      agents: [{ id: 'readme-review', name: 'Readme Review', version: '1', description: 'Review documentation', sourceRoot: '/fixture/library', relativePath: 'agents/readme-review.md',
        inputs: [{ name: 'task', title: 'Task', required: true }], tools: [], writes: [], requiredEnvironment: [] }] })
  } as unknown as DesktopApi;
  render(createElement(WorkspaceShell, null, createElement(TaskWorkbench)));
  return { calls, runListeners, subscriptions: () => runSubscriptions, navigate: (page: WorkspacePage) => act(() => navigate(page)) };
}

test('Connections preserves workflow drafts and subscriptions, restores focus and clears unsaved tokens on exit', async () => {
  const api = setup();
  fireEvent.click(screen.getByRole('button', { name: /Choose workflow folder/ }));
  const task = await screen.findByLabelText('Task *');
  fireEvent.change(task, { target: { value: 'Review the setup instructions' } });
  await waitFor(() => assert.equal(api.runListeners.size, 1));
  const subscriptions = api.subscriptions();
  const opener = screen.getByRole('button', { name: 'Connections' });
  opener.focus(); fireEvent.click(opener);
  const heading = await screen.findByRole('heading', { name: 'Connections' });
  assert.equal(document.activeElement, heading);
  assert.equal(screen.queryByRole('heading', { name: 'Tell us what needs to be done' }), null);
  const jira = within(await screen.findByRole('region', { name: 'Jira' }));
  fireEvent.change(jira.getByLabelText('Personal access token *'), { target: { value: 'unsaved-fixture-token' } });
  assert.equal(api.runListeners.size, 1);
  assert.equal(api.subscriptions(), subscriptions);
  // Repeated shortcut presses keep the current form and its inputs.
  api.navigate('connections');
  assert.equal((jira.getByLabelText('Personal access token *') as HTMLInputElement).value, 'unsaved-fixture-token');
  fireEvent.click(screen.getByRole('button', { name: /Back to previous page/ }));
  assert.equal(document.activeElement, opener);
  assert.equal((screen.getByLabelText('Task *') as HTMLTextAreaElement).value, 'Review the setup instructions');
  assert.equal(api.subscriptions(), subscriptions);
  api.navigate('connections');
  const freshJira = within(await screen.findByRole('region', { name: 'Jira' }));
  assert.equal((freshJira.getByLabelText('Personal access token *') as HTMLInputElement).value, '');
  assert.ok(!JSON.stringify(localStorage).includes('unsaved-fixture-token'));
});

test('menu navigation restores the exact configuration form and shares theme changes with retained pages', async () => {
  const api = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Pipeline configuration' }));
  fireEvent.click(screen.getByRole('button', { name: /Models & providers Governed role routing/ }));
  await screen.findByRole('heading', { name: 'Connect your first provider' });
  fireEvent.click(screen.getByRole('button', { name: 'Ollama' }));
  const baseUrl = screen.getByLabelText(/API base URL/);
  fireEvent.change(baseUrl, { target: { value: 'http://localhost:12434/v1' } });
  fireEvent.change(screen.getByLabelText('Colour theme'), { target: { value: 'dark' } });
  api.navigate('connections');
  await screen.findByRole('heading', { name: 'Connections' });
  assert.equal(document.querySelector('.connections-shell')?.getAttribute('data-theme'), 'dark');
  fireEvent.change(within(document.querySelector('.connections-shell') as HTMLElement).getByLabelText('Colour theme'), { target: { value: 'light' } });
  api.navigate('workbench');
  assert.equal(screen.getByLabelText(/API base URL/), baseUrl);
  assert.equal((baseUrl as HTMLInputElement).value, 'http://localhost:12434/v1');
  assert.equal(document.querySelector('.configuration-workbench')?.getAttribute('data-theme'), 'light');
});

test('a retained cockpit ignores global commands while Connections is visible', async () => {
  const api = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Forge cockpit' }));
  await screen.findByRole('heading', { name: 'Every change has a trace.' });
  api.navigate('connections');
  await screen.findByRole('heading', { name: 'Connections' });
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  api.navigate('workbench');
  assert.equal(screen.queryByRole('dialog'), null);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  assert.ok(screen.getByRole('dialog'));
});
