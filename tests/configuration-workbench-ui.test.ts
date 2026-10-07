import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, afterEach, test } from 'node:test';
import { createElement } from 'react';
import type { DesktopApi, ProcessRuntimeId } from '../src/shared/contracts';
const require = createRequire(import.meta.url);
require.extensions['.css'] = () => undefined;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://configuration.test' });
for (const key of ['window','document','HTMLElement','HTMLInputElement','Node','localStorage']) Object.defineProperty(globalThis,key,{ value:dom.window[key],configurable:true });
Object.defineProperty(globalThis,'navigator',{ value:dom.window.navigator,configurable:true });
const { render,screen,fireEvent,waitFor,cleanup,within } = require('@testing-library/react') as typeof import('@testing-library/react');
const { ConfigurationWorkbench } = require('../src/renderer/ConfigurationWorkbench') as typeof import('../src/renderer/ConfigurationWorkbench');
afterEach(() => { cleanup(); localStorage.clear(); }); after(() => dom.window.close());

function setup() {
  const calls: string[] = [];
  let installed = false;
  const runtimes = () => [{ id:'github-copilot',name:'GitHub Copilot',kind:'process',status:installed?'available':'unavailable',capabilities:[],description:'Fixture',executablePath:installed?'/fixture/copilot':undefined }];
  window.agentPipeline = {
    listRuntimes:async () => { calls.push('list'); return runtimes(); },
    configureRuntimeExecutable:async (id:ProcessRuntimeId) => { calls.push('choose:'+id);installed=true;return runtimes(); },
    testRuntimeConnection:async (id:ProcessRuntimeId) => { calls.push('test:'+id);return { runtimeId:id,ok:true,testedAt:'2026-10-07T00:00:00Z',message:'Fixture sign-in verified.' }; },
    listModelConfiguration:async () => ({ schemaVersion:'1.0',revision:0,providers:[],profiles:[],diagnostics:[],credentials:{} })
  } as unknown as DesktopApi;
  render(createElement(ConfigurationWorkbench,{ onBack:() => calls.push('workflows'),onOpenCockpit:() => calls.push('cockpit'),onUseRuntime:(id) => calls.push('use:'+id) }));
  return calls;
}

test('Copilot has a usable setup path without masquerading as an HTTP provider', async () => {
  const calls = setup();
  assert.equal(calls.length, 0);
  fireEvent.click(screen.getByRole('button',{ name:'Set up Copilot or Claude' }));
  const copilot = within(screen.getByRole('region',{ name:'GitHub Copilot' }));
  await copilot.findByText('Setup needed');
  assert.equal((copilot.getByRole('button',{ name:'Test GitHub Copilot connection' }) as HTMLButtonElement).disabled,true);
  assert.match(screen.getByText(/CLI subscriptions cannot be assigned/).textContent!, /HTTP model providers/);
  fireEvent.click(copilot.getByRole('button',{ name:'Choose GitHub Copilot executable' }));
  await copilot.findByText('Installed');
  assert.equal(calls.some((item) => item.startsWith('test:')),false);
  fireEvent.click(copilot.getByRole('button',{ name:'Test GitHub Copilot connection' }));
  await copilot.findByText('Fixture sign-in verified.');
  fireEvent.click(copilot.getByRole('button',{ name:'Use GitHub Copilot for a workflow' }));
  assert.ok(calls.includes('use:github-copilot'));
});

test('quickstarts navigate to each real setup path and preserve the selected theme', async () => {
  const calls = setup();
  fireEvent.change(screen.getByLabelText('Colour theme'),{ target:{ value:'dark' } });
  fireEvent.click(screen.getByRole('button',{ name:'Read the quickstart guides' }));
  assert.ok(screen.getByRole('heading',{ name:'Run your first standalone agent' }));
  assert.ok(screen.getByRole('heading',{ name:'Prepare a Forge run' }));
  assert.ok(screen.getByRole('heading',{ name:'Review an existing run' }));
  fireEvent.click(screen.getByRole('button',{ name:'Configure models' }));
  await screen.findByRole('heading',{ name:'Connect your first provider' });
  await waitFor(() => assert.ok(!screen.queryByText('Loading saved configuration…')));
  assert.equal(document.querySelector('.configuration-workbench')?.getAttribute('data-theme'),'dark');
  assert.equal(localStorage.getItem('forge-console.cockpit-theme'),'dark');
  fireEvent.click(screen.getByRole('button',{ name:'Using Copilot or Claude Code? Set up a CLI runtime' }));
  await screen.findByRole('heading',{ name:'Connect your coding assistant' });
  fireEvent.click(screen.getByRole('button',{ name:'Forge cockpit' }));
  assert.ok(calls.includes('cockpit'));
});
