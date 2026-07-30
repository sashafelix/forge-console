import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutionArgs, getProcessRuntimeSpec, PROCESS_RUNTIME_SPECS } from '../src/shared/runtime-specs';

test('Claude preview is plan-only and does not bypass permissions', () => {
  const spec = getProcessRuntimeSpec('claude-code');
  assert.ok(spec);
  assert.deepEqual(spec.previewArgs.slice(-2), ['--permission-mode', 'plan']);
  assert.equal(spec.previewArgs.includes('--dangerously-skip-permissions'), false);
});

test('Copilot preview denies write and shell and does not allow all tools', () => {
  const spec = getProcessRuntimeSpec('github-copilot');
  assert.ok(spec);
  assert.ok(spec.previewArgs.includes('--deny-tool=write,shell'));
  assert.equal(spec.previewArgs.includes('--allow-all'), false);
  assert.equal(spec.previewArgs.includes('--allow-all-tools'), false);
  assert.ok(spec.previewArgs.includes('--no-remote'));
});

test('Claude execution permits file edits but denies shell and network tools', () => {
  const args = buildExecutionArgs('claude-code', 24);
  assert.ok(args.includes('acceptEdits'));
  assert.ok(args.includes('Read,Write,Edit,Glob,Grep'));
  assert.ok(args.includes('Bash,WebFetch,WebSearch'));
  assert.equal(args.includes('--dangerously-skip-permissions'), false);
  assert.equal(args.includes('Bash'), false);
  assert.equal(args.includes('WebFetch'), false);
});

test('Copilot execution permits write tools but denies shell URL and memory', () => {
  const args = buildExecutionArgs('github-copilot', 24);
  assert.ok(args.includes('--available-tools=view,grep,glob,edit,create,apply_patch'));
  assert.ok(args.includes('--allow-tool=write'));
  assert.ok(args.includes('--deny-tool=shell,url,memory'));
  assert.equal(args.includes('--allow-all'), false);
  assert.equal(args.includes('--allow-all-tools'), false);
  assert.ok(args.includes('--no-remote'));
});

test('execution turn budgets are bounded', () => {
  assert.throws(() => buildExecutionArgs('claude-code', 0), /maxTurns/);
  assert.throws(() => buildExecutionArgs('github-copilot', 101), /maxTurns/);
});

test('all process runtime identifiers are unique', () => {
  const ids = PROCESS_RUNTIME_SPECS.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);
});
