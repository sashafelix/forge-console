import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('the default renderer mounts the task-first quality workbench', async () => {
  const main = await source('src/renderer/main.tsx');
  const taskWorkbench = await source('src/renderer/TaskWorkbench.tsx');

  assert.match(main, /TaskWorkbench/);
  assert.doesNotMatch(main, /<RepositoryWorkbench\s*\/>/);
  assert.match(taskWorkbench, /Guided workflows/);
  assert.match(taskWorkbench, /Advanced options/);
  assert.match(taskWorkbench, /AgentWorkbench/);
});

test('the sandboxed preload exposes connection metadata operations without a secret read API', async () => {
  const preload = await source('src/main/preload.ts');
  const contracts = await source('src/shared/contracts.ts');

  for (const method of ['listConnections', 'saveConnection', 'removeConnection', 'testConnection']) {
    assert.match(preload, new RegExp(`${method}:`));
    assert.match(contracts, new RegExp(`${method}\\(`));
  }

  assert.doesNotMatch(preload, /getConnectionSecret|readConnectionSecret|decryptConnection/);
  assert.doesNotMatch(contracts, /getConnectionSecret|readConnectionSecret|decryptConnection/);
});

test('connection secrets use password inputs and are never rendered from connection summaries', async () => {
  const workbench = await source('src/renderer/ConnectionsWorkbench.tsx');

  assert.match(workbench, /type="password"/);
  assert.match(workbench, /secret: ''/);
  assert.doesNotMatch(workbench, /summary\.secret/);
});

test('BMW LLM remains non-executable after configuration', async () => {
  const runtime = await source('src/main/runtime.ts');

  assert.match(runtime, /status: bmw\?\.configured \? 'unavailable' : 'unconfigured'/);
  assert.match(runtime, /HTTP execution is not enabled yet/);
});
