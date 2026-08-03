import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { activeAgentProcessCount, manageAgentProcess, terminateAllAgentProcesses } from '../src/main/agent-processes';

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), 5_000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (!chunk.toString('utf8').includes(expected)) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForClose(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for provider process to stop')), 5_000);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test('cancel escalates when a provider ignores the graceful termination signal', { skip: process.platform === 'win32' }, async () => {
  const child = manageAgentProcess(spawn(process.execPath, ['-e', [
    "process.on('SIGTERM', () => {});",
    "process.stdout.write('READY\\n');",
    'setInterval(() => {}, 1000);'
  ].join('')], { stdio: ['pipe', 'pipe', 'pipe'] }), 100);

  await waitForOutput(child, 'READY');
  assert.equal(activeAgentProcessCount(), 1);
  assert.equal(child.kill('SIGTERM'), true);
  const closed = await waitForClose(child);
  assert.equal(closed.signal, 'SIGKILL');
  assert.equal(activeAgentProcessCount(), 0);
});

test('application shutdown force-stops all managed providers', async () => {
  const first = manageAgentProcess(spawn(process.execPath, ['-e', "process.stdout.write('READY\\n'); setInterval(() => {}, 1000);"], { stdio: ['pipe', 'pipe', 'pipe'] }));
  const second = manageAgentProcess(spawn(process.execPath, ['-e', "process.stdout.write('READY\\n'); setInterval(() => {}, 1000);"], { stdio: ['pipe', 'pipe', 'pipe'] }));
  await Promise.all([waitForOutput(first, 'READY'), waitForOutput(second, 'READY')]);
  assert.equal(activeAgentProcessCount(), 2);

  const closed = Promise.all([waitForClose(first), waitForClose(second)]);
  terminateAllAgentProcesses(true);
  await closed;
  assert.equal(activeAgentProcessCount(), 0);
});

test('agent runtime and Electron lifecycle use the managed provider process layer', async () => {
  const runtime = await readFile(new URL('../src/main/agent-runtime.ts', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(runtime, /manageAgentProcess\(spawn\(/);
  assert.match(main, /app\.on\('before-quit', stopProviderProcesses\)/);
  assert.match(main, /terminateAllAgentProcesses\(true\)/);
});
