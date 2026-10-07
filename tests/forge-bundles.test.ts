import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectBundle, boundedFile, readEvents, safeReference } from '../src/main/bundle-reader';
import { ForgeBridge } from '../src/main/forge-bridge';

async function fixture(context: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'forge-bundle-'));
  context.after(() => fs.rm(root,{ recursive: true, force: true }));
  const docs = {
    'repository-intelligence.json': { story_id:'EXAMPLE-1', revision:'a'.repeat(40) },
    'brainstorm.json': { story_id:'EXAMPLE-1', success_criteria:[{ id:'SC-1', statement:'Returns the expected value' }] },
    'detailed-plan.json': { criterion_test_map:[{ sc_id:'SC-1', test_ids:['test_value'] }] },
    'profile-resolution.json': { selected_profile:'small' },
    'quality-gates.json': { verdict:'PASS', criterion_evidence:[{ sc_id:'SC-1', status:'PASS', evidence_refs:['evidence/verify.log'] }] },
    'convergence-report.json': { attempt:1, outcome:'CONVERGED' },
    'red-result.json': { stage:'red_test', actor_role:'test_author', outcome:'completed', commands:[{ command:'tests', exit_code:1, output_ref:'evidence/red.log' }] },
    'green-result.json': { stage:'green_code', actor_role:'implementer', outcome:'completed', commands:[{ command:'tests', exit_code:0, output_ref:'evidence/green.log' }] },
    'refactor-result.json': { stage:'refactor', actor_role:'refactorer', outcome:'completed', commands:[{ command:'tests', exit_code:0, output_ref:'evidence/green.log' }] }
  };
  for (const [name,value] of Object.entries(docs)) await fs.writeFile(path.join(root,name),JSON.stringify({ schema_version:'1.0',...value }));
  await fs.mkdir(path.join(root,'evidence'));
  for (const name of ['red','green','verify']) await fs.writeFile(path.join(root,'evidence',name+'.log'),name === 'red' ? 'Intended assertion failure' : 'One executed test passed');
  const stages = ['prepare','brainstorm','plan','analyze','red_test','green_code','refactor','quality_gate','converge','close'];
  const events = stages.map((stage,index) => ({ schema_version:'1.0',sequence:index+1,timestamp:'2026-10-06T12:00:00Z', attempt:1,
    stage,event_type:stage === 'close' ? 'run.completed' : 'stage.completed',actor_role:'orchestrator',artifact_refs:[] }));
  await fs.writeFile(path.join(root,'events.jsonl'),events.map((e) => JSON.stringify(e)).join('\n'));
  return root;
}

test('legacy bundle inspection checks files while retaining imported authority', async (context) => {
  const root = await fixture(context), snapshot = await inspectBundle(root,'example-id');
  assert.equal(snapshot.evidenceLevel,'files_checked'); assert.equal(snapshot.source,'imported');
  assert.equal(snapshot.stages.length,9); assert.equal(snapshot.criteria[0].tests[0],'test_value');
  assert.equal(snapshot.host,undefined);
  const page = await readEvents(root,2,3); assert.deepEqual(page.events.map((e) => e.sequence),[3,4,5]); assert.equal(page.nextCursor,5);
  await fs.unlink(path.join(root,'evidence/verify.log'));
  assert.match((await inspectBundle(root,'example-id')).issues.join('\n'),/Missing\/unsafe/);
});

test('nonzero GREEN, empty tests and malformed metadata are visible', async (context) => {
  const root = await fixture(context);
  await fs.writeFile(path.join(root,'green-result.json'),JSON.stringify({ schema_version:'1.0',outcome:'completed',
    commands:[{ command:'tests',exit_code:17,output_ref:'evidence/green.log' }] }));
  await fs.writeFile(path.join(root,'evidence/green.log'),'Ran 0 tests in 0.000s\nOK');
  const snapshot = await inspectBundle(root,'id');
  assert.equal(snapshot.evidenceLevel,'imported_claims');
  assert.match(snapshot.issues.join('\n'),/nonzero/); assert.match(snapshot.issues.join('\n'),/Empty test suite/);
  await fs.writeFile(path.join(root,'events.jsonl'),JSON.stringify({ sequence:1,attempt:1,actor_role:{ unsafe:true },artifact_refs:[] }));
  assert.match((await inspectBundle(root,'id')).issues.join('\n'),/Event sequence or fields/);
});

test('evidence cannot escape the chosen directory or follow links', async (context) => {
  const root = await fixture(context);
  for (const reference of ['../outside.json','/tmp/outside.log','C:/outside.json','a\\b.json','.git/config','evidence/x?.json']) {
    assert.equal(safeReference(reference),false); await assert.rejects(boundedFile(root,reference));
  }
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(root,'brainstorm.json'),path.join(root,'evidence/link.json'));
    await assert.rejects(boundedFile(root,'evidence/link.json'),/symlinks/);
    await assert.rejects(inspectBundle(root,'id'),/symlink/);
  }
});

test('persisted bundle imports have no executable host handle', async (context) => {
  const root = await fixture(context);
  const directory = path.join(root,'console-data'), bridge = new ForgeBridge(directory);
  const imported = await bridge.import(root);
  await assert.rejects(bridge.action({ id:imported.id,action:'approve',approvalId:'fake',binding:'fake' }),/no execution authority/);
  const reopened = new ForgeBridge(directory);
  assert.equal((await reopened.list())[0].source,'imported');
  const artifact = await reopened.artifact(imported.id,'brainstorm.json'); assert.match(artifact.text,/SC-1/);
  await assert.rejects(reopened.artifact(imported.id,'../outside.json'),/inventory/);
});
