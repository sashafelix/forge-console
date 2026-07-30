import assert from 'node:assert/strict';
import test from 'node:test';
import { getProcessRuntimeSpec, PROCESS_RUNTIME_SPECS } from '../src/shared/runtime-specs';

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

test('all process runtime identifiers are unique', () => {
  const ids = PROCESS_RUNTIME_SPECS.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);
});
