import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, afterEach, test } from 'node:test';
import { createElement } from 'react';
import type { DesktopApi, AgentExecutionRun } from '../src/shared/contracts';
import type { ForgeRunSnapshot, HostView } from '../src/shared/forge';
import { emptyProjectProfileDraft } from '../src/shared/project-profile';
const require = createRequire(import.meta.url);
require.extensions['.css'] = () => undefined;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url:'https://console.test' });
for (const key of ['window','document','HTMLElement','HTMLInputElement','Node','localStorage']) Object.defineProperty(globalThis,key,{ value:dom.window[key],configurable:true });
Object.defineProperty(globalThis,'navigator',{ value:dom.window.navigator,configurable:true });
const { render, screen, fireEvent, waitFor, cleanup, within } = require('@testing-library/react') as typeof import('@testing-library/react');
const { PipelineConfiguration } = require('../src/renderer/PipelineConfiguration') as typeof import('../src/renderer/PipelineConfiguration');
const { ForgeCockpit } = require('../src/renderer/ForgeCockpit') as typeof import('../src/renderer/ForgeCockpit');
const { TaskWorkbench } = require('../src/renderer/TaskWorkbench') as typeof import('../src/renderer/TaskWorkbench');
const { AgentWorkbench } = require('../src/renderer/AgentWorkbench') as typeof import('../src/renderer/AgentWorkbench');
afterEach(() => { cleanup(); localStorage.clear(); });
after(() => dom.window.close());

const project = { name:'Example target',path:'/example/target',isGitRepository:true };
const legacyRun = {
  id:'legacy-id', agentName:'Trusted fixture', agentVersion:'1', runtimeId:'claude-code', status:'awaiting_approval',
  baseRevision:'a'.repeat(40), createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
  targetProject:project, inputs:{}, conversation:[], worktreePath:'/example/worktree', repositoryRoot:project.path,
  branchName:'fixture',storagePath:'/example/run', runtimePolicy:{ fileWrites:'worktree-only', shell:'allowed-to-model',
    network:'allowed-through-approved-tools',requestedTools:['Bash','mcp.jira'],declaredWrites:['src/example.py'],
    maxTurns:12,requiredEnvironment:['JIRA_TOKEN'],missingEnvironment:[] }
} as unknown as AgentExecutionRun;
const agent = { id:'fixture',name:'Trusted fixture',version:'1',sourceRoot:'/library',relativePath:'agents/fixture.md',description:'Fixture task',
  supportedRuntimes:['claude-code'],inputs:[],tools:['Bash'],requiredEnvironment:['JIRA_TOKEN'],writes:['src/example.py'],writeRequested:true,maxTurns:12 };
function legacyApi() {
  return { getSystemInfo:async () => ({ platform:'linux',arch:'x64',appVersion:'1' }),
    listRuntimes:async () => [{ id:'claude-code',name:'Claude Code',kind:'process',status:'available' }],
    onRunEvent:() => () => undefined, getLatestAgentExecutionRun:async () => legacyRun,
    getAgentExecutionRun:async () => legacyRun,getAgentExecutionEvents:async () => [],
    selectAgentLibrary:async () => ({ source:{ name:'Library',path:'/library',isGitRepository:true },agents:[agent] }),
    selectProjectDirectory:async () => project,prepareAgentExecution:async () => legacyRun };
}
function assertDisclosure() {
  const panel = within(screen.getByRole('region',{ name:'Requested permissions' }));
  assert.ok(screen.getByRole('heading',{ name:'Review access before starting' }));
  assert.ok(screen.getByText('Allowed for trusted agent'));
  assert.ok(screen.getByText('Allowed through agent tools'));
  assert.ok(screen.getByText('Bash, mcp.jira'));
  assert.ok(panel.getByText('src/example.py'));
  assert.ok(screen.getByText('JIRA_TOKEN — available'));
  assert.ok(screen.getByText(/Shell access is not an operating-system sandbox/));
}
test('Guided and Advanced display the same evaluated permissions before approval',async () => {
  window.agentPipeline = legacyApi() as unknown as DesktopApi;
  render(createElement(TaskWorkbench));
  await screen.findByRole('heading',{ name:'Ready to start' }); assertDisclosure();
  cleanup();
  render(createElement(AgentWorkbench));
  await waitFor(() => assert.ok(screen.getByText('Claude Code')));
  fireEvent.click(screen.getByRole('button',{ name:/Choose agent library/ }));
  await screen.findByRole('heading',{ name:'Trusted fixture' });
  fireEvent.click(screen.getByRole('button',{ name:/Choose code repository/ }));
  const prepare = screen.getByRole('button',{ name:'Prepare agent run' });
  await waitFor(() => assert.equal((prepare as HTMLButtonElement).disabled,false));
  fireEvent.click(prepare); await screen.findByRole('heading',{ name:'Review the standalone-agent boundary' });
  assertDisclosure();
});

