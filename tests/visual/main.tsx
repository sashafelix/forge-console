/** Browser fixture only: no native filesystem, credential or execution bridge. */
import { createRoot } from 'react-dom/client';
import { ForgeCockpit } from '../../src/renderer/ForgeCockpit';
import type { DesktopApi } from '../../src/shared/contracts';
import { FORGE_STAGES, type ForgeRunSnapshot, type HostView } from '../../src/shared/forge';

const base = 'a'.repeat(40);
const id = '11111111-1111-4111-8111-111111111111';
const host: HostView = {
  schema_version:'1.0',host_version:'1.0',id:'fixture-host',story_id:'EXAMPLE-102',
  created_at:'2026-10-06T12:00:00Z',updated_at:'2026-10-06T12:00:00Z',status:'awaiting_approval',stage:'green_code',
  attempt:1,base_revision:base,profile:'high-risk',completed_stages:FORGE_STAGES.slice(0,5),tokens_estimated:12000,
  error:null,recoverable:false,approval:{ id:'fixture-checkpoint',reason:'before green_code',binding_sha256:'b'.repeat(64),expires_at:4102444800 },
  available_actions:['approve','cancel'],sandbox:{ ready:true,backend:'docker' },policy_sha256:'c'.repeat(64),configuration_sha256:'d'.repeat(64),
  bundle_path:'/fixture/run/bundle',workspace_path:'/fixture/run/workspace',
  permissions:{ source_paths:['src'],test_paths:['tests'],commands:{ tests:['python3','-B','-m','unittest','discover','-v'] },
    image:'sha256:'+'e'.repeat(64),network:'none',publication:'manual',max_turns:20,command_timeout:60,max_tokens:300000,
    providers:[{ name:'Reviewed local provider',base_url:'http://localhost:11434/v1',locality:'local',credential_ref:null }] }
};
const run: ForgeRunSnapshot = {
  id,source:'imported',storyId:'EXAMPLE-101',profile:'standard',baseRevision:base,updatedAt:'2026-10-06T12:00:00Z',
  status:'reported completed',verdict:'PASS',evidenceLevel:'files_checked',issues:[],stages:[...FORGE_STAGES],attempt:1,
  criteria:[{ id:'SC-1',statement:'Given a valid request, return a deterministic result.',status:'PASS',tests:['tests.test_api.test_valid'],evidence:['evidence/verify.log'] },
    { id:'SC-2',statement:'Given malformed input, return a bounded validation error.',status:'PASS',tests:['tests.test_api.test_invalid'],evidence:['evidence/verify.log'] }],
  commands:['red_test','green_code','refactor','quality_gate'].map((stage,i) => ({ id:String(i),stage,role:i===3?'independent_verifier':'test_author',invocationId:'fixture-'+i,
    command:'tests',exitCode:i===0?1:0,outputRef:'evidence/'+stage+'.log',collected:2,passed:i===0?0:2,failed:i===0?2:0,wallTimeMs:280 })),
  artifacts:[{ path:'quality-gates.json',bytes:1200 },{ path:'changes.patch',bytes:320 },{ path:'evidence/verify.log',bytes:200 }],eventCount:2
};
const managed: ForgeRunSnapshot = { ...run,id:'22222222-2222-4222-8222-222222222222',storyId:'EXAMPLE-102',source:'managed',
  status:'awaiting_approval',profile:'high-risk',stages:[...host.completed_stages],evidenceLevel:'imported_claims',host,
  verdict:'UNKNOWN',criteria:run.criteria.map((c) => ({...c,status:'MISSING',evidence:[]})),commands:run.commands.slice(0,1) };
const events = [
  { sequence:1,timestamp:'2026-10-06T12:00:00Z',attempt:1,stage:'quality_gate',event_type:'stage.completed',actor_role:'independent_verifier',artifact_refs:['quality-gates.json'],safe_summary:'Both criteria passed in a fresh verification workspace.' },
  { sequence:2,timestamp:'2026-10-06T12:00:01Z',attempt:1,stage:'close',event_type:'run.completed',actor_role:'orchestrator',artifact_refs:[],safe_summary:'Review the patch before publication.' }
];
const patch = '--- a/src/api.py\n+++ b/src/api.py\n@@ -1,2 +1,4 @@\n def result(value):\n-    return None\n+    if not isinstance(value, int):\n+        raise ValueError("Expected an integer")\n+    return value * 2\n';
const runs = [run,managed];
window.agentPipeline = {
  getForgeSetup:async () => ({ host:null,inputs:null }),listForgeRuns:async () => runs,
  getForgeRun:async (selected:string) => runs.find((r) => r.id===selected)!,
  getForgeEvents:async ({after}:{after:number}) => ({ events:events.filter((e) => e.sequence>after),nextCursor:2 }),
  getForgeArtifact:async ({path}:{path:string}) => ({ path,text:path==='changes.patch'?patch:'test_valid ... ok\ntest_invalid ... ok\nRan 2 tests in 0.280s\nOK\n',redactions:0,truncated:false }),
  importForgeBundle:async () => run,
  forgeAction:async () => { throw new Error('UI fixture never executes a host action.'); }
} as unknown as DesktopApi;
createRoot(document.getElementById('root')!).render(<ForgeCockpit onBack={() => undefined} />);
