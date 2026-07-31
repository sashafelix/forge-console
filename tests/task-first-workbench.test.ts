import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('main renderer mounts the task-first workbench by default', async () => {
  const source = await readFile(new URL('../src/renderer/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ TaskWorkbench \}/);
  assert.match(source, /<TaskWorkbench \/>/);
  assert.match(source, /task-light\.css/);
  assert.doesNotMatch(source, /<RepositoryWorkbench \/>/);
});

test('development tools are opt-in rather than opening on every launch', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.OPEN_DEVTOOLS === '1'/);
  assert.doesNotMatch(source, /\n\s*window\.webContents\.openDevTools\(\{ mode: 'detach' \}\);/);
});

test('task-first workbench translates the known Copilot enterprise network failure', async () => {
  const source = await readFile(new URL('../src/renderer/TaskWorkbench.tsx', import.meta.url), 'utf8');
  assert.match(source, /copilot_internal\\\/user/);
  assert.match(source, /Copilot needs attention/);
  assert.match(source, /Advanced options/);
  assert.match(source, /Guided workflows/);
});