test('project facts drafts survive navigation and approval never persists',async () => {
  window.agentPipeline = { exportProjectProfile:async () => '/profile.json' } as unknown as DesktopApi;
  render(createElement(PipelineConfiguration,{ onBack:() => undefined }));
  for (const [label,value] of [['Project ID *','EXAMPLE'],['Prepared by *','Operator'],['Languages / stack (one per line) *','Python']]) fireEvent.change(screen.getByLabelText(label),{ target:{ value } });
  fireEvent.click(screen.getByLabelText('I have reviewed these project facts for use by the pipeline.'));
  cleanup(); render(createElement(PipelineConfiguration,{ onBack:() => undefined }));
  assert.equal((screen.getByLabelText('Project ID *') as HTMLInputElement).value,'EXAMPLE');
  assert.equal((screen.getByLabelText('I have reviewed these project facts for use by the pipeline.') as HTMLInputElement).checked,false);
  assert.equal((screen.getByRole('button',{ name:'Export new project profile' }) as HTMLButtonElement).disabled,true);
});
test('project profile import retains modules and decisions and displays changed fields',async () => {
  const draft = { ...emptyProjectProfileDraft(),projectId:'EXAMPLE',issuedBy:'Operator',stack:'Python',
    modules:'[{"name":"API","path":"src/api","purpose":"Public API"}]',decisions:'{"database":"postgres"}' };
  window.agentPipeline = { selectProjectProfile:async () => draft } as unknown as DesktopApi;
  render(createElement(PipelineConfiguration,{ onBack:() => undefined }));
  fireEvent.click(screen.getByRole('button',{ name:'Import project profile' }));
  await screen.findByText(/Imported all project facts/);
  assert.match((screen.getByLabelText('Modules (JSON array)') as HTMLTextAreaElement).value,/Public API/);
  assert.match((screen.getByLabelText('Project decisions (JSON object)') as HTMLTextAreaElement).value,/postgres/);
  fireEvent.change(screen.getByLabelText('Project ID *'),{ target:{ value:'UPDATED' } });
  assert.ok(screen.getByText('Changed since import: Project ID'));
});
const imported: ForgeRunSnapshot = {
  id:'11111111-1111-4111-8111-111111111111',source:'imported',storyId:'EXAMPLE-RUN',profile:'small',baseRevision:'a'.repeat(40),
  updatedAt:'2026-10-06T12:00:00Z',status:'reported completed',verdict:'PASS',evidenceLevel:'files_checked',issues:[],
  stages:['prepare','brainstorm','plan','analyze','red_test','green_code','refactor','quality_gate','converge'],attempt:1,
  criteria:[{ id:'SC-1',statement:'Returns the expected value',status:'PASS',tests:['test_value'],evidence:['evidence/verify.log'] }],
  commands:[{ id:'c1',stage:'quality_gate',role:'independent_verifier',command:'tests',exitCode:0,outputRef:'evidence/verify.log',collected:1,passed:1 }],
  artifacts:[{ path:'evidence/verify.log',bytes:20 },{ path:'changes.patch',bytes:60 }],eventCount:1
};
function cockpitApi() {
  return { getSystemInfo:async () => ({ platform:'linux',arch:'x64',appVersion:'fixture' }),
    getForgeSetup:async () => ({ host:null,inputs:null }),listForgeRuns:async () => [imported],
    getForgeRun:async () => imported,getForgeEvents:async () => ({ events:[],nextCursor:0 }),
    getForgeArtifact:async (request: { path:string }) => ({ path:request.path,text:'One executed test passed',redactions:0,truncated:false }),
    forgeAction:async () => { throw new Error('Imported evidence must never invoke execution'); } };
}
test('imported evidence is reviewable and has no approval or run controls',async () => {
  window.agentPipeline = cockpitApi() as unknown as DesktopApi;
  render(createElement(ForgeCockpit,{ onBack:() => undefined }));
  await screen.findByRole('heading',{ name:'EXAMPLE-RUN' });
  assert.ok(screen.getByText(/Imported labels, approvals and signatures are evidence claims/));
  assert.equal(screen.queryByRole('button',{ name:'Approve and continue' }),null);
  assert.equal(screen.queryByRole('button',{ name:'Continue pipeline' }),null);
  const overview = screen.getByRole('tab',{ name:'Overview' });
  fireEvent.keyDown(overview,{ key:'ArrowRight' });
  assert.equal(screen.getByRole('tab',{ name:'Evidence' }).getAttribute('aria-selected'),'true');
  fireEvent.click(screen.getByRole('button',{ name:'evidence/verify.log' }));
  await screen.findByText('One executed test passed');
});
test('command palette traps focus and Escape restores the opener',async () => {
  window.agentPipeline = cockpitApi() as unknown as DesktopApi;
  render(createElement(ForgeCockpit,{ onBack:() => undefined }));
  await screen.findByRole('heading',{ name:'EXAMPLE-RUN' });
  const opener = screen.getByRole('button',{ name:/Commands/ }); opener.focus(); fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog',{ name:'Console commands' });
  const buttons = within(dialog).getAllByRole('button');
  buttons.at(-1)!.focus(); fireEvent.keyDown(dialog,{ key:'Tab' });
  assert.equal(document.activeElement,buttons[0]);
  fireEvent.keyDown(dialog,{ key:'Escape' });
  assert.equal(screen.queryByRole('dialog'),null); assert.equal(document.activeElement,opener);
});
test('managed approval uses the visible exact binding and verification remains pending',async () => {
  const host: HostView = { schema_version:'1.0',host_version:'1.0',id:'fixture-host',story_id:imported.storyId,
    created_at:imported.updatedAt,updated_at:imported.updatedAt,status:'awaiting_approval',stage:'green_code',base_revision:'a'.repeat(40),
    attempt:1,profile:'high-risk',tokens_estimated:12000,error:null,recoverable:false,sandbox:{ready:true,backend:'docker'},
    policy_sha256:'c'.repeat(64),configuration_sha256:'d'.repeat(64),
    completed_stages:['prepare','brainstorm','plan','analyze','red_test'],
    approval:{ id:'checkpoint-id',reason:'before green_code',binding_sha256:'b'.repeat(64),expires_at:4102444800 },
    available_actions:['approve','cancel'],permissions:{ source_paths:['src'],test_paths:['tests'],commands:{ tests:['python3','-m','unittest','-v'] },network:'none',publication:'manual' },
    workspace_path:'/fixture/workspace',bundle_path:'/fixture/bundle' };
  const managed: ForgeRunSnapshot = { ...imported,source:'managed',status:'awaiting_approval',host };
  const calls:unknown[]=[];
  window.agentPipeline = { ...cockpitApi(),listForgeRuns:async () => [managed],getForgeRun:async () => managed,
    forgeAction:async (request:unknown) => { calls.push(request); return {...managed,host:{...host,status:'ready',approval:null,available_actions:[]}}; }
  } as unknown as DesktopApi;
  render(createElement(ForgeCockpit,{onBack:() => undefined}));
  await screen.findByRole('heading',{name:'Before Green Code'});
  assert.match(screen.getByText('Verification verdict').parentElement!.textContent! ,/Pending/);
  fireEvent.click(screen.getByRole('button',{name:'Approve and continue'}));
  await waitFor(() => assert.equal(calls.length,1));
  assert.deepEqual(calls[0],{id:managed.id,action:'approve',approvalId:'checkpoint-id',binding:'b'.repeat(64),stage:undefined});
});
