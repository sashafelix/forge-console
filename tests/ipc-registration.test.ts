import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRoot = path.join(repositoryRoot, 'src', 'main');

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
  }));
  return nested.flat();
}

function count(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}

test('agent history IPC channels are registered exactly once', async () => {
  const files = await typescriptFiles(mainRoot);
  const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  const combined = sources.join('\n');

  assert.equal(
    count(combined, 'ipcMain.handle(IPC_CHANNELS.getLatestAgentExecutionRun'),
    1,
    'getLatestAgentExecutionRun must have exactly one IPC handler'
  );
  assert.equal(
    count(combined, 'ipcMain.handle(IPC_CHANNELS.getAgentExecutionEvents'),
    1,
    'getAgentExecutionEvents must have exactly one IPC handler'
  );
});

test('startup uses the unified IPC controller only', async () => {
  const startup = await readFile(path.join(mainRoot, 'index.ts'), 'utf8');
  assert.doesNotMatch(startup, /registerAgentRunHistoryIpcHandlers/);
  assert.match(startup, /registerIpcHandlers/);
});
